export const actionLabels: Record<ActionId,string> = {smash:"SMASH",double:"DOUBLE DOWN",lockdown:"LOCKDOWN",steal:"STEAL",good:"GREATER GOOD",shield:"SHIELD"};
export type ActionId = "smash" | "double" | "lockdown" | "steal" | "good" | "shield";
export type TrapId = "steal";
export type Armed = { ownerId: number; targetId: number; armedAt: number; expiresAt: number };
export type GreaterGood = { id: number; ownerId: number; targetId: number; nextTick: number; remaining: number; moved: number; audioSeries: boolean };
export type Player = { id: number; name: string; approach: string; style: string; stash: number; latency: number; tacticsUntil: number; cooldowns: Record<ActionId, number>; armed: Record<TrapId, Armed | null>; shielded: boolean; shieldUntil: number; doubleCycle: number };
export type Claim = { playerId: number; kind: "smash" | "double"; effectiveAt: number; receivedAt: number; sequence: number };
export type LogEvent = { at: number; gameNumber: number; type: string; message: string; details?: Record<string, unknown> };
export type GameSummary = { gameNumber: number; goal: number; startedAt: number; endedAt: number; status: "completed" | "reset" | "in_progress"; winner: string | null; pot: number; cycle: number; scores: Record<string, number> };
export type Game = { sessionId: string; gameNumber: number; startedAt: number | null; completedGames: GameSummary[]; players: Player[]; pot: number; lastTick: number; lockdownUntil: number; cycle: number; claims: Claim[]; resolveAt: number; greaterGood: GreaterGood[]; log: LogEvent[]; winner: number | null };
export type BotPick = { action: ActionId; target?: number; reason: string; roll: number };

export const GROWTH = 2, TACTICS_MS = 6000, LOCKDOWN_MS = 6000, LOCKDOWN_COOLDOWN_MS = 30000, CONTEST_MS = 225, CAP_RATIO = 0.5;
export const STEAL_ACTIVE_MS = 15000, STEAL_MISS_COOLDOWN_MS = 6000, GOOD_TICKS = 5, GOOD_TICK_MS = 3000, GOOD_PERCENT_PER_TICK = 0.02;
export const SHIELD_COOLDOWN_MS = 10000, SHIELD_ACTIVE_MS = 4000;
export const actionCooldown: Record<ActionId, number> = { smash: 10000, double: 30000, lockdown: LOCKDOWN_COOLDOWN_MS, steal: 20000, good: 15000, shield: SHIELD_COOLDOWN_MS };
export const actionIds: ActionId[] = ["lockdown", "steal", "good", "shield"];
export const targeted = new Set<ActionId>(["steal", "good"]);
export const tactics = new Set<ActionId>(actionIds);
export const money = (n: number) => `$${n.toFixed(0)}`;
export const seconds = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)}s`;
export const blankCooldowns = (): Record<ActionId, number> => ({ smash: 0, double: 0, lockdown: 0, steal: 0, good: 0, shield: 0 });
export const blankArmed = (): Record<TrapId, Armed | null> => ({ steal: null });
export const createPlayers = (): Player[] => [
  { id: 0, name: "Vince", approach: "You", style: "lime", stash: 0, latency: 92, tacticsUntil: 0, cooldowns: blankCooldowns(), armed: blankArmed(), shielded: false, shieldUntil: 0, doubleCycle: -1 },
  { id: 1, name: "Arthur", approach: "Aggressive", style: "cyan", stash: 0, latency: 54, tacticsUntil: 0, cooldowns: blankCooldowns(), armed: blankArmed(), shielded: false, shieldUntil: 0, doubleCycle: -1 },
  { id: 2, name: "Mabel", approach: "Cautious", style: "violet", stash: 0, latency: 126, tacticsUntil: 0, cooldowns: blankCooldowns(), armed: blankArmed(), shielded: false, shieldUntil: 0, doubleCycle: -1 },
  { id: 3, name: "Clara", approach: "Trickster", style: "coral", stash: 0, latency: 71, tacticsUntil: 0, cooldowns: blankCooldowns(), armed: blankArmed(), shielded: false, shieldUntil: 0, doubleCycle: -1 },
];
export const initialGame = (now = Date.now(), sessionId = `sfc-${now}`, gameNumber = 1, log: LogEvent[] = [], completedGames: GameSummary[] = []): Game => ({ sessionId, gameNumber, startedAt: null, completedGames, players: createPlayers(), pot: 12, lastTick: now, lockdownUntil: 0, cycle: 0, claims: [], resolveAt: 0, greaterGood: [], log: [...log, { at: now, gameNumber, type: "game_ready", message: `Game ${gameNumber} is ready. Start when you are set.`, details: { gameNumber } }], winner: null });

export function cloneGame(game: Game): Game { return { ...game, players: game.players.map(p => ({ ...p, cooldowns: { ...p.cooldowns }, armed: { steal: p.armed.steal ? { ...p.armed.steal } : null } })), claims: [...game.claims], greaterGood: game.greaterGood.map(effect => ({ ...effect })), log: [...game.log] }; }
export function scoreSnapshot(game: Game) { return Object.fromEntries(game.players.map(p => [p.name, Number(p.stash.toFixed(2))])); }
export function addLog(game: Game, message: string, type = "event", details?: Record<string, unknown>, at = Date.now()) { game.log = [...game.log, { at, gameNumber: game.gameNumber, type, message, details: { pot: Number(game.pot.toFixed(2)), scores: scoreSnapshot(game), ...details } }]; }
export function summarizeGame(game: Game, goal: number, endedAt: number, status: GameSummary["status"]): GameSummary {
  const wonAt = game.log.findLast(event => event.gameNumber === game.gameNumber && event.type === "game_winner")?.at;
  return { gameNumber: game.gameNumber, goal, startedAt: game.startedAt ?? endedAt, endedAt: game.winner !== null && wonAt !== undefined ? wonAt : endedAt, status, winner: game.winner === null ? null : game.players[game.winner].name, pot: Number(game.pot.toFixed(2)), cycle: game.cycle, scores: scoreSnapshot(game) };
}
export function isLast(player: Player, players: Player[]) { return player.stash === Math.min(...players.map(p => p.stash)) && players.some(p => p.stash > player.stash); }
export function beginCooldown(player: Player, action: ActionId, now: number) { if (actionCooldown[action]) player.cooldowns[action] = now + actionCooldown[action]; }

export function processExpiredSteals(game: Game, now: number) {
  game.players.forEach(owner => {
    const marker = owner.armed.steal;
    if (!marker || marker.expiresAt > now) return;
    if (game.claims.some(claim => claim.playerId === marker.targetId && claim.receivedAt <= marker.expiresAt)) return;
    const target = game.players[marker.targetId]; owner.armed.steal = null; owner.cooldowns.steal = now + STEAL_MISS_COOLDOWN_MS;
    addLog(game, `${owner.name}'s STEAL on ${target.name} expired and will recharge in ${STEAL_MISS_COOLDOWN_MS / 1000} seconds.`, "steal_expired", { actor: owner.name, target: target.name, cooldownMs: STEAL_MISS_COOLDOWN_MS }, now);
  });
}

export function processGreaterGood(game: Game, now: number, goal: number) {
  const finished = new Set<number>();
  game.greaterGood.forEach(effect => {
    const owner = game.players[effect.ownerId], target = game.players[effect.targetId];
    while (effect.remaining > 0 && effect.nextTick <= now && target.stash > 0) {
      const tickAt = effect.nextTick, amount = Math.min(target.stash, goal * GOOD_PERCENT_PER_TICK);
      target.stash -= amount; game.pot += amount; effect.remaining -= 1; effect.moved += amount; effect.nextTick += GOOD_TICK_MS;
      addLog(game, `${money(amount)} moved from ${target.name} to the pot for the GREATER GOOD${effect.remaining && target.stash > 0 ? ` · ${effect.remaining} payment${effect.remaining === 1 ? "" : "s"} left` : ""}.`, "greater_good_tick", { actor: owner.name, target: target.name, amount: Number(amount.toFixed(2)), remainingPayments: effect.remaining, audioSeries: effect.audioSeries }, tickAt);
    }
    if (effect.remaining === 0 || target.stash <= 0) {
      owner.cooldowns.good = now + actionCooldown.good; finished.add(effect.id);
      if (target.stash <= 0 && effect.remaining > 0) addLog(game, `${target.name} ran out of cash. ${owner.name}'s GREATER GOOD ended after moving ${money(effect.moved)}.`, "greater_good_ended", { actor: owner.name, target: target.name, remainingPayments: effect.remaining, totalMoved: Number(effect.moved.toFixed(2)) }, now);
      else addLog(game, `${owner.name}'s GREATER GOOD on ${target.name} finished after moving ${money(effect.moved)} into the pot.`, "greater_good_ended", { actor: owner.name, target: target.name, remainingPayments: 0, totalMoved: Number(effect.moved.toFixed(2)) }, now);
    }
  });
  game.greaterGood = game.greaterGood.filter(effect => !finished.has(effect.id));
}

export function settlePlayerWin(game: Game, winner: Player, now: number, kind: "smash" | "double" = "smash") {
  const gross = game.pot;
  let intercepted = false;
  const thieves = game.players.filter(p => p.armed.steal?.targetId === winner.id).sort((a,b)=>a.armed.steal!.armedAt-b.armed.steal!.armedAt);
  if (winner.shieldUntil > now) {
    for (const thief of thieves) {
      thief.armed.steal = null; thief.cooldowns.steal = now + actionCooldown.steal;
      addLog(game, `${winner.name}'s SHIELD blocked ${thief.name}'s STEAL at payout.`, "shield_triggered", {defender:winner.name,attacker:thief.name,blockedAction:"steal",shieldUntil:winner.shieldUntil},now);
    }
    winner.stash += gross;
    addLog(game, `${winner.name} banked ${money(gross)}.`, "payout", {winner:winner.name,amount:Number(gross.toFixed(2)),gross:Number(gross.toFixed(2))},now);
  } else if (thieves.length) {
    const thief=thieves[0];thief.armed.steal=null;thief.cooldowns.steal=now+actionCooldown.steal;
    thief.stash+=gross;intercepted=true;
    addLog(game, `${thief.name}'s banked STEAL took ${money(gross)} from ${winner.name}'s win.`, "steal_triggered", {thief:thief.name,target:winner.name,amount:Number(gross.toFixed(2)),gross:Number(gross.toFixed(2))},now);
  } else {
    winner.stash+=gross;
    addLog(game, `${winner.name} banked ${money(gross)}.`, "payout", {winner:winner.name,amount:Number(gross.toFixed(2)),gross:Number(gross.toFixed(2))},now);
  }
  if (kind === "double") {
    if (intercepted) addLog(game, `${winner.name}'s DOUBLE DOWN bonus was cancelled. The thief received only the original pot.`, "double_bonus_cancelled", { winner: winner.name, base: Number(gross.toFixed(2)), bonus: 0 }, now);
    else {
      winner.stash += gross;
      addLog(game, `💰 ${winner.name} won DOUBLE DOWN! ${money(gross)} pot + ${money(gross)} comeback bonus = ${money(gross * 2)}.`, "double_bonus", { winner: winner.name, amount: Number(gross.toFixed(2)), base: Number(gross.toFixed(2)), bonus: Number(gross.toFixed(2)), total: Number((gross * 2).toFixed(2)) }, now);
    }
  }
  game.pot = 0; game.cycle += 1;
}

export function resolveClaims(game: Game, now: number) {
  if (!game.claims.length || now < game.resolveAt) return;
  const ordered = [...game.claims].sort((a, b) => a.effectiveAt - b.effectiveAt || a.sequence - b.sequence);
  const winnerClaim = ordered[0], winner = game.players[winnerClaim.playerId]; settlePlayerWin(game, winner, now, winnerClaim.kind);
  if (ordered.length > 1) { const runner = ordered[1], runnerName = game.players[runner.playerId].name; const margin = Math.max(1, Math.round(runner.effectiveAt - winnerClaim.effectiveAt)); const more = ordered.length > 2 ? ` and ${ordered.length - 2} other player${ordered.length === 3 ? "" : "s"}` : ""; addLog(game, `${winner.name}'s ${actionLabels[winnerClaim.kind]} beat ${runnerName}'s ${actionLabels[runner.kind]}${more} by ${margin} ms after connection adjustment.`, "claim_resolved", { winner: winner.name, winningAction: winnerClaim.kind, marginMs: margin, contestants: ordered.map(c => ({ player: game.players[c.playerId].name, action: c.kind, receivedAt: c.receivedAt, effectiveAt: c.effectiveAt, sequence: c.sequence })) }, now); }
  game.claims = []; game.resolveAt = 0;
}

export function advance(game: Game, now: number, goal: number): Game {
  const next = cloneGame(game);
  if (next.winner !== null) { next.lastTick = now; return next; }
  for(const p of next.players)if(p.shielded && p.shieldUntil<=now){p.shielded=false;addLog(next,`${p.name}'s SHIELD expired. Protection ended; cooldown continues.`,"shield_expired",{actor:p.name},p.shieldUntil);}
  next.pot += Math.max(0, now - next.lastTick) / 1000 * GROWTH; next.lastTick = now; processGreaterGood(next, now, goal); resolveClaims(next, now); processExpiredSteals(next, now);
  const cap = goal * CAP_RATIO;
  if (next.pot >= cap && !next.claims.length) {
    const share = cap / next.players.length; next.players.forEach(p => { p.stash += share; }); next.pot = Math.max(0, next.pot - cap); next.cycle += 1;
    addLog(next, `MAX POT! ${money(cap)} was split equally. Banked actions did not trigger.`, "max_pot", { share: Number(share.toFixed(2)) }, now);
  }
  const champion = next.players.find(p => p.stash >= goal);
  if (champion) { next.winner = champion.id; addLog(next, `🏆 ${champion.name} reached ${money(goal)} and wins the game!`, "game_winner", { winner: champion.name }, now); }
  return next;
}

// The room may wake late: settle deadlines in time order, never award a delayed
// claim the cash that grew after its contest should have finished.
export function advanceRoom(game: Game, now: number, goal: number): Game {
  let next = game;
  while (next.lastTick < now && next.winner === null) {
    const deadlines = [
      next.resolveAt,
      ...next.players.map(p=>p.shielded?p.shieldUntil:0),
      ...next.greaterGood.map(effect => effect.nextTick),
      ...next.players.map(p => p.armed.steal?.expiresAt ?? 0),
      next.claims.length ? 0 : next.lastTick + Math.max(0, goal * CAP_RATIO - next.pot) / GROWTH * 1000,
    ].filter(t => t > next.lastTick && t <= now);
    const at = deadlines.length ? Math.min(...deadlines) : now;
    next = advance(next, at, goal);
  }
  return next;
}

export function resumeAfterPause(game: Game, pausedAt: number, resumedAt: number): Game {
  const next = cloneGame(game), pausedFor = Math.max(0, resumedAt - pausedAt);
  next.players.forEach(player => {
    if (player.shieldUntil > pausedAt) player.shieldUntil += pausedFor;
    if (player.tacticsUntil > pausedAt) player.tacticsUntil += pausedFor;
    (Object.keys(player.cooldowns) as ActionId[]).forEach(action => { if (player.cooldowns[action] > pausedAt) player.cooldowns[action] += pausedFor; });
    if (player.armed.steal?.expiresAt && player.armed.steal.expiresAt > pausedAt) player.armed.steal.expiresAt += pausedFor;
  });
  if (next.lockdownUntil > pausedAt) next.lockdownUntil += pausedFor;
  if (next.resolveAt > pausedAt) next.resolveAt += pausedFor;
  next.claims = next.claims.map(claim => ({ ...claim, receivedAt: claim.receivedAt + pausedFor, effectiveAt: claim.effectiveAt + pausedFor }));
  next.greaterGood = next.greaterGood.map(effect => ({ ...effect, nextTick: effect.nextTick + pausedFor }));
  next.lastTick = resumedAt;
  addLog(next, `Game resumed after ${seconds(pausedFor)}. Every timer continued where it stopped.`, "game_resumed", { pausedDurationMs: pausedFor }, resumedAt);
  return next;
}

export function press(game: Game, playerId: number, action: ActionId, targetId: number | undefined, now: number, sequence: number, goal: number, botPick?: BotPick): Game {
  const next = advance(game, now, goal);
  const player = next.players[playerId], isTactic = tactics.has(action), target = targetId === undefined ? undefined : next.players[targetId];
  const recordPress = (accepted: boolean, reason: string) => addLog(next, `${player.name}'s ${actionLabels[action]} press was ${accepted ? "accepted" : `rejected: ${reason}`}.`, "action_press", { actor: player.name, action, target: target?.name ?? null, accepted, reason, source: botPick ? "bot" : "human", receivedAt: now, sequence }, now);
  const reject = (reason: string) => { recordPress(false, reason); return next; };
  if (next.winner !== null) return reject("the game is over");
  if (next.lockdownUntil > now) return reject("the table is in Lockdown");
  if (isTactic && player.tacticsUntil > now) return reject("the tactics timer is still running");
  if (player.cooldowns[action] > now) return reject("the action is cooling down");
  if (targeted.has(action) && (!target || target.id === player.id)) return reject("a valid opponent must be selected");
  if (action === "steal" && player.armed.steal) return reject("that action is already banked");
  if (action === "good" && next.greaterGood.some(effect => effect.ownerId === player.id)) return reject("that player already owns an active Greater Good");
  if (action === "good" && next.greaterGood.some(effect => effect.targetId === targetId)) return reject("the target is already under Greater Good");
  if (action === "good" && target!.stash <= 0) return reject("the target has no cash to contribute");
  if (action === "double" && (!isLast(player, next.players) || player.doubleCycle === next.cycle || player.cooldowns.smash <= now)) return reject("Double Down is unavailable");
  if (action === "shield" && player.shielded) return reject("Shield is already armed");
  if (isTactic) player.tacticsUntil = now + TACTICS_MS;
  if (botPick) addLog(next, `${player.name} chose ${actionLabels[action]}: ${botPick.reason}`, "bot_decision", { actor: player.name, action, target: target?.name ?? null, roll: Number(botPick.roll.toFixed(4)), reason: botPick.reason }, now);
  recordPress(true, "eligible");

  if (action === "steal") {
    if(target!.shieldUntil>now){beginCooldown(player,action,now);addLog(next,`${target!.name}\'s SHIELD blocked ${player.name}\'s incoming STEAL.`,"shield_triggered",{defender:target!.name,attacker:player.name,blockedAction:"steal",shieldUntil:target!.shieldUntil},now);return next;}
    player.armed.steal = { ownerId: player.id, targetId: target!.id, armedAt: now, expiresAt: now + STEAL_ACTIVE_MS };
    addLog(next, `${player.name} banked STEAL on ${target!.name} for ${STEAL_ACTIVE_MS / 1000} seconds.`, "action_banked", { actor: player.name, action, target: target!.name, expiresAt: now + STEAL_ACTIVE_MS, durationMs: STEAL_ACTIVE_MS }, now); return next;
  }
  if (action === "good") {
    if (target!.shieldUntil > now) {
      beginCooldown(player, action, now);
      addLog(next, `${target!.name}'s SHIELD stopped ${player.name}'s GREATER GOOD before any cash moved; Shield remains active.`, "shield_triggered", { defender: target!.name, attacker: player.name, blockedAction: "good", preventedAmount: goal * GOOD_PERCENT_PER_TICK * GOOD_TICKS, shieldCooldownMs: SHIELD_COOLDOWN_MS }, now); return next;
    }
    const audioSeries = !next.greaterGood.some(effect => effect.audioSeries);
    next.greaterGood.push({ id: sequence, ownerId: player.id, targetId: target!.id, nextTick: now + GOOD_TICK_MS, remaining: GOOD_TICKS, moved: 0, audioSeries });
    addLog(next, `${player.name} started GREATER GOOD on ${target!.name}: ${money(goal * GOOD_PERCENT_PER_TICK)} every ${GOOD_TICK_MS / 1000} seconds, up to ${money(goal * GOOD_PERCENT_PER_TICK * GOOD_TICKS)}.${audioSeries ? " Its drain owns the audio countdown." : " Another audio countdown is active, so this drain is silent."}`, "greater_good_started", { actor: player.name, target: target!.name, amountPerTick: goal * GOOD_PERCENT_PER_TICK, ticks: GOOD_TICKS, tickEveryMs: GOOD_TICK_MS, audioSeries }, now); return next;
  }
  if (action === "lockdown") {
    const cleared: { owner: string; action: "steal" | "good"; target: string }[] = [];
    next.players.forEach(owner => {
      const marker = owner.armed.steal;
      if (marker) {
        cleared.push({ owner: owner.name, action: "steal", target: next.players[marker.targetId].name });
        owner.armed.steal = null; owner.cooldowns.steal = now + actionCooldown.steal;
      }
      owner.cooldowns.lockdown = now + LOCKDOWN_COOLDOWN_MS;
    });
    next.greaterGood.forEach(effect => {
      const owner = next.players[effect.ownerId]; cleared.push({ owner: owner.name, action: "good", target: next.players[effect.targetId].name }); owner.cooldowns.good = now + actionCooldown.good;
    });
    next.greaterGood = [];
    next.lockdownUntil = now + LOCKDOWN_MS;
    const cancelledClaims = next.claims.length; next.claims = []; next.resolveAt = 0;
    const clearedText = cleared.length ? ` Cleared: ${cleared.map(item => `${item.owner}'s ${item.action === "good" ? "GREATER GOOD" : "STEAL"} → ${item.target}`).join("; ")}.` : " No threats were waiting.";
    addLog(next, `🚨 ${player.name} called LOCKDOWN!${clearedText} All buttons are locked for ${LOCKDOWN_MS / 1000} seconds while the pot grows.`, "lockdown", { actor: player.name, durationMs: LOCKDOWN_MS, cooldownMs: LOCKDOWN_COOLDOWN_MS, cleared, cancelledClaims, unblockable: true }, now); return next;
  }
  if (action === "shield") {
    player.shielded=true;player.shieldUntil=now+SHIELD_ACTIVE_MS;player.cooldowns.shield=player.shieldUntil+SHIELD_COOLDOWN_MS;
    addLog(next,`${player.name} raised SHIELD for 4 seconds. Every incoming attack is blocked; then a 10-second cooldown.`,"shield_armed",{actor:player.name,activeDurationMs:SHIELD_ACTIVE_MS,shieldUntil:player.shieldUntil,cooldownAfterEndMs:SHIELD_COOLDOWN_MS},now);
    for(const effect of next.greaterGood.filter(e=>e.targetId===player.id)){
      const attacker=next.players[effect.ownerId];attacker.cooldowns.good=now+actionCooldown.good;
      addLog(next,`${player.name}'s SHIELD ended ${attacker.name}'s active GREATER GOOD.`,"shield_triggered",{defender:player.name,attacker:attacker.name,blockedAction:"good",remainingPayments:effect.remaining,totalMoved:effect.moved,shieldUntil:player.shieldUntil},now);
    }
    next.greaterGood=next.greaterGood.filter(e=>e.targetId!==player.id);
    return next;
  }

  beginCooldown(player, action, now); if (action === "double") player.doubleCycle = next.cycle;
  const claim: Claim = { playerId, kind: action, receivedAt: now, effectiveAt: now - Math.min(150, player.latency / 2), sequence }; next.claims.push(claim); if (!next.resolveAt) next.resolveAt = now + CONTEST_MS;
  addLog(next, `${player.name} pressed ${actionLabels[action]}. Truth Keeper opened a ${CONTEST_MS} ms contest.`, "claim_attempt", { actor: player.name, action, receivedAt: now, effectiveAt: claim.effectiveAt, latencyMs: player.latency, compensationMs: Math.min(150, player.latency / 2), sequence }, now); return next;
}

export function runawayLeader(players: Player[], goal: number) { const sorted = [...players].sort((a, b) => b.stash - a.stash), gap = sorted[0].stash - sorted[1].stash; return gap >= Math.max(20, goal * 0.12) || (sorted[0].stash >= goal * 0.55 && gap >= goal * 0.08) ? sorted[0] : null; }
export function threatCount(player: Player, game: Game) { return game.players.reduce((n, p) => n + Number(p.armed.steal?.targetId === player.id), 0) + game.greaterGood.filter(effect => effect.targetId === player.id).length; }
export function botCashOpportunity(player: Player, game: Game, goal: number) {
  const trailing = Math.max(...game.players.map(p => p.stash)) - player.stash >= goal * .10;
  const threshold = trailing ? (player.approach === "Aggressive" ? .06 : player.approach === "Cautious" ? .075 : .07) : player.approach === "Aggressive" ? .08 : player.approach === "Cautious" ? .11 : .12;
  return { trailing, threshold };
}

export function chooseBot(player: Player, game: Game, goal: number, now = Date.now(), random = Math.random): BotPick | null { if (game.lockdownUntil > now) return null;
  const roll = random(), pressure = game.pot / goal, tacticsReady = player.tacticsUntil <= now;
  const ready = (a: ActionId) => player.cooldowns[a] <= now && !(a === "steal" && player.armed.steal) && !(a === "good" && game.greaterGood.some(effect => effect.ownerId === player.id));
  const rivals = game.players.filter(p => p.id !== player.id), leader = [...game.players].sort((a, b) => b.stash - a.stash)[0], runaway = runawayLeader(game.players, goal);
  const threats = threatCount(player, game);
  const stealWaiting = game.players.some(p => p.armed.steal?.targetId === player.id);
  const { trailing, threshold } = botCashOpportunity(player, game, goal);
  const canWin = player.stash + game.pot >= goal;
  const canDouble = isLast(player, game.players) && player.doubleCycle !== game.cycle && !ready("smash") && ready("double");
  if (canDouble && (!stealWaiting || player.shielded) && (pressure >= .08 || player.stash + game.pot * 2 >= goal) && roll < .85) return { action: "double", roll, reason: "last-place 2× comeback payout available while Smash cools" };
  if (ready("smash") && (!stealWaiting || player.shielded) && (pressure >= threshold || canWin) && roll < (canWin ? .98 : trailing ? .90 : player.approach === "Cautious" ? .65 : .8)) return { action: "smash", roll, reason: canWin ? "the available pot can win the game" : trailing ? "behind the leader: prioritize a safe cash claim over another attack" : "Smash ready with a worthwhile pot and no unprotected Steal; drains do not block claims" };
  if (tacticsReady && ready("lockdown") && threats >= 2 && roll < (threats >= 3 ? 0.72 : 0.42)) return { action: "lockdown", roll, reason: `clear ${threats} attacks aimed here and reset the table` };
  if (tacticsReady && !player.shielded && ready("shield") && (threats > 0 || player === leader) && roll < (threats > 0 ? 0.42 : 0.18)) return { action: "shield", roll, reason: threats > 0 ? "protect against a banked attack" : "protect the lead" };
  const lockdownThreshold = player.approach === "Cautious" ? 0.16 : 0.20;
  if (tacticsReady && ready("lockdown") && pressure > lockdownThreshold && roll < (player.approach === "Cautious" ? 0.20 : 0.13)) return { action: "lockdown", roll, reason: "clear the table and build a showdown pot" };
  if (tacticsReady && runaway && runaway.id !== player.id) {
    if (ready("good") && runaway.stash > 0 && !game.greaterGood.some(effect => effect.targetId === runaway.id) && roll < 0.48) return { action: "good", target: runaway.id, roll, reason: `move some of runaway leader ${runaway.name}'s cash back into play` };
    if (ready("steal") && roll < 0.84) return { action: "steal", target: runaway.id, roll, reason: `intercept runaway leader ${runaway.name}'s next win` };
  }
  if (tacticsReady) {
    const poorest = Math.min(...game.players.map(p => p.stash)); const urgentDouble = rivals.find(p => p.stash === poorest && p.stash + game.pot >= goal && game.players.some(x => x.stash > p.stash));
    if (urgentDouble && ready("steal") && roll < 0.20) return { action: "steal", target: urgentDouble.id, roll, reason: `${urgentDouble.name} can win now with Double Down` };
    if (leader.id !== player.id && leader.stash > 0 && ready("good") && !game.greaterGood.some(effect => effect.targetId === leader.id) && roll < 0.14) return { action: "good", target: leader.id, roll, reason: `pressure current leader ${leader.name}` };
    if (ready("steal") && roll < (player.approach === "Trickster" ? 0.24 : 0.08)) return { action: "steal", target: leader.id === player.id ? rivals[0].id : leader.id, roll, reason: "prepare to intercept a rival win" };
  }
  if (ready("smash") && !stealWaiting && pressure > threshold && roll < (player.approach === "Cautious" ? 0.58 : 0.4)) return { action: "smash", roll, reason: `${money(game.pot)} passed the ${player.approach.toLowerCase()} claim threshold` };
  return null;
}
