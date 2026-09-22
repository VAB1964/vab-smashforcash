import type { CSSProperties } from "react";
import { PowerUpMeter } from "./power-up-icons";
type Player = { id: number; name: string; armed: { steal: {targetId:number; expiresAt:number} | null } };
type Drain = { ownerId:number; targetId:number; nextTick:number; remaining:number };
export default function ThreatMarkers({players,drains,targetId,now}:{players:Player[];drains:Drain[];targetId:number;now:number}) {
  const threats = [
    ...players.filter(p=>p.armed.steal?.targetId===targetId).map(p => ({
      key: `steal-${p.id}`, type: "steal" as const, ownerId: p.id,
      remaining: Math.max(0,p.armed.steal!.expiresAt-now),
      title: `${p.name}'s Steal can take the next payout until it expires`,
    })),
    ...drains.filter(d=>d.targetId===targetId).map(d => ({
      key: `drain-${d.ownerId}`, type: "drain" as const, ownerId: d.ownerId,
      remaining: Math.max(0,d.nextTick-now)+(d.remaining-1)*3000,
      title: `${players[d.ownerId].name}'s Greater Good drains stored cash`,
    })),
  ].sort((a,b)=>a.remaining-b.remaining);

  return <div className="incoming-markers" aria-label="Incoming threats">
    {threats.map((threat,index)=><span className={`incoming-marker ${threat.type}-marker`} key={threat.key} title={`${threat.title}. ${(threat.remaining/1000).toFixed(1)} seconds remaining.`} aria-label={`${threat.title}. ${(threat.remaining/1000).toFixed(1)} seconds remaining.`} role="img" style={{"--threat-index":index} as CSSProperties}><PowerUpMeter type={threat.type==="steal"?"steal":"good"} progress={threat.remaining/15000} size={30}/></span>)}
  </div>;
}
