import React,{useCallback,useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import GameTable from "../app/game-table";
import type {Game} from "../shared/engine";
import type {RoomView} from "./room";
import "../app/globals.css";
import "./lobby.css";

type Snapshot={room:RoomView;game:Game;serverNow:number};
function App(){
  const [name,setName]=useState(()=>localStorage.getItem("smash-name")??"");
  const [code,setCode]=useState(()=>/^\/smash\/room\/([A-HJ-NP-Z2-9]{6})\/?$/.exec(location.pathname)?.[1]??new URL(location.href).searchParams.get("room")??"");
  const [active,setActive]=useState(""),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[seat,setSeat]=useState<number|null>(null);
  const [error,setError]=useState(""),[connected,setConnected]=useState(false),[epoch,setEpoch]=useState(0),[now,setNow]=useState(Date.now()),[rtt,setRtt]=useState<number|null>(null);
  const socket=useRef<WebSocket|null>(null),sequence=useRef(1),current=useRef(snapshot),clockOffset=useRef(0),latency=useRef(0);
  current.current=snapshot;
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()+clockOffset.current),50);return()=>clearInterval(t);},[]);
  useEffect(()=>{
    if(!active)return;
    let stopped=false,retry:ReturnType<typeof setTimeout>,attempt=0;
    const connect=()=>{
      const ws=new WebSocket(location.origin.replace(/^http/,"ws")+"/api/smash/rooms/"+active+"/ws");socket.current=ws;
      // Each connection begins with a full authoritative snapshot.
      let log:Game["log"]=[];
      ws.onmessage=e=>{
        const m=JSON.parse(e.data);
        if(m.type==="connected"){ws.send(JSON.stringify({type:"join",name,token:localStorage.getItem("smash-seat-"+active)??undefined}));}
        else if(m.type==="joined"){localStorage.setItem("smash-seat-"+active,m.token);sequence.current=m.nextSequence;setSeat(m.seat);attempt=0;setError("");}
        else if(m.type==="ping")ws.send(JSON.stringify({type:"pong",nonce:m.nonce}));
        else if(m.type==="clock"){latency.current=m.rtt;setRtt(m.rtt);clockOffset.current=m.serverNow+m.rtt/2-Date.now();}
        else if(m.type==="snapshot"){
          if(m.eventStart!==log.length){setError("Resynchronizing room events…");ws.close();return;}
          const firstSnapshot=m.eventStart===0;
          log=[...log,...m.events];
          clockOffset.current=m.serverNow+latency.current/2-Date.now();
          setSnapshot({room:m.room,game:{...m.game,log},serverNow:m.serverNow});
          if(firstSnapshot){setConnected(true);setEpoch(x=>x+1);}
        }
        else if(m.type==="error" || (m.type==="result" && !m.ok)){setError(m.error??"Action rejected.");}
        else if(m.type==="log"){
          const url=URL.createObjectURL(new Blob([JSON.stringify(m.data,null,2)],{type:"application/json"})),a=document.createElement("a");
          a.href=url;a.download="smash-room-"+active+".json";a.click();URL.revokeObjectURL(url);
        }
      };
      ws.onclose=e=>{setConnected(false);if(!stopped && e.reason!=="Reconnected in another tab")retry=setTimeout(connect,Math.min(10000,500*2**attempt++));else if(e.reason)setError(e.reason);};
      ws.onerror=()=>setError("Connection interrupted. Reconnecting…");
    };
    connect();return()=>{stopped=true;clearTimeout(retry);socket.current?.close();};
  },[active]);
  const send=useCallback((type:string,extra:Record<string,unknown>={})=>{
    if(socket.current?.readyState!==WebSocket.OPEN || !current.current)return;
    setError("");socket.current.send(JSON.stringify({type,sequence:sequence.current++,gameNumber:current.current.game.gameNumber,...extra}));
  },[]);
  const enter=(room:string)=>{if(!name.trim()){setError("Enter your name first.");return;}localStorage.setItem("smash-name",name.trim());setError("");setActive(room);history.replaceState(null,"","/smash/room/"+room);};
  const create=async()=>{if(!name.trim()){setError("Enter your name first.");return;}try{const response=await fetch("/api/smash/rooms",{method:"POST"});const data=await response.json() as {code:string;error?:string};if(!response.ok)throw Error(data.error);setCode(data.code);enter(data.code);}catch(e){setError(e instanceof Error?e.message:"Could not create a room.");}};
  const isHost=snapshot?.room.host===seat;
  return <>
    <div className="room-bar"><b>SMASH FOR CASH · HUMAN PLAYTEST</b>{active&&<span>Room {active} · {connected?"Connected":"Connecting…"}{rtt!==null?" · "+rtt+" ms":""}</span>}{active&&<button onClick={()=>{setActive("");setSnapshot(null);setSeat(null);history.replaceState(null,"","/smash/");}}>Leave room</button>}</div>
    {error&&<div className="room-error" role="alert">{error}</div>}
    {!active?<section className="room-lobby"><h1>Play with friends</h1><p>Invite friends and fill any remaining seats with bots.</p><label>Your name<input maxLength={24} value={name} onChange={e=>setName(e.target.value)}/></label><button onClick={create}>Create room</button><label>Room code<input maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/></label><button disabled={!/^[A-HJ-NP-Z2-9]{6}$/.test(code)} onClick={()=>enter(code)}>Join room</button></section>:
    !snapshot || seat===null?<section className="room-lobby"><h1>Joining room {active}…</h1></section>:
    snapshot.room.status==="lobby"?<section className="room-lobby"><h1>Room {active}</h1><button onClick={()=>navigator.clipboard.writeText(location.href).then(()=>setError("Invite link copied."),()=>setError("Copy the link from your address bar."))}>Copy invite link</button><p>Four seats · First to $200 · One human with bots is enough</p><div className="room-seats">{snapshot.room.seats.map((p,i)=><div key={i}><b>{p?.name??"Open seat"}</b><span>{p?p.bot?"Bot":p.connected?p.ready?"Ready":"Choosing…":"Disconnected":"Invite a friend"}</span></div>)}</div><button onClick={()=>send("ready",{value:!snapshot.room.seats[seat]?.ready})}>{snapshot.room.seats[seat]?.ready?"Not ready":"I'm ready"}</button>{isHost&&<><button onClick={()=>send("bots",{value:!snapshot.room.seats.some(p=>p?.bot)})}>{snapshot.room.seats.some(p=>p?.bot)?"Remove bots":"Fill empty seats with bots"}</button><button onClick={()=>send("start")}>Continue to game</button></>}</section>:
    <><div className="room-status">{snapshot.room.pausedAt!==null&&<span>{snapshot.room.pauseReason} · {isHost?"Resume when everyone is connected.":"The host will resume."}</span>}{isHost&&snapshot.room.seats.filter(p=>p&&!p.connected&&!p.bot).map(p=><button key={p!.id} onClick={()=>send("replace",{target:p!.id})}>Replace {p!.name} with a bot</button>)}</div><GameTable key={active+":"+epoch+":"+snapshot.game.gameNumber} remote={{game:snapshot.game,goal:snapshot.room.goal,seat,now:snapshot.room.pausedAt??now,pausedAt:snapshot.room.pausedAt,isHost:!!isHost,connected,started:snapshot.game.startedAt!==null,send,downloadLog:()=>socket.current?.send(JSON.stringify({type:"log"}))}}/></>}
  </>;
}
createRoot(document.getElementById("root")!).render(<App/>);
