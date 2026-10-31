// ════════════════════════════════════════════════════════════════
//  lib/pro-plans.js — Pro plans + entitlement maths (pure, no I/O)
//  The server is the ONLY place that decides prices and durations.
//  The apps just send a plan id ('monthly' | 'yearly' | 'lifetime').
// ════════════════════════════════════════════════════════════════
const DAY_MS = 24 * 60 * 60 * 1000;

const PLANS = {
  monthly:  { id: 'monthly',  label: 'Monthly',  amountPaise: 99 * 100,  days: 30,   rank: 1 },
  yearly:   { id: 'yearly',   label: 'Yearly',   amountPaise: 499 * 100, days: 365,  rank: 2 },
  lifetime: { id: 'lifetime', label: 'Lifetime', amountPaise: 999 * 100, days: null, rank: 3 }
};

function isValidPlan(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PLANS, id);
}

/** { isPro, plan, expiresAt } from a `couples` row's pro_* columns. */
function statusFromCouple(couple, now = new Date()) {
  if (!couple) return { isPro: false, plan: null, expiresAt: null };
  if (couple.pro_plan === 'lifetime') return { isPro: true, plan: 'lifetime', expiresAt: null };
  if ((couple.pro_plan === 'monthly' || couple.pro_plan === 'yearly') && couple.pro_expires_at &&
      new Date(couple.pro_expires_at) > now) {
    return { isPro: true, plan: couple.pro_plan, expiresAt: new Date(couple.pro_expires_at).toISOString() };
  }
  return { isPro: false, plan: null, expiresAt: null };
}

/**
 * The couple's new pro_* values after paying for `planId`.
 *  - Paying while still active EXTENDS from the current expiry (no lost days).
 *  - A lower plan never replaces a higher one that is still active.
 *  - Lifetime never expires and can never be downgraded.
 */
function applyPurchase(couple, planId, now = new Date()) {
  const plan = PLANS[planId];
  if (!plan) throw new Error('Unknown plan');
  const cur = statusFromCouple(couple, now);
  if (cur.plan === 'lifetime') return { pro_plan: 'lifetime', pro_expires_at: null };
  if (plan.id === 'lifetime') return { pro_plan: 'lifetime', pro_expires_at: null };
  const base = cur.isPro && cur.expiresAt ? new Date(cur.expiresAt) : now;
  const expires = new Date(base.getTime() + plan.days * DAY_MS).toISOString();
  const keepPlan = cur.isPro && PLANS[cur.plan].rank > plan.rank ? cur.plan : plan.id;
  return { pro_plan: keepPlan, pro_expires_at: expires };
}

module.exports = { PLANS, DAY_MS, isValidPlan, statusFromCouple, applyPurchase };
