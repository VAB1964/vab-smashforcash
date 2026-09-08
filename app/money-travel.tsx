"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote } from "lucide-react";

type Event = { gameNumber: number; type: string; details?: Record<string, unknown> };
type Transfer = { id: number; route: string[]; amount: number; kind: "gain" | "steal" | "drain" | "bonus"; elapsed: number };
const COLORS = ["#67ec67", "#3bcaf5", "#a47aff", "#ff6f70"];
const LEG_MS = 850, ARRIVAL_MS = 450;

// Read resolved events, never infer a transfer from net score changes.
function transfersFor(event: Event, names: string[]): Omit<Transfer, "id" | "elapsed">[] {
  const d = event.details ?? {}, amount = Number(d.amount);
  if (event.type === "max_pot") return names.map(name => ({ route: ["pot", name], amount: Number(d.share), kind: "gain" }));
  if (!(amount > 0)) return [];
  if (event.type === "double_bonus") return [{ route: ["pot", String(d.winner)], amount, kind: "bonus" }];
  if (event.type === "payout") return [{ route: ["pot", String(d.winner)], amount, kind: "gain" }];
  if (event.type === "shield_triggered" && d.blockedAction === "steal") return [{ route: ["pot", String(d.defender)], amount, kind: "gain" }];
  if (event.type === "steal_triggered") return [{ route: ["pot", String(d.target), String(d.thief)], amount, kind: "steal" }];
  if (event.type === "greater_good_tick") return [{ route: [String(d.target), "pot"], amount, kind: "drain" }];
  return [];
}

export default function MoneyTravel({ events, names, gameKey, paused }: { events: Event[]; names: string[]; gameKey: string; paused: boolean }) {
  const cursor = useRef(events.length), previousGame = useRef(gameKey), serial = useRef(0);
  const pending = useRef<Transfer[]>([]), layer = useRef<HTMLDivElement>(null);
  const [flights, setFlights] = useState<(Transfer & { x: number; y: number; color: string; opacity: number; label: string; reduced: boolean })[]>([]);
  const namesRef = useRef(names); namesRef.current = names;

  useEffect(() => {
    if (previousGame.current !== gameKey) {
      previousGame.current = gameKey; cursor.current = events.length; pending.current = []; setFlights([]); return;
    }
    const fresh = events.slice(cursor.current); cursor.current = events.length;
    pending.current.push(...fresh.flatMap(event => transfersFor(event, namesRef.current)).map(transfer => ({ ...transfer, id: ++serial.current, elapsed: transfer.kind === "bonus" ? -450 : 0 })));
  }, [events, gameKey]);

  useEffect(() => {
    let frame = 0, last = performance.now();
    const draw = (stamp: number) => {
      const dt = stamp - last; last = stamp;
      if (!paused && pending.current.length) {
        const shell = layer.current?.closest(".game-shell");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const anchor = (name: string) => {
          const element = name === "pot" ? shell?.querySelector(".vault strong") : shell?.querySelectorAll(".player-card .score-wrap")[namesRef.current.indexOf(name)];
          const rect = element?.getBoundingClientRect();
          return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        };
        pending.current.forEach(f => { f.elapsed += dt; });
        pending.current = pending.current.filter(f => f.elapsed < (f.route.length - 1) * LEG_MS + ARRIVAL_MS);
        setFlights(pending.current.flatMap(f => {
          if (f.elapsed < 0) return [];
          const leg = Math.min(f.route.length - 2, Math.floor(f.elapsed / LEG_MS));
          const from = anchor(f.route[leg]), to = anchor(f.route[leg + 1]);
          if (!from || !to) return [];
          const t = Math.min(1, (f.elapsed - leg * LEG_MS) / LEG_MS), ease = t * t * (3 - 2 * t);
          const end = (f.route.length - 1) * LEG_MS;
          const color = COLORS[namesRef.current.indexOf(f.route.at(-1)!)] ?? "#ff7989";
          return [{ ...f, x: reduced ? to.x : from.x + (to.x - from.x) * ease, y: (reduced ? to.y : from.y + (to.y - from.y) * ease - Math.sin(t * Math.PI) * 52) - 28,
            color, opacity: Math.min(1, f.elapsed / 100, (end + ARRIVAL_MS - f.elapsed) / 250), reduced,
            label: f.kind === "bonus" ? "2× COMEBACK BONUS" : reduced ? `${f.route[0] === "pot" ? "Pot" : f.route[0]} → ${f.route.at(-1) === "pot" ? "Pot" : f.route.at(-1)}` : f.kind === "drain" ? "GREATER GOOD" : f.kind === "steal" && leg > 0 ? "STOLEN" : "CASH" }];
        }));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [paused]);

  return <div ref={layer} className="money-travel-layer" aria-hidden="true">{flights.map(f => <div key={f.id} className={`money-flight ${f.kind}`} style={{ left: f.x, top: f.y, opacity: f.opacity, borderColor: f.color }}>
    <Banknote size={24}/><strong>${f.amount.toFixed(f.amount < 10 ? 2 : 0)}</strong><small>{f.label}</small>
  </div>)}</div>;
}
