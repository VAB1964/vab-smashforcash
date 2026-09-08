import test from "node:test";
import assert from "node:assert/strict";
import {Miniflare} from "miniflare";

test("real room sockets join, reject impersonation, share events, and reconnect", {timeout:20000}, async()=>{
 const mf=new Miniflare({modules:true,scriptPath:"multiplayer-worker-dist/worker.js",compatibilityDate:"2026-05-22",durableObjects:{GAME_ROOMS:{className:"GameRoom",useSQLite:true}},serviceBindings:{ASSETS:request=>new Response(new URL(request.url).pathname)}});
 const sockets=[];
 try{
  for(const path of ["/smash/","/smash/room/ABCDEF"]){
   const response=await mf.dispatchFetch("http://localhost"+path);
   assert.equal(await response.text(),"/smash/index.html");
  }
  assert.equal((await (await mf.dispatchFetch("http://localhost/api/smash/health")).json()).ok,true);
  const created=await mf.dispatchFetch("http://localhost/api/smash/rooms",{method:"POST",headers:{Origin:"http://localhost"}});
  assert.equal(created.status,201);const {code}=await created.json();
  async function connect(name,token){
   const r=await mf.dispatchFetch("http://localhost/api/smash/rooms/"+code+"/ws",{headers:{Upgrade:"websocket",Origin:"http://localhost"}});
   assert.equal(r.status,101);const ws=r.webSocket;ws.accept();sockets.push(ws);
   const messages=[];ws.addEventListener("message",e=>{const m=JSON.parse(e.data);messages.push(m);if(m.type==="ping")ws.send(JSON.stringify({type:"pong",nonce:m.nonce}));});
   const until=async predicate=>{const stop=Date.now()+4000;while(Date.now()<stop){const m=messages.find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,10));}throw Error("Timed out: "+messages.map(x=>x.type).join(","));};
   ws.send(JSON.stringify({type:"join",name,token}));
   const joined=await until(m=>m.type==="joined");
   return{ws,messages,until,joined};
  }
  const a=await connect("Vince"),b=await connect("Andrea");
  a.ws.send(JSON.stringify({type:"ready",value:true,sequence:1,gameNumber:1}));
  b.ws.send(JSON.stringify({type:"ready",value:true,sequence:1,gameNumber:1}));
  await a.until(m=>m.type==="result"&&m.sequence===1);await b.until(m=>m.type==="result"&&m.sequence===1);
  a.ws.send(JSON.stringify({type:"bots",value:true,sequence:2,gameNumber:1}));
  await a.until(m=>m.type==="result"&&m.sequence===2);
  a.ws.send(JSON.stringify({type:"start",sequence:3,gameNumber:1}));
  await a.until(m=>m.type==="snapshot"&&m.room.status==="playing");
  b.ws.send(JSON.stringify({type:"pause",playerId:0,sequence:2,gameNumber:1}));
  assert.equal((await b.until(m=>m.type==="result"&&m.sequence===2)).ok,false);
  a.ws.send(JSON.stringify({type:"press",action:"shield",sequence:4,gameNumber:1}));
  const first=await a.until(m=>m.type==="snapshot"&&m.events.some(e=>e.type==="shield_armed"));
  const second=await b.until(m=>m.type==="snapshot"&&m.events.some(e=>e.type==="shield_armed"));
  assert.deepEqual(first.events.find(e=>e.type==="shield_armed"),second.events.find(e=>e.type==="shield_armed"));
  b.ws.close(1000,"test disconnect");
  await a.until(m=>m.type==="snapshot"&&m.room.pausedAt!==null);
  const back=await connect("Andrea",b.joined.token);
  assert.equal(back.joined.seat,b.joined.seat);
  a.ws.send(JSON.stringify({type:"log"}));
  const log=await a.until(m=>m.type==="log");
  assert.equal(JSON.stringify(log.data).includes(b.joined.token),false);
 }finally{for(const ws of sockets)try{ws.close();}catch{}await mf.dispose();}
});
