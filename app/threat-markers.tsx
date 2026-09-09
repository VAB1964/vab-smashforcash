import { Banknote, HandHeart } from "lucide-react";
import type { CSSProperties } from "react";
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
    {threats.map((threat,index)=>{const Icon=threat.type==="steal"?Banknote:HandHeart;return <span className={`incoming-marker ${threat.type}-marker`} key={threat.key} title={threat.title} style={{"--threat-index":index} as CSSProperties}><Icon size={14}/><i><b style={{width:Math.min(100,threat.remaining/15000*100)+"%"}}/><span>{(threat.remaining/1000).toFixed(1)}s</span></i></span>;})}
  </div>;
}
