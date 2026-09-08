import { DurableObject } from "cloudflare:workers";
import { createRoom, joinRoom, disconnect, command, tick, roomView, type RoomState, type Command } from "./room";
import { addLog } from "../shared/engine";

interface Env { GAME_ROOMS:DurableObjectNamespace<GameRoom>; ASSETS:Fetcher }
type Attachment={seat:number|null;connectionId:string;cursor:number;ping:string;pingAt:number;lastSeen:number;rateAt:number;rateCount:number};
const CODE=/^[A-HJ-NP-Z2-9]{6}$/;
export class GameRoom extends DurableObject<Env> {
  private state:RoomState|null=null;
  private queue:Promise<unknown>=Promise.resolve();
  private timer:ReturnType<typeof setInterval>|null=null;
  private lastSave=0;
  constructor(ctx:DurableObjectState,env:Env) {
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{
      this.state=await ctx.storage.get<RoomState>("state")??null;
      if(this.state){
        const live=new Set(ctx.getWebSockets().map(ws=>(ws.deserializeAttachment() as Attachment)?.connectionId));
        for(const seat of this.state.seats)if(seat && !seat.bot && seat.connected && !live.has(seat.connectionId))disconnect(this.state,seat.id,seat.connectionId,this.state.game.lastTick);
        this.startTimer();
      }
    });
  }
  private serial<T>(work:()=>Promise<T>):Promise<T> {
    const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;
  }
  async initialize(code:string) {
    return this.serial(async()=>{if(this.state)return false;this.state=createRoom(code,Date.now());await this.save();this.startTimer();return true;});
  }
  async fetch(request:Request) {
    if(!this.state)return Response.json({error:"Room not found."},{status:404});
    if(this.ctx.getWebSockets().length>=12)return Response.json({error:"Too many room connections."},{status:429});
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    const now=Date.now();this.ctx.acceptWebSocket(server);
    server.serializeAttachment({seat:null,connectionId:crypto.randomUUID(),cursor:0,ping:"",pingAt:0,lastSeen:now,rateAt:now,rateCount:0} satisfies Attachment);
    server.send(JSON.stringify({type:"connected"}));this.startTimer();
    return new Response(null,{status:101,webSocket:client});
  }
  async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer) {
    const receivedAt=Date.now();
    return this.serial(async()=>{
      try{
        if(!this.state)throw Error("Room expired.");
        const a=ws.deserializeAttachment() as Attachment;
        if(typeof message!=="string" || message.length>4096)throw Error("Invalid message size.");
        if(receivedAt-a.rateAt>10000){a.rateAt=receivedAt;a.rateCount=0;}
        if(++a.rateCount>60)throw Error("Too many messages. Please wait.");
        a.lastSeen=receivedAt;ws.serializeAttachment(a);
        const m=JSON.parse(message);
        if(m.type==="pong"){
          if(m.nonce===a.ping){
            const rtt=receivedAt-a.pingAt;
            this.send(ws,{type:"clock",serverNow:receivedAt,rtt});
            if(a.seat!==null && this.state.status==="playing" && this.state.pausedAt===null)addLog(this.state.game,"Connection sample.","network_sample",{player:this.state.seats[a.seat]?.name,rttMs:rtt},receivedAt);
            a.ping="";ws.serializeAttachment(a);
          }
          return;
        }
        if(m.type==="join"){
          if(a.seat!==null)throw Error("Already joined.");
          if(typeof m.name!=="string" || (m.token!==undefined && (typeof m.token!=="string" || !/^[a-f0-9]{64}$/.test(m.token))))throw Error("Invalid name or reconnect token.");
          const token=m.token??Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
          const hash=await tokenHash(token);
          if(m.token && !this.state.seats.some(s=>s?.tokenHash===hash && !s.bot))throw Error("Your saved seat is no longer available.");
          a.seat=joinRoom(this.state,m.name,hash,a.connectionId,receivedAt);a.cursor=0;ws.serializeAttachment(a);
          for(const other of this.ctx.getWebSockets()){if(other===ws)continue;const old=other.deserializeAttachment() as Attachment;if(old.seat===a.seat)other.close(1000,"Reconnected in another tab");}
          await this.save();
          this.send(ws,{type:"joined",seat:a.seat,token,nextSequence:this.state.seats[a.seat]!.lastSequence+1});
          this.broadcast();return;
        }
        if(a.seat===null || this.state.seats[a.seat]?.connectionId!==a.connectionId)throw Error("Join the room first.");
        if(m.type==="log"){
          this.send(ws,{type:"log",data:{sessionId:this.state.game.sessionId,room:this.state.code,rulesVersion:"multiplayer-1",timingPolicy:"server receipt order; no compensation",goal:this.state.goal,completedGames:this.state.game.completedGames,game:this.state.game}});return;
        }
        // Identity is derived only from the authenticated connection, never the payload.
        const c=m as Command;
        const result=command(this.state,a.seat,c,Math.max(receivedAt,this.state.game.lastTick));
        await this.save();this.send(ws,{type:"result",sequence:c.sequence,...result});this.broadcast();
      }catch(error){this.send(ws,{type:"error",error:error instanceof Error?error.message:"Request failed."});}
    });
  }
  async webSocketClose(ws:WebSocket) {
    return this.serial(async()=>{if(!this.state)return;const a=ws.deserializeAttachment() as Attachment;if(a?.seat!==null && a?.seat!==undefined){disconnect(this.state,a.seat,a.connectionId,Date.now());await this.save();this.broadcast();}});
  }
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
  async alarm(){await this.pump();}
  private startTimer(){if(!this.timer && this.ctx.getWebSockets().length)this.timer=setInterval(()=>{void this.pump().catch(()=>{});},100);}
  private async pump() {
    const scheduledAt=Date.now();
    return this.serial(async()=>{
      const s=this.state;if(!s)return;const now=Math.max(scheduledAt,s.game.lastTick);
      if(now>=s.expiresAt){if(this.timer)clearInterval(this.timer);this.timer=null;for(const ws of this.ctx.getWebSockets())ws.close(1001,"Room expired");await this.ctx.storage.deleteAll();this.state=null;return;}
      const count=s.game.log.length;
      for(const ws of this.ctx.getWebSockets()){
        const a=ws.deserializeAttachment() as Attachment;
        if(now-a.lastSeen>20000){ws.close(1001,"Connection timed out");if(a.seat!==null)disconnect(s,a.seat,a.connectionId,now);continue;}
        if(now-a.pingAt>=5000){a.ping=crypto.randomUUID();a.pingAt=now;ws.serializeAttachment(a);this.send(ws,{type:"ping",nonce:a.ping});}
      }
      if(!this.ctx.getWebSockets().length){
        for(const seat of s.seats)if(seat && !seat.bot && seat.connected)disconnect(s,seat.id,seat.connectionId,now);
        if(this.timer)clearInterval(this.timer);this.timer=null;
      }
      tick(s,now);
      if(s.game.log.length!==count || (s.status==="playing" && s.pausedAt===null && now-this.lastSave>=1000))await this.save();
      if(s.status==="playing" || s.game.log.length!==count)this.broadcast();
    });
  }
  private async save(){if(!this.state)return;await this.ctx.storage.put("state",this.state);this.lastSave=Date.now();await this.ctx.storage.setAlarm(this.state.status==="playing" && this.state.pausedAt===null?Date.now()+1000:this.state.expiresAt);}
  private send(ws:WebSocket,value:unknown){try{ws.send(JSON.stringify(value));}catch{}}
  private broadcast() {
    const s=this.state;if(!s)return;
    for(const ws of this.ctx.getWebSockets()){
      const a=ws.deserializeAttachment() as Attachment;if(a.seat===null || s.seats[a.seat]?.connectionId!==a.connectionId)continue;
      const {log,...game}=s.game;
      this.send(ws,{type:"snapshot",serverNow:Date.now(),room:roomView(s),game,events:log.slice(a.cursor).map((e,i)=>({...e,eventId:a.cursor+i+1})),eventStart:a.cursor,eventCount:log.length});
      a.cursor=log.length;ws.serializeAttachment(a);
    }
  }
}
async function tokenHash(token:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,"0")).join("");}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==="/api/smash/health")return Response.json({ok:true,service:"smash-room",protocolVersion:1,rulesVersion:"timed-shield-1"});
    if(url.pathname==="/api/smash/rooms" && request.method==="POST"){
      if(request.headers.get("Origin") && request.headers.get("Origin")!==url.origin)return new Response("Wrong origin",{status:403});
      for(let i=0;i<8;i++){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",code=Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>alphabet[b%32]).join("");if(await env.GAME_ROOMS.getByName(code).initialize(code))return Response.json({code},{status:201});}
      return Response.json({error:"Please retry creating a room."},{status:503});
    }
    const match=/^\/api\/smash\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    if(match && request.method==="GET" && CODE.test(match[1])){
      if(request.headers.get("Origin")!==url.origin)return new Response("Wrong origin",{status:403});
      if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("WebSocket required",{status:426});
      return env.GAME_ROOMS.getByName(match[1]).fetch(request);
    }
    if(url.pathname.startsWith("/api/"))return new Response("Not found",{status:404});
    if(url.pathname==="/" || url.pathname==="/smash/" || url.pathname==="/smash" || /^\/smash\/room\/[A-HJ-NP-Z2-9]{6}\/?$/.test(url.pathname))return env.ASSETS.fetch(new Request(new URL("/smash/index.html",url),request));
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
