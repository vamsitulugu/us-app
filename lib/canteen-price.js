// Twin Cinema canteen: the SERVER decides every price. The cinema only sends item ids + which options were picked.
// lib/canteen-menu.json is generated from the cinema repo (npm run export-menu in twin-cinemas). Prices are Gold Coins.
const menu = require('./canteen-menu.json');
const BY = new Map(menu.items.map(i => [i.id, i]));
const MAX_LINES = 12, MAX_QTY = 20, MAX_TOTAL = 2000;

/** lines: [{ id, qty, sel:[[optionIndex,...] per option group] }]  ->  { ok:true, total, lines:[{id,name,qty,unit}] } | { ok:false, error } */
function priceOrder(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) return { ok: false, error: 'Your order is empty or too big.' };
  let total = 0; const out = [];
  for (const l of lines) {
    const item = l && typeof l.id === 'string' ? BY.get(l.id) : null;
    if (!item) return { ok: false, error: 'An item is no longer on the menu.' };
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY) return { ok: false, error: 'Wrong quantity.' };
    const sel = Array.isArray(l.sel) ? l.sel : [];
    if (sel.length !== item.groups.length) return { ok: false, error: 'Please choose your options again.' };
    let unit = item.price;
    for (let gi = 0; gi < item.groups.length; gi++) {
      const g = item.groups[gi], picks = sel[gi];
      if (!Array.isArray(picks)) return { ok: false, error: 'Please choose your options again.' };
      const uniq = new Set(picks);
      if (uniq.size !== picks.length || picks.some(o => !Number.isInteger(o) || o < 0 || o >= g.opts.length)) return { ok: false, error: 'Please choose your options again.' };
      if (!g.multi && picks.length > 1) return { ok: false, error: 'Please choose your options again.' };
      if (g.req && picks.length < 1) return { ok: false, error: 'Please choose: ' + g.name };
      for (const o of picks) unit += g.opts[o].p;
    }
    total += unit * l.qty;
    out.push({ id: item.id, name: item.name, qty: l.qty, unit });
  }
  if (total < 1 || total > MAX_TOTAL) return { ok: false, error: 'This order is too big.' };
  return { ok: true, total, lines: out };
}
module.exports = { priceOrder, MENU_ITEMS: menu.items };
