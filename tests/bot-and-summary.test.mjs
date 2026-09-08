import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const page = fs.readFileSync(new URL("../shared/engine.ts", import.meta.url), "utf8");
function engine(roll = .5) {
  const math = Object.create(Math);
  math.random = () => roll;
  const context = vm.createContext({ Math: math, Date, Zap: {}, Siren: {}, Banknote: {}, HandHeart: {}, ShieldCheck: {} });
  const code = page.replace(/^export /gm, "");
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText, context);
  return expression => vm.runInContext(expression, context);
}
test("trailing cautious and trickster bots claim modest safe pots before attacking", () => {
  const run = engine(.85);
  run("var g = initialGame(); g.players[0].stash = 100; g.pot = 15;");
  for (const id of [2, 3]) {
    assert.equal(run(`chooseBot(g.players[${id}], g, 200)?.action`), "smash");
  }
  run("g.players[1].armed.steal = { ownerId: 1, targetId: 2, armedAt: Date.now(), expiresAt: Date.now()+15000 };");
  assert.notEqual(run("chooseBot(g.players[2], g, 200)?.action"), "smash");
  run("g.players[1].armed.steal = null; g.players[2].cooldowns.smash = Date.now()+10000; g.players[2].cooldowns.double = Date.now()+10000;");
  assert.notEqual(run("chooseBot(g.players[2], g, 200)?.action"), "smash");
});
test("completed summaries retain victory time across later exports and resets", () => {
  const run = engine();
  run('var g = initialGame(1000); g.startedAt = 2000; g.winner = 1; addLog(g, "won", "game_winner", {winner:"Arthur"}, 5000);');
  assert.equal(run('summarizeGame(g, 200, 9000, "completed").endedAt'), 5000);
  assert.equal(run('summarizeGame(g, 200, 15000, "completed").endedAt'), 5000);
  run('var next = initialGame(10000, g.sessionId, 2, g.log); next.startedAt = 11000;');
  assert.equal(run('summarizeGame(next, 200, 14000, "reset").endedAt'), 14000);
});
