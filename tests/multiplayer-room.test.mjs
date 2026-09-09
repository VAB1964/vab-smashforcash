import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,command,tick,disconnect,roomView} from "../multiplayer/room.ts";
import {advanceRoom,initialGame,press} from "../shared/engine.ts";
function readyRoom(){
 const s=createRoom("ABCDEF",1000);
 for(let id=0;id<4;id++){assert.equal(joinRoom(s,"P"+id,"token"+id,"conn"+id,1000),id);assert.equal(command(s,id,{type:"ready",value:true,sequence:1,gameNumber:1},1000).ok,true);}
 assert.equal(command(s,0,{type:"start",sequence:2,gameNumber:1},1000).ok,true);
 s.game.startedAt=1000;s.game.lastTick=1000;
 return s;
}
test("one human can start a game with three bots",()=>{
 const s=createRoom("SOLO01",1000);
 assert.equal(joinRoom(s,"Solo","token0","conn0",1000),0);
 assert.equal(command(s,0,{type:"bots",value:true,sequence:1,gameNumber:1},1000).ok,true);
 assert.equal(command(s,0,{type:"ready",value:true,sequence:2,gameNumber:1},1000).ok,true);
 assert.equal(command(s,0,{type:"start",sequence:3,gameNumber:1},1000).ok,true);
 assert.equal(s.status,"playing");
 assert.equal(s.game.startedAt,null);
 assert.equal(s.seats.filter(p=>p&&!p.bot).length,1);
 assert.equal(s.seats.filter(p=>p?.bot).length,3);
});
test("simultaneous presses use receipt order; duplicate command does not add a second claim",()=>{
 const s=readyRoom();
 const a={type:"press",action:"smash",sequence:3,gameNumber:1};
 assert.equal(command(s,0,a,2000).ok,true);
 assert.equal(command(s,0,a,2010).ok,true);
 assert.equal(command(s,1,{...a,sequence:2},2100).ok,true);
 assert.equal(s.game.claims.length,2);
 tick(s,5000);
 assert.equal(s.game.players[0].stash,14.45);
 assert.equal(s.game.players[1].stash,0);
 assert.equal(s.game.log.filter(e=>e.type==="payout").length,1);
 assert.equal(s.game.log.find(e=>e.type==="payout").at,2225);
 assert.equal(command(s,0,{...a,sequence:1},6000).ok,false);
});
test("disconnect pauses all timers; reconnect retains identity; stale socket close cannot disconnect new socket",()=>{
 const s=readyRoom();command(s,0,{type:"press",action:"smash",sequence:3,gameNumber:1},2000);
 disconnect(s,1,"conn1",2100);tick(s,10000);assert.equal(s.game.claims.length,1);
 assert.equal(joinRoom(s,"P1","token1","newconn",10000),1);
 disconnect(s,1,"conn1",10001);assert.equal(s.seats[1].connected,true);
 assert.equal(command(s,0,{type:"resume",sequence:4,gameNumber:1},10000).ok,true);
 tick(s,11000);assert.equal(s.game.log.find(e=>e.type==="payout").at,10125);
 assert.equal(s.game.players[0].stash,14.45);
});
test("host controls and new game IDs prevent unauthorized changes",()=>{
 const s=readyRoom();
 assert.equal(command(s,1,{type:"pause",sequence:2,gameNumber:1},2000).ok,false);
 assert.equal(command(s,1,{type:"press",action:"steal",target:8,sequence:3,gameNumber:1},2000).ok,false);
 s.game.players[0].stash=199;command(s,0,{type:"press",action:"smash",sequence:3,gameNumber:1},2000);tick(s,2300);
 assert.equal(s.status,"complete");
 assert.equal(command(s,0,{type:"rematch",sequence:4,gameNumber:1},3000).ok,true);
 assert.equal(s.game.completedGames[0].endedAt,2225);
 assert.equal(command(s,0,{type:"press",action:"smash",sequence:5,gameNumber:1},4000).ok,false);
 assert.equal(s.game.gameNumber,2);
 assert.equal(JSON.stringify(roomView(s)).includes("token0"),false);
});
test("late wake follows cap and drain deadlines instead of folding elapsed time into one pot",()=>{
 let g=initialGame(1000);g.startedAt=1000;
 g=advanceRoom(g,101000,200);
 assert.equal(g.players[0].stash,50);
 assert.ok(Math.abs(g.pot-12)<.001);
 const s=readyRoom();s.game.players[1].stash=20;
 command(s,0,{type:"press",action:"good",target:1,sequence:3,gameNumber:1},2000);
 command(s,2,{type:"press",action:"smash",sequence:2,gameNumber:1},2100);
 tick(s,10000);
 const e=s.game.log.filter(e=>["payout","greater_good_tick"].includes(e.type));
 assert.deepEqual(e.map(x=>x.at),[2325,5000,8000]);
});
test("Lockdown clears attacks and cancels pending claims",()=>{
 const s=readyRoom();
 command(s,0,{type:"press",action:"steal",target:1,sequence:3,gameNumber:1},2000);
 command(s,1,{type:"press",action:"smash",sequence:2,gameNumber:1},2100);
 command(s,2,{type:"press",action:"lockdown",sequence:2,gameNumber:1},2200);
 assert.equal(s.game.claims.length,0);assert.equal(s.game.players[0].armed.steal,null);
 assert.equal(command(s,3,{type:"press",action:"smash",sequence:2,gameNumber:1},8199).ok,false);
 assert.equal(command(s,3,{type:"press",action:"smash",sequence:3,gameNumber:1},8200).ok,true);
 tick(s,8500);assert.ok(s.game.players[3].stash>0);
});
test("Shield protects Double Down's pot and bonus from a banked Steal",()=>{
 const s=readyRoom();s.game.players[1].stash=40;s.game.players[2].stash=30;s.game.players[3].stash=20;
 s.game.players[0].cooldowns.smash=20000;
 command(s,0,{type:"press",action:"shield",sequence:3,gameNumber:1},2000);
 command(s,1,{type:"press",action:"steal",target:0,sequence:2,gameNumber:1},2100);
 command(s,0,{type:"press",action:"double",sequence:4,gameNumber:1},2200);
 tick(s,2600);
 assert.ok(Math.abs(s.game.players[0].stash-29.7)<.000001);
 assert.equal(s.game.players[0].shielded,true);
 assert.equal(s.game.players[1].stash,40);
 assert.ok(s.game.log.some(e=>e.type==="double_bonus"));
});
