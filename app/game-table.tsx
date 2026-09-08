"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MoneyTravel from "./money-travel";
import ShieldEffects from "./shield-effects";
import ThreatMarkers from "./threat-markers";
import LockdownEffects from "./lockdown-effects";
import { Ban, Banknote, Clock3, Download, HandHeart, Pause, Play, Radio, RotateCcw, ShieldCheck, Siren, Target, Volume2, VolumeX, Zap } from "lucide-react";

import { ActionId, Player, LogEvent, GameSummary, Game, GROWTH, STEAL_ACTIVE_MS, SHIELD_COOLDOWN_MS, SHIELD_ACTIVE_MS, actionCooldown, actionIds, targeted, tactics, money, seconds, blankCooldowns, blankArmed, createPlayers, initialGame, cloneGame, scoreSnapshot, addLog, summarizeGame, isLast, beginCooldown, processExpiredSteals, processGreaterGood, settlePlayerWin, resolveClaims, advance, resumeAfterPause, press, runawayLeader, threatCount, botCashOpportunity, chooseBot, TACTICS_MS, LOCKDOWN_MS, LOCKDOWN_COOLDOWN_MS, CONTEST_MS, CAP_RATIO, STEAL_MISS_COOLDOWN_MS, GOOD_TICKS, GOOD_TICK_MS, GOOD_PERCENT_PER_TICK } from "../shared/engine";

type ScorePulse = { id: number; playerId: number; amount: number; direction: "gain" | "loss" };

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const GAIN_NOTES = [523.25, 659.25, 783.99, 880], GREATER_GOOD_NOTES = [392, 349.23, 329.63, 293.66, 261.63];

const actionMeta: Record<ActionId, { label: string; hint: string; icon: typeof Zap }> = {
  smash: { label: "SMASH", hint: "Race for the pot", icon: Zap }, double: { label: "DOUBLE DOWN", hint: "Last-place comeback", icon: Zap },
  lockdown: { label: "LOCKDOWN · 6 seconds", hint: "Clear threats · stop everyone", icon: Siren },
  steal: { label: "STEAL", hint: "Take their next win · 15s", icon: Banknote }, good: { label: "GREATER GOOD", hint: "Drain cash into the pot", icon: HandHeart }, shield: { label: "SHIELD", hint: "Block all attacks · 4s", icon: ShieldCheck },
};

const moneyDelta = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(Math.abs(n) < 10 ? 2 : 0)}`;

const SCORE_PULSE_MS = 2800;

export type RemoteGame = { game:Game; goal:number; seat:number; now:number; pausedAt:number|null; isHost:boolean; connected:boolean; send:(type:string,extra?:Record<string,unknown>)=>void; downloadLog:()=>void };
export default function GameTable({remote}:{remote?:RemoteGame} = {}) {
  const [localGame, setGame] = useState<Game>(()=>remote?.game ?? initialGame()), [localGoal, setGoal] = useState(200), [targetId, setTargetId] = useState(remote?.seat===1?0:1), [localNow, setNow] = useState(() => Date.now()), [localStarted, setStarted] = useState(false), [localPausedAt, setPausedAt] = useState<number | null>(null);
  const remoteRef=useRef(remote);remoteRef.current=remote;const isRemote=!!remote;
  const game=remote?.game??localGame,goal=remote?.goal??localGoal,now=remote?.now??localNow,started=remote?true:localStarted,pausedAt=remote?remote.pausedAt:localPausedAt,youId=remote?.seat??0;
  const [scorePulses, setScorePulses] = useState<ScorePulse[]>([]), [soundEnabled, setSoundEnabled] = useState(true);
  const sequence = useRef(0), scoreSequence = useRef(0), scoreGame = useRef(`${game.sessionId}:${game.gameNumber}`), audioLogCursor = useRef(game.log.length), previousStashes = useRef(game.players.map(player => player.stash)), awardAudioContext = useRef<AudioContext | null>(null), drainAudioContext = useRef<AudioContext | null>(null), gameRef = useRef(game), startedRef = useRef(false), pausedRef = useRef<number | null>(null), scheduledLockdown = useRef(0); useEffect(() => { gameRef.current = game; }, [game]);
  const ensureAudio = useCallback((channel: "award" | "drain" = "award") => {
    const AudioCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioCtor) return null;
    const contextRef = channel === "award" ? awardAudioContext : drainAudioContext;
    if (!contextRef.current || contextRef.current.state === "closed") contextRef.current = new AudioCtor();
    if (contextRef.current.state === "suspended") void contextRef.current.resume();
    return contextRef.current;
  }, []);
  useEffect(()=>{if(!isRemote)return;const unlock=()=>{ensureAudio("award");ensureAudio("drain");};window.addEventListener("pointerdown",unlock,{once:true});return()=>window.removeEventListener("pointerdown",unlock);},[isRemote,ensureAudio]);
  const playDoubleChing = useCallback(() => {
    if (!soundEnabled) return;
    const context = ensureAudio("award"); if (!context) return;
    const start = context.currentTime + .008;
    // Two bright, cash-register strikes; independent voices can overlap drain audio.
    [[0, 1046.5, .035], [.16, 1568, .045], [.16, 2093, .018], [.16, 2637, .009]].forEach(([offset, hz, peak]) => {
      const oscillator = context.createOscillator(), volume = context.createGain(), at = start + offset;
      oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(hz, at);
      volume.gain.setValueAtTime(.0001, at); volume.gain.exponentialRampToValueAtTime(peak, at + .006);
      volume.gain.exponentialRampToValueAtTime(.0001, at + .45);
      oscillator.connect(volume).connect(context.destination); oscillator.start(at); oscillator.stop(at + .47);
    });
  }, [ensureAudio, soundEnabled]);
  const playShieldImpact = useCallback(() => {
    if (!soundEnabled) return;
    const context = ensureAudio("award"); if (!context) return;
    const start = context.currentTime + .008;
    [1174.66, 1762, 2740].forEach((hz, i) => {
      const oscillator = context.createOscillator(), volume = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.setValueAtTime(hz, start);
      volume.gain.setValueAtTime(.0001, start); volume.gain.exponentialRampToValueAtTime(.025 / (i + 1), start + .005);
      volume.gain.exponentialRampToValueAtTime(.0001, start + .20 - i * .035);
      oscillator.connect(volume).connect(context.destination); oscillator.start(start); oscillator.stop(start + .22);
    });
  }, [ensureAudio, soundEnabled]);
  const playScoreTone = useCallback((playerId: number, direction: "gain" | "loss") => {
    if (!soundEnabled) return;
    const context = ensureAudio("award"); if (!context) return;
    const start = context.currentTime + 0.008;
    if (direction === "loss") return;
    const frequency = GAIN_NOTES[playerId] ?? GAIN_NOTES[0];
    [["sine", frequency, 0.065], ["triangle", frequency * 2, 0.014]].forEach(([wave, hz, peak]) => {
      const oscillator = context.createOscillator(), volume = context.createGain(); oscillator.type = wave as OscillatorType; oscillator.frequency.setValueAtTime(hz as number, start); volume.gain.setValueAtTime(0.0001, start); volume.gain.exponentialRampToValueAtTime(peak as number, start + 0.014); volume.gain.exponentialRampToValueAtTime((peak as number) * 0.7, start + 0.18); volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.44); oscillator.connect(volume).connect(context.destination); oscillator.start(start); oscillator.stop(start + 0.45);
    });
  }, [ensureAudio, soundEnabled]);
  const playGreaterGoodTone = useCallback((remainingPayments: number) => {
    if (!soundEnabled) return;
    const context = ensureAudio("drain"); if (!context) return;
    const step = Math.max(0, Math.min(GOOD_TICKS - 1, GOOD_TICKS - remainingPayments - 1)), frequency = GREATER_GOOD_NOTES[step], final = remainingPayments === 0, start = context.currentTime + 0.008, duration = final ? 0.5 : 0.34;
    [["triangle", frequency, final ? 0.065 : 0.052], ["sine", frequency * 2, final ? 0.016 : 0.011]].forEach(([wave, hz, peak]) => {
      const oscillator = context.createOscillator(), volume = context.createGain(); oscillator.type = wave as OscillatorType; oscillator.frequency.setValueAtTime(hz as number, start); volume.gain.setValueAtTime(0.0001, start); volume.gain.exponentialRampToValueAtTime(peak as number, start + 0.012); volume.gain.exponentialRampToValueAtTime(0.0001, start + duration); oscillator.connect(volume).connect(context.destination); oscillator.start(start); oscillator.stop(start + duration + 0.01);
    });
  }, [ensureAudio, soundEnabled]);
  useEffect(() => {
    const freshEvents = game.log.slice(audioLogCursor.current); audioLogCursor.current = game.log.length;
    freshEvents.filter(event => event.type === "double_bonus").forEach(() => playDoubleChing());
    freshEvents.filter(event => event.type === "greater_good_tick" && event.details?.audioSeries === true).forEach(event => playGreaterGoodTone(Number(event.details?.remainingPayments ?? 0)));
  }, [game.log, playGreaterGoodTone, playDoubleChing]);
  useEffect(() => {
    const current = game.players.map(player => player.stash);
    const currentGame = `${game.sessionId}:${game.gameNumber}`;
    if (scoreGame.current !== currentGame) {
      scoreGame.current = currentGame; previousStashes.current = current; setScorePulses([]); return;
    }
    current.forEach((stash, playerId) => {
      const amount = Number((stash - previousStashes.current[playerId]).toFixed(2));
      if (!amount) return;
      const pulse: ScorePulse = { id: ++scoreSequence.current, playerId, amount, direction: amount > 0 ? "gain" : "loss" };
      setScorePulses(existing => [...existing.filter(item => item.playerId !== playerId), pulse]);
      playScoreTone(playerId, pulse.direction);
      window.setTimeout(() => setScorePulses(existing => existing.filter(item => item.id !== pulse.id)), SCORE_PULSE_MS);
    });
    previousStashes.current = current;
  }, [game.players, game.sessionId, game.gameNumber, playScoreTone]);
  const startGame = useCallback(() => {
    if (startedRef.current || gameRef.current.winner !== null) return;
    ensureAudio("award"); ensureAudio("drain");
    const stamp = Date.now(); startedRef.current = true; setStarted(true); setNow(stamp);
    setGame(g => { const next = cloneGame(g); next.startedAt = stamp; next.lastTick = stamp; addLog(next, `Game ${next.gameNumber} began. The vault is live and the pot never stops growing.`, "game_start", { control: "Start Game" }, stamp); return next; });
  }, [ensureAudio]);
  const togglePause = useCallback(() => {
    if(remoteRef.current){if(remoteRef.current.isHost)remoteRef.current.send(remoteRef.current.pausedAt===null?"pause":"resume");return;}
    const stamp = Date.now(), started = pausedRef.current;
    if (started !== null) {
      pausedRef.current = null; setPausedAt(null); setNow(stamp); setGame(g => resumeAfterPause(g, started, stamp)); return;
    }
    if (!startedRef.current || gameRef.current.winner !== null) return;
    pausedRef.current = stamp; setPausedAt(stamp); setNow(stamp);
    setGame(g => { const next = advance(g, stamp, goal); addLog(next, "Game paused. The pot, bots, effects, contests, and every timer are frozen.", "game_paused", { control: "Spacebar" }, stamp); return next; });
  }, [goal]);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.code !== "Space" || event.repeat) return; event.preventDefault(); togglePause(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [togglePause]);
  useEffect(() => { if(isRemote)return; const timer = window.setInterval(() => { if (!startedRef.current || pausedRef.current !== null) return; const stamp = Date.now(); setNow(stamp); setGame(g => advance(g, stamp, goal)); }, 100); return () => window.clearInterval(timer); }, [goal,isRemote]);
  useEffect(() => {
    if(isRemote)return;
    // One pending decision per bot. Public state changes wake it; it rechecks at execution.
    const plans = new Map<number, { at: number; key: string; wake: string }>();
    let previousGame = "", wasPaused = false;
    const timer = window.setInterval(() => {
      const current = gameRef.current, stamp = Date.now(), key = current.sessionId + ":" + current.gameNumber;
      if (key !== previousGame) { plans.clear(); previousGame = key; }
      if (!startedRef.current || current.winner !== null || pausedRef.current !== null || current.lockdownUntil > stamp) {
        plans.clear(); wasPaused = pausedRef.current !== null; return;
      }
      if (wasPaused) { plans.clear(); wasPaused = false; }
      for (const player of current.players.slice(1)) {
        const ready = player.cooldowns.smash <= stamp;
        const threats = current.players.filter(p => p.armed.steal?.targetId === player.id).map(p => p.id).join(",");
        const { trailing, threshold } = botCashOpportunity(player, current, goal);
        const valuable = current.pot / goal >= threshold, canWin = current.pot + player.stash >= goal;
        const stateKey = [ready, threats, player.shielded, valuable, trailing, canWin, player.cooldowns.double <= stamp, isLast(player, current.players), current.pot >= goal * .08, player.stash + current.pot * 2 >= goal, current.lockdownUntil].join("|");
        const old = plans.get(player.id);
        if (!old || old.key !== stateKey) {
          const low = player.approach === "Aggressive" ? 300 : player.approach === "Cautious" ? 500 : 400;
          const delay = low + Math.random() * 650;
          const wake = !old ? "start or Lockdown release" : "cooldown, threat, protection, or pot opportunity changed";
          plans.set(player.id, { at: stamp + delay, key: stateKey, wake }); continue;
        }
        if (stamp < old.at) continue;
        plans.set(player.id, { ...old, at: stamp + 900 + Math.random() * 500 });
        setGame(g => {
          if (!startedRef.current || pausedRef.current !== null || g.winner !== null || g.gameNumber !== current.gameNumber || g.lockdownUntil > Date.now()) return g;
          const fresh = advance(g, Date.now(), goal), pick = chooseBot(fresh.players[player.id], fresh, goal);
          if (!pick) return fresh;
          return press(fresh, player.id, pick.action, pick.target, Date.now(), ++sequence.current, goal, { ...pick, reason: old.wake + ": " + pick.reason });
        });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [goal,isRemote]);
  const paused = pausedAt !== null || (remote ? !remote.connected : false);
  const act = (action: ActionId) => { if(remote){ensureAudio("award");ensureAudio("drain");remote.send("press",{action,target:targeted.has(action)?targetId:undefined});return;} if (started && !paused) setGame(g => press(g, 0, action, targeted.has(action) ? targetId : undefined, Date.now(), ++sequence.current, goal)); };
  const reset = (newGoal = goal) => {
    if(remote){remote.send("rematch");return;}
    const wasStarted = startedRef.current, stamp = Date.now(); startedRef.current = false; pausedRef.current = null; scheduledLockdown.current = 0; setStarted(false); setPausedAt(null); setGoal(newGoal); setNow(stamp); sequence.current = 0;
    setGame(current => {
      if (!wasStarted) { const retained = current.log.at(-1)?.type === "game_ready" ? current.log.slice(0, -1) : current.log; return initialGame(stamp, current.sessionId, current.gameNumber, retained, current.completedGames); }
      const archived = cloneGame(current), status: GameSummary["status"] = current.winner === null ? "reset" : "completed", summary = summarizeGame(current, goal, stamp, status);
      addLog(archived, `Game ${current.gameNumber} was saved to this session${summary.winner ? ` · ${summary.winner} won` : " · reset before a winner"}.`, "game_saved", { status, goal, winner: summary.winner, finalScores: summary.scores }, stamp);
      return initialGame(stamp, current.sessionId, current.gameNumber + 1, archived.log, [...current.completedGames, summary]);
    });
  };
  const downloadLog = () => {
    if(remote){remote.downloadLog();return;}
    const stamp = Date.now(), currentSummary = game.startedAt ? summarizeGame(game, goal, stamp, game.winner === null ? "in_progress" : "completed") : null, sessionGames = currentSummary ? [...game.completedGames, currentSummary] : game.completedGames;
    const payload = { exportedAt: new Date(stamp).toISOString(), sessionId: game.sessionId, gameCount: sessionGames.length, currentGameNumber: game.gameNumber, games: sessionGames.map(item => ({ ...item, startedTimestamp: new Date(item.startedAt).toISOString(), endedTimestamp: new Date(item.endedAt).toISOString() })), rules: { goal, growthPerSecond: GROWTH, maxPot: goal * CAP_RATIO, actions: ["Smash / Double Down", "Lockdown", "Steal", "Greater Good", "Shield"], tacticsTimerMs: TACTICS_MS, lockdown: { durationMs: LOCKDOWN_MS, cooldownMs: LOCKDOWN_COOLDOWN_MS, unblockable: true, clears: ["all banked Steals", "all active Greater Good effects"], preserves: ["armed Shields"], cooldownsContinue: true, botReactionMsAfterRelease: { aggressive: [300, 950], trickster: [400, 1050], cautious: [500, 1150] }, botAwareness: "Reconsider on cooldown ready, threat/protection changes, pot threshold and winning pot; revalidate after variable delay; 100ms polling" }, steal: { rule: "Takes the selected target's next successful cash payout", activeDurationMs: STEAL_ACTIVE_MS, missedCooldownMs: STEAL_MISS_COOLDOWN_MS, successfulCooldownMs: actionCooldown.steal }, greaterGood: { rule: "Moves cash from any selected opponent into the pot and ends if that player reaches zero", percentOfGoalPerTick: GOOD_PERCENT_PER_TICK * 100, tickEveryMs: GOOD_TICK_MS, ticks: GOOD_TICKS, maximumPercentOfGoal: GOOD_PERCENT_PER_TICK * GOOD_TICKS * 100, cooldownAfterEffectMs: actionCooldown.good, audio: "The earliest active drain owns the five-note countdown; overlapping drains remain silent for their full duration" }, shield: { rule: "Blocks all incoming attacks for 4 seconds; ends existing drains; banked Steals are blocked if they trigger during protection", activeDurationMs: SHIELD_ACTIVE_MS, cooldownAfterEndMs: SHIELD_COOLDOWN_MS }, doubleDown: { rule: "Last place at press, while Smash cools: win the pot plus an equal minted bonus; if stolen only the original pot transfers and the bonus is cancelled", cooldownMs: actionCooldown.double, cooldownStarts: "accepted press", eligibility: "ties for last allowed if someone has more cash", botMinimumPotRatio: .08 }, globalPause: "Spacebar or Pause button freezes all gameplay clocks", smashCooldownMs: actionCooldown.smash, contestWindowMs: CONTEST_MS }, finalState: { started, paused, gameNumber: game.gameNumber, pot: Number(game.pot.toFixed(2)), cycle: game.cycle, winner: game.winner === null ? null : game.players[game.winner].name, activeGreaterGood: game.greaterGood.map(effect => ({ owner: game.players[effect.ownerId].name, target: game.players[effect.targetId].name, remainingPayments: effect.remaining, moved: Number(effect.moved.toFixed(2)), nextPaymentInMs: Math.max(0, effect.nextTick - now), audioSeries: effect.audioSeries })), players: game.players.map(p => ({ name: p.name, approach: p.approach, stash: Number(p.stash.toFixed(2)), latencyMs: p.latency, shielded: p.shielded, shieldRemainingMs: Math.max(0,p.shieldUntil-now), armed: { steal: p.armed.steal ? { target: game.players[p.armed.steal.targetId].name, remainingMs: Math.max(0, p.armed.steal.expiresAt - now) } : null } })) }, events: game.log.map(e => ({ ...e, timestamp: new Date(e.at).toISOString() })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `smash-for-cash-${game.sessionId}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const you = game.players[youId], selectedTarget = game.players[targetId], cap = goal * CAP_RATIO, lockedDown = game.lockdownUntil > now, lockdownReleased = game.lockdownUntil > 0 && now >= game.lockdownUntil && now < game.lockdownUntil + 1200, tacticsLocked = you.tacticsUntil > now, champion = game.winner === null ? null : game.players[game.winner];
  const doubleAvailable = isLast(you, game.players) && you.doubleCycle !== game.cycle && you.cooldowns.double <= now;
  const mainAction: "smash" | "double" = you.cooldowns.smash > now && doubleAvailable ? "double" : "smash";
  const threatsAgainstYou = game.players.flatMap(owner => owner.armed.steal?.targetId === you.id ? [`BANKED · ${owner.name} STEAL · ${seconds(owner.armed.steal.expiresAt - now)}`] : []);
  const goodAgainstYou = game.greaterGood.filter(effect => effect.targetId === you.id).map(effect => `ACTIVE · ${game.players[effect.ownerId].name} GREATER GOOD · ${money(effect.remaining * goal * GOOD_PERCENT_PER_TICK)} left · next ${seconds(effect.nextTick - now)}`);
  const humanNotices = game.log.filter(entry => entry.at >= now - 3500 && ((entry.type === "greater_good_started" && entry.details?.target === you.name) || (entry.type === "action_press" && entry.details?.actor === you.name && entry.details?.accepted === false)));
  const recentNotice = humanNotices.at(-1);
  const lockdownEvent = game.log.findLast(e => e.gameNumber === game.gameNumber && e.type === "lockdown");
  const doubleNotice = game.log.findLast(e => e.gameNumber === game.gameNumber && (e.type === "double_bonus" || e.type === "double_bonus_cancelled") && e.at >= now - 4200);
  const exactCash = (value: unknown) => "$" + Number(value).toFixed(2);

  return <main className="game-shell">
    <MoneyTravel events={game.log} names={game.players.map(p => p.name)} gameKey={`${game.sessionId}:${game.gameNumber}`} paused={paused}/>
    <ShieldEffects key={`${game.sessionId}:${game.gameNumber}`} events={game.log} names={game.players.map(p => p.name)} paused={paused} onImpact={playShieldImpact}/>
    <header className="topbar"><div className="brand"><span>SMASH</span><span>FOR CASH</span><b>GAME {game.gameNumber} · {remote?"MULTIPLAYER":"RULES LAB"}</b></div><div className="goal-wrap"><div className="goal-line"><span>First to {money(goal)}</span><strong>Max pot {money(cap)}</strong></div><div className="progress"><i style={{ width: `${Math.min(100, Math.max(...game.players.map(p => p.stash)) / goal * 100)}%` }} /></div></div><div className="settings"><label>Goal<select disabled={isRemote} value={goal} onChange={e => reset(Number(e.target.value))}><option value={100}>$100</option><option value={200}>$200</option><option value={500}>$500</option></select></label><button className="pause-control" onClick={togglePause} disabled={!started || game.winner !== null || (remote && !remote.isHost)} title="Pause or resume the entire game (Spacebar)">{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? "Resume" : "Pause"}</button><button onClick={() => { if (!soundEnabled) { ensureAudio("award"); ensureAudio("drain"); } setSoundEnabled(enabled => !enabled); }} title={soundEnabled ? "Mute score sounds" : "Turn on score sounds"}>{soundEnabled ? <Volume2 size={16}/> : <VolumeX size={16}/>} Sound</button><button onClick={downloadLog} title="Download every game in this page session"><Download size={16}/> Log</button><button disabled={remote && (!remote.isHost || game.winner===null)} onClick={() => reset()}><RotateCcw size={16}/> {game.winner !== null ? "Next Game" : "Reset"}</button></div></header>
    <section className="player-grid">{game.players.map(p => { const activeGood = game.greaterGood.find(effect => effect.ownerId === p.id), scorePulse = scorePulses.find(pulse => pulse.playerId === p.id); return <article key={p.id} className={`player-card ${p.shielded ? "shield-protected" : ""} ${p.style} ${p.id === youId ? "is-you" : ""} ${scorePulse ? `score-${scorePulse.direction}` : ""}`}><div className="avatar">{p.name[0]}</div>{p.shielded && <div className={`shield-duration ${p.shieldUntil-now<=1000?"ending":""}`} style={{background:`conic-gradient(currentColor ${Math.max(0,(p.shieldUntil-now)/SHIELD_ACTIVE_MS)*360}deg,transparent 0deg)`,animationPlayState:paused?"paused":"running"}} aria-label={`Shield active for ${seconds(p.shieldUntil-now)}`}><ShieldCheck size={25}/></div>}<div className="player-main"><span>{p.id===youId?"YOU":p.approach}</span><h2>{p.name}<ShieldCheck className={`stash-shield ${p.shielded ? "ready" : "inactive"}`} size={19} aria-label={p.shielded ? "Shield active" : p.cooldowns.shield > now ? "Shield recharging" : "Shield not armed"}/></h2><div className="score-wrap"><strong key={scorePulse?.id ?? `score-${p.id}`} className={`score-value ${scorePulse ? `score-${scorePulse.direction}` : ""}`}>{money(p.stash)}</strong>{scorePulse && <i key={`delta-${scorePulse.id}`} className={`score-delta ${scorePulse.direction}`} aria-label={`${p.name} ${scorePulse.direction === "gain" ? "gained" : "lost"} ${money(Math.abs(scorePulse.amount))}`}>{moneyDelta(scorePulse.amount)}</i>}</div></div><div className="player-state">{!remote && <span><Radio size={12}/> {p.latency} ms</span>}{p.tacticsUntil > now && <span><Clock3 size={12}/> Tactics {seconds(p.tacticsUntil - now)}</span>}{p.cooldowns.shield > now && !p.shielded && <span><Clock3 size={12}/> Shield {seconds(p.cooldowns.shield - now)}</span>}{p.shielded && <span className="shield-pill"><ShieldCheck size={12}/> SHIELD · {seconds(p.shieldUntil-now)}</span>}{p.armed.steal && <span className="armed-pill">STEAL → {game.players[p.armed.steal.targetId].name} · {seconds(p.armed.steal.expiresAt - now)}</span>}{activeGood && <span className="good-pill">GOOD → {game.players[activeGood.targetId].name} · {"●".repeat(GOOD_TICKS - activeGood.remaining)}{"○".repeat(activeGood.remaining)} · {money(activeGood.remaining * goal * GOOD_PERCENT_PER_TICK)} left · {seconds(activeGood.nextTick - now)}</span>}</div><ThreatMarkers players={game.players} drains={game.greaterGood} targetId={p.id} now={now}/></article>; })}</section>
    <section className="play-zone">
      <aside className="rules-note"><span className="eyebrow">FIVE-ACTION TEST</span><h3>Every button has one job.</h3><p>Claim, reset, capture, pressure, or defend. Timed threats remain visible until they trigger, expire, or Lockdown clears the table.</p><div className="mini-rule"><Siren size={17}/><span>Lockdown clears every Steal and Greater Good effect, preserves Shields, and builds a showdown pot.</span></div><div className="mini-rule"><ShieldCheck size={17}/><span>Shield blocks every attack for 4 seconds and ends active drains. Protection must last through your payout. Then it recharges for 10 seconds.</span></div><div className="mini-rule"><Radio size={17}/><span>Claims use a {CONTEST_MS} ms contest window {remote?"ordered by server receipt time.":"with capped connection adjustment."}</span></div></aside>
      <div className="vault-area">{doubleNotice && <div className={`double-celebration ${doubleNotice.type === "double_bonus_cancelled" ? "cancelled" : ""}`} role="status" style={{animationPlayState: paused ? "paused" : "running"}}><b>{doubleNotice.type === "double_bonus" ? "💰 DOUBLE DOWN · 2×!" : "DOUBLE DOWN · BONUS LOST"}</b><strong>{String(doubleNotice.details?.winner)}{doubleNotice.type === "double_bonus" ? ` wins ${exactCash(doubleNotice.details?.total)}` : " was intercepted"}</strong><span>{doubleNotice.type === "double_bonus" ? `${exactCash(doubleNotice.details?.base)} pot + ${exactCash(doubleNotice.details?.bonus)} comeback bonus` : "Steal takes the pot · bonus cancelled"}</span></div>}{paused && <div className="pause-banner"><Pause size={18}/> {remote ? (remote.isHost ? "PAUSED · HOST CAN RESUME" : "PAUSED · WAITING FOR HOST") : "PAUSED · PRESS SPACE TO RESUME"}</div>}{lockdownEvent && (lockedDown || now < game.lockdownUntil + 1400) && <LockdownEffects key={lockdownEvent.at} until={game.lockdownUntil} now={now} paused={paused} actor={String(lockdownEvent.details?.actor)} cleared={(lockdownEvent.details?.cleared ?? []) as {owner:string;target:string;action:string}[]} names={game.players.map(p=>p.name)}/>}{game.claims.length > 0 && <div className="contest-banner"><Radio size={16}/> TRUTH KEEPER RESOLVING…</div>}{recentNotice && <div className="resolution-banner"><Ban size={20}/><span>{recentNotice.message}</span></div>}<div className={`vault ${lockedDown ? "vault-in-lockdown" : ""}`} style={{animationPlayState:paused ? "paused" : "running"}}><div className="vault-glow"/><span>{started ? "CURRENT POT" : "READY POT"}</span><strong>{money(game.pot)}</strong><small>{started ? `${money(Math.max(0, cap - game.pot))} until automatic split` : "Choose a goal, then start when ready"}</small></div>{!started ? <button className="start-button" onClick={startGame}><Play/> START GAME</button> : <button className={`smash-button ${mainAction === "double" ? "double-ready" : ""}`} disabled={paused || lockedDown || (mainAction === "smash" && you.cooldowns.smash > now) || game.winner !== null} onClick={() => act(mainAction)}><Zap/> {mainAction === "double" ? "DOUBLE DOWN · 2×" : you.cooldowns.smash > now ? `SMASH · ${seconds(you.cooldowns.smash - now)}` : "SMASH"}</button>}<div className="double-status">{you.cooldowns.double > now ? `Double Down recharges in ${seconds(you.cooldowns.double - now)}` : doubleAvailable ? "Last place · 2× available while Smash cools" : "Double Down · last place only"}</div><div className={`claim-risk ${threatsAgainstYou.length ? "threatened" : "clear"}`}>{threatsAgainstYou.length ? you.shielded ? "Steal waiting · Shield active" : "Steal waiting for your payout" : "No Steal waiting · race for the pot"}</div>{champion && <div className="victory">🏆 {champion.name} wins!</div>}</div>
      <aside className="action-log"><span className="eyebrow">LIVE ACTION FEED</span>{game.greaterGood.length > 0 && <div className="active-effects"><b>ACTIVE GREATER GOOD</b>{game.greaterGood.map(effect => <span key={effect.id}><HandHeart size={13}/>{game.players[effect.ownerId].name} → {game.players[effect.targetId].name} · {money(effect.moved)} moved · {money(effect.remaining * goal * GOOD_PERCENT_PER_TICK)} left · next {seconds(effect.nextTick - now)}</span>)}</div>}<div>{game.log.filter(entry => entry.type !== "network_sample" && entry.type !== "bot_decision" && entry.type !== "action_press" && entry.type !== "greater_good_tick").slice(-12).reverse().map((entry, i) => <p key={`${entry.at}-${i}`}>{entry.message}</p>)}</div></aside>
    </section>
    <section className="control-dock"><div className="threat-summary" aria-label="Attacks against you"><div className={`threat-bar ${threatsAgainstYou.length ? "danger" : "safe"}`}><Banknote size={17}/><div><b>BANKED AGAINST YOU · NEXT PAYOUT</b><strong>{threatsAgainstYou.length ? `Steal waiting${you.shielded ? " · Shield active" : ""}` : "No Steal waiting"}</strong><span>{threatsAgainstYou.length ? threatsAgainstYou.join(" · ") : "You can race for the pot"}</span></div></div><div className={`threat-bar ${goodAgainstYou.length ? "draining" : "quiet"}`}><HandHeart size={17}/><div><b>YOUR STASH · GREATER GOOD</b><strong>{goodAgainstYou.length ? "Draining cash · does not steal your payout" : "No active drain"}</strong><span>{goodAgainstYou.length ? goodAgainstYou.join(" · ") : "Your stored cash is not draining"}</span></div></div></div><div className="section-label"><span>YOUR ACTIONS</span><small>{!started ? "Start the game when ready" : paused ? "Paused · inspect the board and action feed" : lockedDown ? "Lockdown · get ready for GO" : tacticsLocked ? `Tactics timer: ${seconds(you.tacticsUntil - now)} · Smash remains available` : "Both tracks ready"}</small></div><div className="action-row">{actionIds.map(action => {
      const Icon = actionMeta[action].icon, armed = action === "steal" && you.armed.steal, activeGood = action === "good" && game.greaterGood.some(effect => effect.ownerId === you.id), cooling = you.cooldowns[action] > now, shieldAlready = action === "shield" && you.shielded, targetHasNoCash = action === "good" && selectedTarget.stash <= 0, targetAlreadyGood = action === "good" && game.greaterGood.some(effect => effect.targetId === targetId);
      const disabled = !started || paused || lockedDown || tacticsLocked || cooling || !!armed || activeGood || shieldAlready || targetHasNoCash || targetAlreadyGood || game.winner !== null;
      let detail = action === "shield" ? "All attacks blocked · 4s" : actionMeta[action].hint; if (armed) detail = `→ ${game.players[armed.targetId].name} · ${seconds(armed.expiresAt - now)}`; else if (activeGood) detail = "Effect active"; else if (shieldAlready) detail = `PROTECTED · ${seconds(you.shieldUntil-now)}`; else if (cooling) detail = seconds(you.cooldowns[action] - now); else if (targetHasNoCash) detail = "Target has no cash"; else if (targetAlreadyGood) detail = "Already targeted"; else if (tacticsLocked) detail = `Tactics ${seconds(you.tacticsUntil - now)}`;
      return <button key={action} className={`action-card ${action} ${armed || shieldAlready ? "armed" : ""}`} disabled={disabled} onClick={() => act(action)}><Icon size={24}/><b>{actionMeta[action].label}</b><small>{detail}</small></button>;
    })}</div><div className="target-picker"><Target size={15}/><span>Target for Steal or Greater Good:</span>{game.players.filter(p=>p.id!==youId).map(p => <button key={p.id} className={targetId === p.id ? "active" : ""} onClick={() => setTargetId(p.id)}>{p.name}</button>)}</div></section>
  </main>;
}
