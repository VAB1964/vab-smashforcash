# Smash for Cash

Real-time multiplayer for VABGames.com. Four seats, 2–4 humans, optional bots,
six-character invite codes, and server-authoritative cash and action resolution.

## Local play

Use Node 22.13 or newer.

1. npm ci
2. npm run dev
3. Open the URL printed by Wrangler.
4. Create a room, share its link or code, and ready up.

Use another browser profile or device for another human seat. The same browser
reconnects to its existing seat. Fill remaining seats with bots, then the host starts.

## Cloudflare setup

Create a Worker connected to this GitHub repository.

| Setting | Value |
|---|---|
| Worker name | vab-smash-for-cash-staging |
| Production branch | main |
| Root directory | / |
| Build command | npm ci && npm run build |
| Deploy command | npm run deploy |

The staging configuration creates the GAME_ROOMS Durable Object binding and publishes
to workers.dev. It does not change VABGames routes.

After testing staging, use a production Worker named vab-smash-for-cash and
deploy command npm run deploy:production. Its configuration adds /smash/* and
/api/smash/* on vabgames.com and www.vabgames.com.

The VABGames launch tile is prepared at https://github.com/VAB1964/vabgames-website/pull/1.
Merge it after the production /smash/ route is working.

## Verification

- npm test builds the client and Worker and runs rules plus real WebSocket tests.
- npm run typecheck generates Cloudflare types and checks client/server TypeScript.

## Current rules

SMASH claims the growing pot. Last-place Double Down can award an equal bonus.
Steal targets the next payout. Greater Good drains cash into the pot.
Shield blocks every incoming attack for four seconds, then cools down for ten.
Lockdown clears threats and stops actions for six seconds.

The room server owns all timers, bot actions, payouts, pauses, and logs.
For the first network test, claims use server receipt order with a 225 ms contest
window. RTT is logged; client timestamps do not decide the winner.

The current build needs human-device playtesting before wider release.
