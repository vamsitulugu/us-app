// Runs the REAL Gift Shop code from public/chat/chat.js inside jsdom with a fake server.
// Run: NODE_PATH=<dir with jsdom> node tests/gift-shop-ui.test.js   (jsdom is a dev-only tool, not an app dependency)
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(path.join(__dirname, '../public/chat/chat.js'), 'utf8');
const a = src.indexOf('// ─── GIFT SHOP (Twin Rewards, step 2)'), b = src.indexOf('  function sendEmoji(emoji) {');
assert(a > 0 && b > a, 'gift shop block not found');
const block = src.slice(a, b);

const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
const w = dom.window;
const log = { toasts: [], effects: [], goto: [] };
let balance = 30, charged = 0, sendCalls = 0, failNext = null;
const GIFTS = [
  { id: 'rose', name: 'Rose', emoji: '🌹', price: 20, tier: 'special', effect: 'hearts', blurb: 'Classic' },
  { id: 'ring', name: 'Diamond Ring', emoji: '💍', price: 100, tier: 'premium', effect: 'confetti', blurb: 'Big' },
];
const taps = new Set(); const tapLog = [];
w.window = w; w.S = { partnerName: 'Sita', role: 'user1' };
w.Rewards = {
  loadGifts: async () => ({ balance, gifts: GIFTS }),
  sendGift: async (id, tap) => {
    sendCalls++; tapLog.push(tap);
    if (failNext) { const e = failNext; failNext = null; throw e; }
    const g = GIFTS.find(x => x.id === id);
    if (!taps.has(tap)) { taps.add(tap); balance -= g.price; charged += g.price; }
    return { ok: true, balance, message: { id: 7, client_id: tap, type: 'gift', created_at: new Date().toISOString(), sender_role: 'user1', media_meta: { emoji: g.emoji, name: g.name, paid: true, tier: g.tier } } };
  },
};
w.goto = p => w.__log.goto.push(p);
w.eval(`
  var msgs = [], lastMsgId = 0, lastMsgTs = null;
  function esc(t){return String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function toast(t){ window.__log.toasts.push(t); }
  function closeSheet(){} function coupleId(){return 'c1';} function genClientId(){return 'c_'+Math.random().toString(36).slice(2,10);}
  function isMine(m){return m.sender_role==='user1';} function render(){} function scrollToBottom(){}
  function playSendEffect(e){ window.__log.effects.push(e); }
  window.__log = ${JSON.stringify(log)};
  ${block}
  window.__api = { openGiftPanel, giftPick, giftSend, giftEarn, renderGiftBubble, msgsRef: () => msgs };
  var Chat = window.__api; window.Chat = { openGiftPanel, giftPick, giftSend, giftEarn };
`);
const L = () => w.__log, $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));

(async () => {
  w.__api.openGiftPanel(); await tick();
  assert.ok($('#chatGiftPanel').classList.contains('open'));
  assert.strictEqual($$('.gs-item').length, 2);
  assert.ok($('.gs-bal b').textContent === '30');
  assert.ok($('.gs-head p').textContent.includes('Sita'));
  assert.ok($$('.gs-item')[1].classList.contains('is-locked'), 'ring (100) should look locked at 30 coins');
  console.log('ok  shop opens: 2 gifts, balance 30, partner name, locked state');

  // pick an unaffordable gift → "Earn coins", no send button
  w.__api.giftPick('ring');
  assert.ok($('.gs-need').textContent.includes('70 more'));
  assert.ok(!$('.gs-send'));
  w.__api.giftPick('ring'); assert.ok(!$('.gs-confirm'), 'tap again to unselect');
  console.log('ok  too expensive → "need 70 more coins" + Earn button (no Send)');

  // pick Rose and send
  w.__api.giftPick('rose');
  assert.ok($('.gs-send').textContent.includes('Sita'));
  await w.__api.giftSend(); await tick();
  assert.strictEqual(balance, 10); assert.strictEqual(charged, 20);
  assert.ok(!$('#chatGiftPanel').classList.contains('open'), 'sheet closes after sending');
  assert.strictEqual(JSON.stringify(L().effects), '["hearts"]');
  assert.ok(L().toasts.at(-1).includes('Rose sent to Sita'));
  assert.strictEqual(w.__api.msgsRef().length, 1);
  console.log('ok  Rose sent: -20, effect plays, toast, message in chat, sheet closed');

  // network error → the SAME tap id is reused on retry, so the server can never charge twice
  balance = 100; w.__api.openGiftPanel(); await tick(); w.__api.giftPick('rose');
  failNext = new Error('Failed to fetch');                                  // no status = network failure
  await w.__api.giftSend(); await tick();
  assert.ok(L().toasts.at(-1).includes('tap Send again'));
  assert.ok($('.gs-send') && !$('.gs-send').disabled, 'Send is usable again');
  await w.__api.giftSend(); await tick();
  const [t1, t2] = tapLog.slice(-2);
  assert.strictEqual(t1, t2, 'retry must reuse the same tap id'); assert.ok(t1.startsWith('gift_'));
  assert.strictEqual(balance, 80);
  console.log('ok  network error → retry message, same tap id reused, charged once');

  // 402 from server
  balance = 5; w.__api.openGiftPanel(); await tick(); w.__api.giftPick('rose');
  failNext = Object.assign(new Error('Not enough Gold Coins for this gift.'), { status: 402, data: { balance: 5 } });
  await w.__api.giftSend(); await tick();
  assert.ok(L().toasts.at(-1).includes('Not enough'));
  console.log('ok  server says not enough coins → friendly message');

  // earn button goes to the Rewards page
  w.__api.giftEarn(); assert.strictEqual(JSON.stringify(L().goto), '["rewards"]');
  console.log('ok  Earn opens the Rewards page');

  // bubbles
  w.eval('window.__me = true');
  const mine = w.__api.renderGiftBubble({ sender_role: 'user1', media_meta: { emoji: '🌹', name: 'Rose', paid: true, tier: 'special' } });
  const theirs = w.__api.renderGiftBubble({ sender_role: 'user2', media_meta: { emoji: '🌹', name: 'Rose', paid: true, tier: 'premium' } });
  const free = w.__api.renderGiftBubble({ sender_role: 'user2', media_meta: { emoji: '🎁', name: 'Gift' } });
  assert.ok(mine.includes('You sent a gift') && !mine.includes('gs-back'));
  assert.ok(theirs.includes('A gift for you') && theirs.includes('Send one back') && theirs.includes('gs-tier-premium'));
  assert.ok(!free.includes('gs-bubble'));
  const evil = w.__api.renderGiftBubble({ sender_role: 'user2', media_meta: { emoji: '<img src=x onerror=alert(1)>', name: '"><script>', paid: true, tier: 'x" onclick="y' } });
  assert.ok(!evil.includes('<img') && !evil.includes('<script') && !evil.includes('onclick="y'));
  console.log('ok  bubbles: mine / partner (send one back) / old free gift / HTML-injection safe');
  console.log('\nALL GIFT SHOP UI TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
