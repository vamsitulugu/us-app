// Phase 1 earn rules: pure checks (no server, no database).
const assert = require('assert');
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...a) {
  if (req === 'express') { const r = () => ({ get() {}, post() {}, use() {} }); r.Router = r; return r; }
  if (/middleware\/(supabase|pro)$/.test(req)) return {};
  return orig.call(this, req, ...a);
};
const { cleanEarnRules, DEFAULT_EARN_RULES } = require('../routes/rewards')._test;

const d = cleanEarnRules(null);
assert.deepStrictEqual(Object.keys(d).sort(), Object.keys(DEFAULT_EARN_RULES).sort());
assert.ok(Object.values(d).every(r => r.enabled && r.coins > 0 && r.daily > 0));
console.log('ok  defaults are all enabled');

const o = cleanEarnRules({ mood: { coins: 3, daily: 2 }, game: { enabled: false }, memory: { coins: 9999, daily: -1 }, love: 'x' });
assert.strictEqual(o.mood.coins, 3); assert.strictEqual(o.mood.daily, 2);
assert.strictEqual(o.game.enabled, false);
assert.strictEqual(o.memory.coins, DEFAULT_EARN_RULES.memory.coins);   // out of range -> default
assert.strictEqual(o.memory.daily, DEFAULT_EARN_RULES.memory.daily);
assert.strictEqual(o.love.coins, DEFAULT_EARN_RULES.love.coins);        // junk -> default
console.log('ok  admin overrides are validated');

const max = Object.values(d).reduce((s, r) => s + r.coins * r.daily, 0);
assert.ok(max <= 60, 'daily earn ceiling stays small: ' + max);
console.log('ok  max coins per day from earn actions = ' + max);
