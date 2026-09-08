import { Banknote, HandHeart } from "lucide-react";
type Player = { id: number; name: string; armed: { steal: {targetId:number; expiresAt:number} | null } };
type Drain = { ownerId:number; targetId:number; nextTick:number; remaining:number };
const COLORS = ["#67ec67","#3bcaf5","#a47aff","#ff6f70"];
export default function ThreatMarkers({players,drains,targetId,now}:{players:Player[];drains:Drain[];targetId:number;now:number}) {
  const steals = players.filter(p=>p.armed.steal?.targetId===targetId);
  const active = drains.filter(d=>d.targetId===targetId);
  return <div className="incoming-markers" aria-label="Incoming threats">
    {!steals.length && !active.length && <span className="no-markers">No incoming threats</span>}
    {steals.map(p=>{const remaining=Math.max(0,p.armed.steal!.expiresAt-now);return <span className="incoming-marker steal-marker" key={p.id} title={p.name+"'s Steal can take the next payout until it expires"} style={{borderColor:COLORS[p.id]}}><Banknote size={14}/>{p.name} · STEAL { (remaining/1000).toFixed(1)}s<i style={{width:Math.min(100,remaining/15000*100)+"%"}}/></span>;})}
    {active.map(d=>{const remaining=Math.max(0,d.nextTick-now)+(d.remaining-1)*3000;return <span className="incoming-marker drain-marker" key={d.ownerId} title="Greater Good drains stored cash; it does not steal a payout" style={{borderColor:COLORS[d.ownerId]}}><HandHeart size={14}/>{players[d.ownerId].name} · DRAIN {(remaining/1000).toFixed(1)}s<i style={{width:Math.min(100,remaining/15000*100)+"%"}}/></span>;})}
  </div>;
}
