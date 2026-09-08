"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, HandHeart, ShieldCheck } from "lucide-react";

type Event = { type: string; details?: Record<string, unknown> };
type Block = { id: number; attacker: string; defender: string; action: string; active: boolean; blocked: boolean; elapsed: number; sounded: boolean };
type View = Block & { x: number; y: number; ax: number; ay: number; attackColor: string; shieldColor: string; reduced: boolean };
const COLORS = ["#67ec67", "#3bcaf5", "#a47aff", "#ff6f70"];
const IMPACT_MS = 600, END_MS = 3100;

export default function ShieldEffects({ events, names, paused, onImpact }: { events: Event[]; names: string[]; paused: boolean; onImpact: () => void }) {
  const cursor = useRef(events.length), serial = useRef(0), blocks = useRef<Block[]>([]), layer = useRef<HTMLDivElement>(null);
  const currentNames = useRef(names), sound = useRef(onImpact);
  currentNames.current = names; sound.current = onImpact;
  const [views, setViews] = useState<View[]>([]);
  useEffect(() => {
    const fresh = events.slice(cursor.current); cursor.current = events.length;
    for (const event of fresh) {
      if (event.type === "lockdown") { blocks.current = blocks.current.filter(b=>b.blocked); continue; }
      const d = event.details;
      const blocked = event.type === "shield_triggered";
      if (!d || !(blocked || event.type === "greater_good_started" || event.type === "action_banked" && d.action === "steal")) continue;
      const defender = String(blocked ? d.defender : d.target), attacker = String(blocked ? d.attacker : d.actor);
      if (!currentNames.current.includes(defender) || !currentNames.current.includes(attacker)) continue;
      const previous = blocks.current.filter(b => b.defender === defender).at(-1);
      const delay = previous ? Math.max(0, 500 - previous.elapsed) : 0;
      blocks.current.push({ id: ++serial.current, attacker, defender, action: (blocked ? d.blockedAction : d.action) === "steal" ? "Steal" : "Greater Good", active: d.remainingPayments !== undefined || d.clearedBanked === true, blocked, elapsed: -delay, sounded: false });
    }
  }, [events]);
  useEffect(() => {
    let frame: number, last = performance.now();
    const draw = (stamp: number) => {
      const dt = stamp - last; last = stamp;
      if (blocks.current.length) {
        const shell = layer.current?.closest(".game-shell"), cards = shell?.querySelectorAll(".player-card");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!paused) blocks.current.forEach(b => {
          b.elapsed += dt;
          if (b.elapsed >= IMPACT_MS && !b.sounded) { b.sounded = true; if (b.blocked) sound.current(); }
        });
        blocks.current = blocks.current.filter(b => b.elapsed < END_MS);
        setViews(blocks.current.flatMap(b => {
          if (b.elapsed < 0) return [];
          const targetId = currentNames.current.indexOf(b.defender), sourceId = currentNames.current.indexOf(b.attacker);
          const target = cards?.[targetId]?.getBoundingClientRect(), source = cards?.[sourceId]?.getBoundingClientRect();
          if (!target || !source) return [];
          const x = target.left + target.width / 2, y = target.bottom + 9;
          const t = reduced ? 1 : Math.min(1, b.elapsed / IMPACT_MS), ease = t * t * (3 - 2 * t);
          return [{ ...b, x, y, ax: source.left + source.width / 2 + (x - source.left - source.width / 2) * ease,
            ay: source.bottom + 9 + (y - source.bottom - 9) * ease + (reduced ? 0 : Math.sin(t * Math.PI) * 35),
            shieldColor: COLORS[targetId], attackColor: COLORS[sourceId], reduced }];
        }));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [paused]);

  return <div ref={layer} className="shield-effects-layer" aria-hidden="true">{views.map(v => {
    const hit = v.elapsed >= IMPACT_MS, burst = Math.min(1, Math.max(0, (v.elapsed - IMPACT_MS) / 450));
    const Attack = v.action === "Steal" ? Banknote : HandHeart;
    return <div key={v.id}>
      {!hit && !v.reduced && <div className="shield-attack-token" style={{ left: v.ax, top: v.ay, color: v.attackColor }}><Attack size={23}/></div>}
      {v.blocked && <div className="shield-impact-icon" style={{ left: v.x, top: v.y, color: v.shieldColor, opacity: hit ? Math.max(0, 1 - (v.elapsed - 1100) / 400) : 1,
        transform: `translate(-50%,-50%) scale(${v.reduced ? 1 : hit ? 1.65 - burst * .45 : .8 + v.elapsed / IMPACT_MS * .5})` }}><ShieldCheck size={40}/></div>}
      {hit && v.blocked && !v.reduced && burst < 1 && Array.from({ length: 6 }, (_, i) => <i key={i} className="shield-fragment" style={{ left: v.x + Math.cos(i * Math.PI / 3) * burst * 46, top: v.y + Math.sin(i * Math.PI / 3) * burst * 34, background: v.attackColor, opacity: 1 - burst, transform: `rotate(${i * 60 + burst * 100}deg)` }}/>) }
      {hit && !v.blocked && <div className="shield-attack-token landed" style={{ left: v.x, top: v.y, color: v.attackColor, opacity: Math.min(1, (END_MS - v.elapsed) / 250) }}><Attack size={23}/></div>}
      {hit && views.filter(x => x.defender === v.defender && x.elapsed >= IMPACT_MS).at(-1)?.id === v.id && <div className="shield-result-caption" style={{ left: Math.max(100, Math.min(window.innerWidth - 100, v.x)), top: v.y + 27, borderColor: v.blocked ? v.shieldColor : v.attackColor, opacity: Math.min(1, (END_MS - v.elapsed) / 250) }}>{v.blocked ? <ShieldCheck size={15} style={{ color: v.shieldColor }}/> : <Attack size={15} style={{color:v.attackColor}}/>}<span>{v.blocked ? <><b>{v.defender}’s Shield</b> {v.active ? "ended" : "stopped"} {v.attacker}’s {v.action}</> : <><b>{v.attacker} → {v.defender}</b><br/>{v.action === "Steal" ? "Steal banked · waiting for a win" : "Greater Good landed · drain started"}</>}</span></div>}
    </div>;
  })}</div>;
}
