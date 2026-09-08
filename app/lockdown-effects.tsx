"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, HandHeart, Siren, Zap } from "lucide-react";

type Cleared = { owner: string; target: string; action: string };
export default function LockdownEffects({ until, now, paused, actor, cleared, names }: { until: number; now: number; paused: boolean; actor: string; cleared: Cleared[]; names: string[] }) {
  const anchor = useRef<HTMLDivElement>(null), elapsed = useRef(0);
  const [ghosts, setGhosts] = useState<(Cleared & {x:number;y:number;color:string})[]>([]), [sweeping,setSweeping] = useState(true);
  useEffect(() => {
    const cards = anchor.current?.closest(".game-shell")?.querySelectorAll(".player-card");
    const colors = ["#67ec67", "#3bcaf5", "#a47aff", "#ff6f70"];
    setGhosts(cleared.flatMap((c,i) => {
      const rect=cards?.[names.indexOf(c.target)]?.getBoundingClientRect();
      if(!rect)return [];
      const lane=cleared.slice(0,i).filter(x=>x.target===c.target).length;
      return [{...c,x:rect.left+rect.width/2,y:rect.bottom-22-lane*25,color:colors[names.indexOf(c.owner)]??"#ffd38b"}];
    }));
  }, []);
  useEffect(() => {
    if(!sweeping)return;
    let frame=0,last=performance.now();
    const tick=(stamp:number)=>{if(!paused)elapsed.current+=stamp-last;last=stamp;if(elapsed.current>=1800){setSweeping(false);return;}frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[paused,sweeping]);
  const remaining=Math.max(0,until-now), released=remaining===0;
  return <div ref={anchor} className={`lockdown-show ${paused?"is-paused":""}`}>
    {sweeping && <div className="lockdown-sweep-layer" aria-hidden="true"><div className="lockdown-sweep-beam"/>{ghosts.map((g,i)=><div key={i} className="cleared-threat" style={{left:g.x,top:g.y,color:g.color,animationDelay:`${150+i*60}ms`}}>{g.action==="steal"?<Banknote size={16}/>:<HandHeart size={16}/>}<span>{g.owner} · {g.action==="steal"?"STEAL":"DRAIN"}</span><b>×</b></div>)}</div>}
    {!released ? <div className={`lockdown-countdown ${remaining<=3000?"final-count":""} ${paused?"under-pause":""}`}>
      <div className="lockdown-count-ring" style={{background:`conic-gradient(#ffb16b ${remaining/6000*360}deg, #361b31 0deg)`}}><strong>{Math.ceil(remaining/1000)}</strong></div>
      <div><b><Siren size={17}/> LOCKDOWN</b><span>{actor} cleared {cleared.length} threat{cleared.length===1?"":"s"} · Shields stay</span><small>Pot growing · release in {(remaining/1000).toFixed(1)}s</small></div>
    </div> : !paused && now-until<1400 ? <div className="lockdown-go" role="status"><Zap size={25}/><strong>GO!</strong><span>LOCKDOWN RELEASED</span></div> : null}
  </div>;
}
