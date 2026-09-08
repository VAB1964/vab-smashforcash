# First multiplayer build

This staging implementation shares rules and presentation with the solo Rules Lab.
It is not deployed to Cloudflare yet. The existing live Sites publication remains the solo version.

## Included

- Four-seat invite rooms, 2–4 humans, optional bot fill, readiness and host start.
- Same five-action game, with per-seat targeting, money travel, Shield and Lockdown effects.
- Server-owned game clock, cooldowns, pot and payouts; chronological deadline catch-up.
- Ordered incremental event delivery; full state on reconnect with old audio/animations suppressed.
- Socket-bound identity, hashed reconnect tokens, bounded messages, rate limiting,
  monotonically increasing command sequences, stale-game rejection and duplicate suppression.
- Host pause/resume, automatic disconnect pause, host transfer, explicit bot replacement, rematch.
- Shared multi-game downloadable log with network samples and victory-time summaries.
- Fixed $200 target for the first human test.

## Run locally (Node 22.13+)

From the project root:

1. npm ci
2. npm run build
3. npm run dev

Open the address Wrangler prints, then Create room. Use another browser profile or device
to join the invite URL. At least two humans are required; fill the other seats with bots.
Use separate browser profiles for local testing: the stored reconnect token intentionally
rejoins the same seat when opening another tab in the same browser.

Run npm run test for rule and real WebSocket/Durable Object tests.
Run npm run typecheck for the client and Worker type check.
This repository builds the standalone multiplayer game.

## Cloudflare staging

The separate wrangler.multiplayer.jsonc targets vab-smash-for-cash-staging on workers.dev.
It declares no VABGames production routes and does not change the other games.

From a Cloudflare-authenticated checkout, after the build:

npm run deploy

Cloudflare Git build configuration:
- Root: repository root
- Build command: npm ci && npm run build
- Deploy command: npm run deploy

## VABGames production

wrangler.multiplayer.prod.jsonc contains the same route layout as Cribbage and Dominoes:
/smash/* and /api/smash/* on both vabgames.com and www.vabgames.com.
Invite URLs use /smash/room/ABCDEF. The code can also be typed into the lobby.
Production uses its own Worker and rooms, separate from staging.

After verifying staging, the production deploy command is npm run deploy:production.
The launch tile is prepared in the vabgames-website branch smash-for-cash-launch.
Merge that tile only after the production game route is working.

Do not supply API tokens through chat or commit them. Use the existing Cloudflare Git
integration or Wrangler's normal local sign-in flow.

## Timing policy for the first network test

Claims use the existing 225 ms contest window. Order is server receipt time and a
server sequence tie-breaker. Client timestamps and simulated latency values do not
decide payouts. RTT samples are measured and logged; no latency compensation is applied
yet. This is a starting policy to measure on real devices, not a claim of perfect
fairness across different connections.

Clients display countdowns using the server clock plus an RTT-based offset estimate.
The server resolves actual deadlines. Audio is enabled by the player's first click
on the game screen, subject to browser autoplay rules.

## Remaining before wider release

- Deploy staging through the user's authenticated Cloudflare/GitHub setup.
- Human device tests for invitation, refresh/reconnect, pause, and the Lockdown race.
- Examine real RTT/claim logs before choosing latency compensation.
- Consider client animation presentation timing under network jitter.
- Add public-site abuse controls for room creation before public launch.
- Enable production routes after staging verification.

No browser visual QA or human-device testing has been performed on this first build.
