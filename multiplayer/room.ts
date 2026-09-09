import { initialGame, advanceRoom, press, chooseBot, botCashOpportunity, isLast, addLog, summarizeGame, resumeAfterPause, type Game, type ActionId } from "../shared/engine.ts";

export type Seat = { id:number; name:string; bot:boolean; ready:boolean; connected:boolean; tokenHash:string; connectionId:string; lastSequence:number; lastResult:Result|null };
export type Result = { ok:boolean; error?:string };
export type Command = { sequence:number; gameNumber:number; type:"ready"|"bots"|"start"|"begin"|"pause"|"resume"|"rematch"|"press"|"replace"; action?:ActionId; target?:number; value?:boolean };
export type RoomState = { code:string; goal:number; host:number; status:"lobby"|"playing"|"complete"; pausedAt:number|null; pauseReason:string; seats:(Seat|null)[]; game:Game; sequence:number; revision:number; expiresAt:number; plans:Record<number,{at:number;key:string}> };
export const ROOM_TTL = 24*60*60*1000;
const ACTIONS = ["smash","double","lockdown","steal","good","shield"];
const styles = ["Aggressive","Aggressive","Cautious","Trickster"];

export function createRoom(code:string, now:number):RoomState {
  return {code,goal:200,host:0,status:"lobby",pausedAt:null,pauseReason:"",seats:[null,null,null,null],game:initialGame(now, "room-"+code+"-"+now),sequence:0,revision:0,expiresAt:now+ROOM_TTL,plans:{}};
}
export function joinRoom(s:RoomState,name:string,tokenHash:string,connectionId:string,now:number):number {
  let seat=s.seats.find(p=>p?.tokenHash===tokenHash && !p.bot);
  if(!seat) {
    if(s.status!=="lobby")throw Error("This game has started. Rejoin with your original browser.");
    const id=s.seats.findIndex(p=>!p);if(id<0)throw Error("The room is full.");
    name=name.trim();if(!name || name.length>24)throw Error("Use a name with 1–24 characters.");
    if(s.seats.some(p=>p?.name.toLowerCase()===name.toLowerCase()))throw Error("That name is already in this room.");
    seat={id,name,tokenHash,connectionId,bot:false,ready:false,connected:true,lastSequence:0,lastResult:null};
    s.seats[id]=seat;
  }
  seat.connected=true;seat.connectionId=connectionId;
  if(!s.seats[s.host]?.connected)s.host=seat.id;
  s.revision++;s.expiresAt=now+ROOM_TTL;
  addLog(s.game, seat.name+" joined the room.","player_connected",{player:seat.name},now);
  return seat.id;
}
export function disconnect(s:RoomState,id:number,connectionId:string,now:number) {
  const seat=s.seats[id];if(!seat || seat.connectionId!==connectionId)return;
  tick(s,now,()=>.5);seat.connected=false;
  if(s.status==="playing" && s.game.startedAt!==null && s.pausedAt===null){s.pausedAt=now;s.pauseReason=seat.name+" disconnected";s.plans={};}
  if(s.host===id){const successor=s.seats.find(p=>p && !p.bot && p.connected);if(successor)s.host=successor.id;}
  addLog(s.game,seat.name+" disconnected. "+(s.status==="playing"?"The game is paused.":""),"player_disconnected",{player:seat.name},now);s.revision++;
}
function configurePlayers(s:RoomState) {
  s.game.players.forEach((p,id)=>{const seat=s.seats[id]!;p.name=seat.name;p.approach=seat.bot?styles[id]:"Human";p.latency=0;});
}
export function tick(s:RoomState,now:number,random=Math.random) {
  if(s.status!=="playing" || s.game.startedAt===null || s.pausedAt!==null)return;
  s.game=advanceRoom(s.game,now,s.goal);
  if(s.game.winner!==null){s.status="complete";s.plans={};s.revision++;return;}
  if(s.game.lockdownUntil>now){s.plans={};return;}
  for(const seat of s.seats) {
    if(!seat?.bot)continue;
    const p=s.game.players[seat.id],op=botCashOpportunity(p,s.game,s.goal);
    const key=[p.cooldowns.smash<=now,p.shielded,op.trailing,s.game.pot/s.goal>=op.threshold,s.game.pot+p.stash>=s.goal,isLast(p,s.game.players),p.cooldowns.double<=now,s.game.lockdownUntil,s.game.players.filter(x=>x.armed.steal?.targetId===p.id).map(x=>x.id).join(",")].join("|");
    const plan=s.plans[p.id];
    if(!plan || plan.key!==key){s.plans[p.id]={key,at:now+(p.approach==="Cautious"?500:p.approach==="Trickster"?400:300)+random()*650};continue;}
    if(plan.at>now)continue;
    plan.at=now+900+random()*500;
    const pick=chooseBot(p,s.game,s.goal,now,random);
    if(pick)s.game=press(s.game,p.id,pick.action,pick.target,now,++s.sequence,s.goal,pick);
    if(s.game.lockdownUntil>now){s.plans={};break;}
  }
  s.revision++;
}
export function command(s:RoomState,seatId:number,c:Command,now:number):Result {
  const seat=s.seats[seatId];if(!seat || seat.bot || !seat.connected)return{ok:false,error:"Join the room first."};
  if(!Number.isSafeInteger(c.sequence) || c.sequence<1)return{ok:false,error:"Invalid command sequence."};
  if(c.sequence===seat.lastSequence && seat.lastResult)return seat.lastResult;
  if(c.sequence<=seat.lastSequence)return{ok:false,error:"This command was already processed."};
  const fail=(error:string):Result=>({ok:false,error});
  // All validation precedes mutation within each command branch.
  let result:Result;
  const execute=():Result=>{
    if(c.gameNumber!==s.game.gameNumber)return fail("This action belongs to an earlier game.");
    const host=seatId===s.host;
    switch(c.type){
      case "ready":
        if(s.status!=="lobby" || typeof c.value!=="boolean")return fail("Readiness can only change in the lobby.");
        seat.ready=c.value;break;
      case "bots":
        if(!host || s.status!=="lobby" || typeof c.value!=="boolean")return fail("Only the host can change bot seats in the lobby.");
        if(!c.value)s.seats=s.seats.map(p=>p?.bot?null:p);
        else s.seats=s.seats.map((p,id)=>p??({id,name:["Jasper","Arthur","Mabel","Clara"][id]+(s.seats.some(x=>x?.name===["Jasper","Arthur","Mabel","Clara"][id])?" Bot":""),bot:true,ready:true,connected:true,tokenHash:"",connectionId:"",lastSequence:0,lastResult:null}));
        break;
      case "start":
        if(!host || s.status!=="lobby")return fail("Only the host can start from the lobby.");
        if(s.seats.some(p=>!p || !p.ready || !p.connected) || s.seats.filter(p=>p && !p.bot).length<1)return fail("At least one human must join. Fill empty seats with bots and have everyone ready.");
        configurePlayers(s);s.status="playing";break;
      case "begin":
        if(!host || s.status!=="playing" || s.game.startedAt!==null)return fail("Only the host can start the game.");
        s.game.startedAt=now;s.game.lastTick=now;
        addLog(s.game,"The room game started.","game_start",{goal:s.goal,timingPolicy:"server receipt order; no latency compensation",rulesVersion:"multiplayer-1"},now);break;
      case "press":
        if(s.status!=="playing" || s.game.startedAt===null || s.pausedAt!==null)return fail("The game is not running.");
        if(!ACTIONS.includes(c.action??""))return fail("Unknown action.");
        if(["steal","good"].includes(c.action!) && (!Number.isInteger(c.target)||c.target!<0||c.target!>3||c.target===seatId))return fail("Choose another player.");
        s.game=advanceRoom(s.game,now,s.goal);
        s.game=press(s.game,seatId,c.action!,c.target,now,++s.sequence,s.goal);
        if(s.game.winner!==null)s.status="complete";
        { const event=s.game.log.findLast(e=>e.type==="action_press");if(event?.details?.accepted===false)return fail(String(event.details.reason)); }
        break;
      case "pause":
        if(!host || s.status!=="playing" || s.game.startedAt===null || s.pausedAt!==null)return fail("Only the host can pause an active game.");
        s.game=advanceRoom(s.game,now,s.goal);
        if(s.game.winner!==null){s.status="complete";return fail("The game has ended.");}
        s.pausedAt=now;s.pauseReason="Host paused the game";s.plans={};
        addLog(s.game,s.pauseReason,"game_paused",{actor:seat.name},now);break;
      case "resume":
        if(!host || s.pausedAt===null)return fail("Only the host can resume.");
        if(s.seats.some(p=>p && !p.bot && !p.connected))return fail("Wait for disconnected players or replace them with bots.");
        s.game=resumeAfterPause(s.game,s.pausedAt,now);s.pausedAt=null;s.pauseReason="";s.plans={};break;
      case "replace":
        if(!host || !Number.isInteger(c.target)||c.target!<0||c.target!>3)return fail("Only the host can replace a disconnected player.");
        {const target=s.seats[c.target!];if(!target || target.connected || target.bot)return fail("That player is not disconnected.");
        target.bot=true;target.tokenHash="";target.connected=true;target.ready=true;s.game.players[target.id].approach=styles[target.id];}break;
      case "rematch":
        if(!host || s.status!=="complete")return fail("Only the host can return to the lobby after a completed game.");
        {const summary=summarizeGame(s.game,s.goal,now,"completed");s.game=initialGame(now,s.game.sessionId,s.game.gameNumber+1,s.game.log,[...s.game.completedGames,summary]);}
        s.status="lobby";s.pausedAt=null;s.plans={};s.seats.forEach(p=>{if(p)p.ready=p.bot;});break;
      default:return fail("Unknown room command.");
    }
    return {ok:true};
  };
  result=execute();seat.lastSequence=c.sequence;seat.lastResult=result;s.revision++;s.expiresAt=now+ROOM_TTL;return result;
}
export function roomView(s:RoomState) {
  return {code:s.code,goal:s.goal,host:s.host,status:s.status,pausedAt:s.pausedAt,pauseReason:s.pauseReason,revision:s.revision,seats:s.seats.map(p=>p?{id:p.id,name:p.name,bot:p.bot,ready:p.ready,connected:p.connected}:null)};
}
export type RoomView=ReturnType<typeof roomView>;
