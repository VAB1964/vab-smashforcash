"use client";

import { useEffect, useRef, useState } from "react";
import { PowerUpIcon, type PowerUpId } from "./power-up-icons";

type Event = { type: string; details?: Record<string, unknown> };
type Block = { id: number; attacker: string; defender: string; action: string; active: boolean; blocked: boolean; elapsed: number; sounded: boolean };
type View = Block & { x: number; y: number; ax: number; ay: number; attackColor: string; shieldColor: string; reduced: boolean };
const COLORS = ["#67ec67", "#3bcaf5", "#a47aff", "#ff6f70"];
const IMPACT_MS = 600, END_MS = 3100;
const SHARD_CLIPS = ["0 0,52% 0,42% 50%,0 42%", "52% 0,100% 0,100% 40%,58% 52%", "0 44%,42% 52%,48% 100%,0 100%", "58% 54%,100% 42%,100% 100%,50% 100%", "35% 20%,68% 16%,58% 58%,40% 62%", "20% 34%,80% 30%,72% 70%,28% 74%"];

export default function ShieldEffects({ events, names, paused, onImpact }: { events: Event[]; names: string[]; paused: boolean; onImpact: () => void }) {
  const cursor = useRef(events.length), serial = useRef(0), blocks = useRef<Block[]>([]), layer = useRef<HTMLDivElement>(null);
  const currentNames = useRef(names), sound = useRef(onImpact);
  currentNames.current = names; sound.current = onImpact;
  const [views, setViews] = useState<View[]>([]);
  const [announcement, setAnnouncement] = useState("");
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
      if (blocked) setAnnouncement(`${defender}'s Shield ${d.remainingPayments !== undefined || d.clearedBanked === true ? "ended" : "stopped"} ${attacker}'s ${(d.blockedAction === "steal" ? "Steal" : "Greater Good")}.`);
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
          const x = target.left + target.width / 2, y = target.bottom - 22;
          const t = reduced ? 1 : Math.min(1, b.elapsed / IMPACT_MS), ease = t * t * (3 - 2 * t);
          return [{ ...b, x, y, ax: source.left + source.width / 2 + (x - source.left - source.width / 2) * ease,
            ay: source.bottom - 22 + (y - source.bottom + 22) * ease + (reduced ? 0 : Math.sin(t * Math.PI) * 35),
            shieldColor: COLORS[targetId], attackColor: COLORS[sourceId], reduced }];
        }));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, [paused]);

  return <><div ref={layer} className="shield-effects-layer" aria-hidden="true">{views.map(v => {
    const hit = v.elapsed >= IMPACT_MS, burst = Math.min(1, Math.max(0, (v.elapsed - IMPACT_MS) / 450));
    const attackType: PowerUpId = v.action === "Steal" ? "steal" : "good";
    return <div key={v.id}>
      {!hit && !v.reduced && <div className="shield-attack-token" style={{ left: v.ax, top: v.ay, color: v.attackColor }}><PowerUpIcon type={attackType} size={34} title={false}/></div>}
      {v.blocked && <div className="shield-impact-icon" style={{ left: v.x, top: v.y, color: v.shieldColor, opacity: hit ? Math.max(0, 1 - (v.elapsed - 1100) / 400) : 1,
        transform: `translate(-50%,-50%) scale(${v.reduced ? 1 : hit ? 1.65 - burst * .45 : .8 + v.elapsed / IMPACT_MS * .5})` }}><PowerUpIcon type="shield" size={52} title={false}/></div>}
      {hit && v.blocked && !v.reduced && burst < 1 && SHARD_CLIPS.map((clip,i) => <span key={i} className="shield-fragment" style={{ left:v.x,top:v.y,color:v.attackColor,opacity:1-burst,clipPath:`polygon(${clip})`,transform:`translate(-50%,-50%) translate(${Math.cos(i*Math.PI/3)*burst*58}px,${Math.sin(i*Math.PI/3)*burst*44}px) rotate(${i*28+burst*110}deg)` }}><PowerUpIcon type={attackType} size={46} title={false}/></span>)}
      {hit && !v.blocked && <div className="shield-attack-token landed" style={{ left: v.x, top: v.y, color: v.attackColor, opacity: Math.min(1, (END_MS - v.elapsed) / 250) }}><PowerUpIcon type={attackType} size={34} title={false}/></div>}
    </div>;
  })}</div><span className="sr-only" role="status" aria-live="polite">{announcement}</span></>;
}
