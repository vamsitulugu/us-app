// ════════════════════════════════════════════════════════════════
//  routes/rewards-cards.js — Scratch cards won by finishing a couple game
//    POST /api/rewards/cards/grant  { coupleId, game, sessionId }   a game finished -> a card for BOTH partners
//    GET  /api/rewards/cards?coupleId=&userId=                      my unscratched cards (+ count)
//    POST /api/rewards/cards/open   { coupleId, cardId, skip? }     scratch (or Skip) a card -> coins
//
//  Mounted in server.js BEFORE /api/rewards. The apps never send a prize or an amount:
//  the server picks the prize when the card is opened and pays through reward_credit().
// ════════════════════════════════════════════════════════════════
const express = require('express');
const supabase = require('../middleware/supabase');
const { loadMember } = require('../middleware/pro');
const rewards = require('./rewards');

const router = express.Router();
const { istDay, pickWeighted, getScratchPrizes } = rewards._test;

const GAMES = new Set(['tod', 'mindreader', 'ludo', 'ttt', 'draw', 'memory', 'bomb', 'puzzle', 'atw', 'space', 'other']);
const DEFAULT_CARD_RULES = { daily: 5, minGapSeconds: 20 };   // cards per person per day, and the pause between two cards of the same game
const MAX_LIST = 60;

async function getCardRules() {
  try {
    const { data } = await supabase.from('reward_config').select('value').eq('key', 'card_rules').maybeSingle();
    const v = (data && data.value) || {};
    return {
      daily: Number.isInteger(v.daily) && v.daily >= 0 && v.daily <= 50 ? v.daily : DEFAULT_CARD_RULES.daily,
      minGapSeconds: Number.isInteger(v.minGapSeconds) && v.minGapSeconds >= 0 && v.minGapSeconds <= 600 ? v.minGapSeconds : DEFAULT_CARD_RULES.minGapSeconds,
    };
  } catch (_) { return DEFAULT_CARD_RULES; }
}

async function member(req, res, coupleId) {
  if (!coupleId) { res.status(400).json({ error: 'coupleId required' }); return null; }
  const user = await loadMember(req, coupleId);
  if (!user) { res.status(403).json({ error: 'Please sign in again.' }); return null; }
  return user;
}

async function balanceOf(userId) {
  const { data } = await supabase.from('reward_wallets').select('balance').eq('user_id', userId).maybeSingle();
  return (data && data.balance) || 0;
}

const cardOut = r => ({ id: r.id, game: r.game, createdAt: r.created_at });

// ── GET /cards ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const user = await member(req, res, req.query.coupleId); if (!user) return;
    const [{ data: rows, error }, { data: done }] = await Promise.all([
      supabase.from('reward_cards').select('id, game, created_at').eq('user_id', user.id).eq('status', 'new')
        .order('created_at', { ascending: false }).limit(MAX_LIST),
      supabase.from('reward_cards').select('id, game, coins, title, message, emoji, opened_at').eq('user_id', user.id).eq('status', 'opened')
        .order('opened_at', { ascending: false }).limit(10),
    ]);
    if (error) throw error;
    res.json({
      cards: (rows || []).map(cardOut), count: (rows || []).length,
      recent: (done || []).map(r => ({ id: r.id, game: r.game, coins: r.coins, title: r.title, message: r.message, emoji: r.emoji, openedAt: r.opened_at })),
    });
  } catch (e) {
    console.error('[cards] list failed:', e.message);
    res.status(500).json({ error: 'Could not load your scratch cards.' });
  }
});

// ── POST /cards/grant ──────────────────────────────────────────────
router.post('/grant', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const game = typeof body.game === 'string' && GAMES.has(body.game) ? body.game : 'other';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!/^[A-Za-z0-9_.:-]{6,80}$/.test(sessionId)) return res.status(400).json({ error: 'Missing or invalid sessionId' });

    const [{ data: couple }, { data: members }, rules] = await Promise.all([
      supabase.from('couples').select('paired').eq('id', coupleId).maybeSingle(),
      supabase.from('users').select('id').eq('couple_id', coupleId).limit(2),
      getCardRules(),
    ]);
    if (!couple || couple.paired === false || !members || members.length < 2) {
      return res.json({ ok: true, granted: false, reason: 'not_paired' });   // a card needs TWO people
    }

    // Same game finished twice within a few seconds = both phones reporting the same game, or a spam tap.
    const since = new Date(Date.now() - rules.minGapSeconds * 1000).toISOString();
    const { data: recent } = await supabase.from('reward_cards').select('id').eq('couple_id', String(coupleId)).eq('game', game).gte('created_at', since).limit(1);
    const today = istDay(0);
    const mineBefore = await supabase.from('reward_cards').select('id').eq('user_id', user.id).eq('session_id', sessionId).maybeSingle();
    if (mineBefore.data) return res.json({ ok: true, granted: false, reason: 'duplicate' });
    if (recent && recent.length) return res.json({ ok: true, granted: false, reason: 'recent' });

    let grantedMe = false;
    for (const m of members) {
      const { count } = await supabase.from('reward_cards').select('id', { count: 'exact', head: true }).eq('user_id', m.id).eq('day', today);
      if ((count || 0) >= rules.daily) continue;                  // that person is at today's limit
      const { error } = await supabase.from('reward_cards').insert({
        user_id: m.id, couple_id: String(coupleId), game, session_id: sessionId, day: today,
      });
      if (error) { if (!/duplicate|unique/i.test(error.message)) console.error('[cards] insert failed:', error.message); continue; }
      if (m.id === user.id) grantedMe = true;
    }
    if (!grantedMe) return res.json({ ok: true, granted: false, reason: 'daily_limit' });

    const { count: total } = await supabase.from('reward_cards').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'new');
    res.json({ ok: true, granted: true, count: total || 1 });
  } catch (e) {
    console.error('[cards] grant failed:', e.message);
    res.status(500).json({ error: 'Could not add your scratch card.' });
  }
});

// ── POST /cards/open ───────────────────────────────────────────────
router.post('/open', async (req, res) => {
  const body = req.body || {};
  try {
    const coupleId = body.coupleId;
    const user = await member(req, res, coupleId); if (!user) return;
    const cardId = Number(body.cardId);
    if (!Number.isInteger(cardId) || cardId <= 0) return res.status(400).json({ error: 'Missing cardId' });
    const skip = body.skip === true;

    const { data: card } = await supabase.from('reward_cards').select('*').eq('id', cardId).eq('user_id', user.id).maybeSingle();
    if (!card) return res.status(404).json({ error: 'That card was not found.' });

    const out = c => ({ ok: true, cardId: c.id, prizeId: c.prize_id, coins: c.coins, title: c.title, message: c.message, emoji: c.emoji, skipped: !!c.skipped });

    if (card.status === 'opened') {                                  // already opened (double tap / retry): same answer, no second payout
      return res.json({ ...out(card), duplicate: true, balance: await balanceOf(user.id) });
    }

    const prize = pickWeighted(await getScratchPrizes());
    const idem = 'card:' + card.id;
    // Claim the card first (only one request can flip 'new' -> 'opened'), then pay.
    const { data: claimed, error: cErr } = await supabase.from('reward_cards').update({
      status: 'opened', prize_id: prize.id, coins: prize.coins, title: prize.title, message: prize.message, emoji: prize.emoji || null,
      skipped: skip, opened_at: new Date().toISOString(),
    }).eq('id', card.id).eq('user_id', user.id).eq('status', 'new').select().maybeSingle();
    if (cErr) throw cErr;
    if (!claimed) {
      const { data: again } = await supabase.from('reward_cards').select('*').eq('id', card.id).maybeSingle();
      return res.json({ ...out(again || card), duplicate: true, balance: await balanceOf(user.id) });
    }
    const { error: pErr } = await supabase.rpc('reward_credit', {
      p_user: user.id, p_couple: String(coupleId), p_amount: prize.coins,
      p_kind: 'scratch', p_idem: idem,
      p_meta: { prizeId: prize.id, coins: prize.coins, title: prize.title, card: card.id, game: card.game, skipped: skip },
    });
    if (pErr) {                                                      // payment failed -> put the card back so nothing is lost
      await supabase.from('reward_cards').update({ status: 'new', prize_id: null, coins: null, title: null, message: null, emoji: null, skipped: false, opened_at: null })
        .eq('id', card.id).eq('user_id', user.id);
      throw pErr;
    }
    const { count } = await supabase.from('reward_cards').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'new');
    res.json({ ...out(claimed), duplicate: false, balance: await balanceOf(user.id), cardsLeft: count || 0 });
  } catch (e) {
    console.error('[cards] open failed:', e.message);
    res.status(500).json({ error: 'Could not open this card. Please try again.' });
  }
});

module.exports = router;
module.exports._test = { DEFAULT_CARD_RULES, GAMES };
