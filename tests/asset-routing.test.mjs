import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare} from 'miniflare';

test('real asset serving opens the lobby and invite links without redirects', async () => {
  const config = JSON.parse(fs.readFileSync('wrangler.multiplayer.jsonc', 'utf8'));
  const production = JSON.parse(fs.readFileSync('wrangler.multiplayer.prod.jsonc', 'utf8'));
  assert.equal(production.assets.html_handling, config.assets.html_handling);
  const mf = new Miniflare({
    name: 'smash', modules: true, scriptPath: 'multiplayer-worker-dist/worker.js',
    compatibilityDate: config.compatibility_date,
    durableObjects: {GAME_ROOMS: {className: 'GameRoom', useSQLite: true}},
    assets: {workerName: 'smash', directory: config.assets.directory, binding: 'ASSETS',
      routerConfig: {has_user_worker: true, invoke_user_worker_ahead_of_assets: true},
      assetConfig: {html_handling: config.assets.html_handling}}
  });
  try {
    for (const path of ['/', '/smash/', '/smash', '/smash/room/ABCDEF']) {
      const response = await mf.dispatchFetch('http://localhost' + path, {redirect: 'manual'});
      assert.equal(response.status, 200, path + ': ' + (response.status !== 200 ? await response.text() : ''));
      assert.equal(response.headers.get('location'), null, path);
      assert.match(await response.text(), /<div id="root"><\/div>/);
    }
  } finally {await mf.dispose();}
});
