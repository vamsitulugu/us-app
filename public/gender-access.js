/* ══════════════════════════════════════════════════════════════
   GENDER ACCESS — "Girl / Boy" choice and what it controls.
   Stored in the shared state at S.profile.u1|u2.gender ('female' | 'male')
   (same per-person profile entry the app already uses for name/bday/avatar).
   The signup screen (landing.html) remembers the choice on this device as
   localStorage 'uwl_gender_<userId>'; it is copied into the profile on first load.

   Period page rule:
     girl  → can log periods, save symptoms, delete entries (full access)
     boy   → sees everything, read-only
     not chosen yet → read-only, and we ask once ("Not now" is allowed)
   The server also refuses period/symptom changes from an account marked 'male'
   (routes/data.js), so a stale copy on a boy's device can't overwrite her data.
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Gender = (() => {
  const valid = g => g === 'female' || g === 'male';
  const rk = () => (window.S && S.role === 'user2' ? 'u2' : 'u1');
  const otherRk = () => (rk() === 'u1' ? 'u2' : 'u1');
  const lsKey = () => 'uwl_gender_' + (window.S && S.userId);
  const say = m => { if (typeof toast === 'function') toast(m); };
  const partnerName = () => (window.S && S.partnerName) || 'your partner';

  function mine() {
    if (!window.S) return '';
    const g = S.profile && S.profile[rk()] && S.profile[rk()].gender;
    if (valid(g)) return g;
    try { const l = localStorage.getItem(lsKey()); if (valid(l)) return l; } catch (_) { /* private mode */ }
    return '';
  }
  function partner() {
    const g = window.S && S.profile && S.profile[otherRk()] && S.profile[otherRk()].gender;
    return valid(g) ? g : '';
  }
  function set(g) {
    if (!valid(g) || !window.S) return;
    if (!S.profile) S.profile = {};
    S.profile[rk()] = { ...(S.profile[rk()] || {}), gender: g };
    try { localStorage.setItem(lsKey(), g); } catch (_) { /* ignore */ }
    if (typeof scheduleSave === 'function') scheduleSave();
    applyPeriodAccess();
  }
  const canEditPeriod = () => mine() === 'female';

  function guardPeriod() {
    if (canEditPeriod()) return true;
    say(mine() ? 'Only the girl can change the period data 💗' : 'Choose Girl or Boy first to edit this page');
    return false;
  }

  /* ── Period page: view-only mode + banner ── */
  function applyPeriodAccess() {
    const page = document.getElementById('page-period');
    if (!page || !window.S) return;
    const edit = canEditPeriod();
    page.classList.toggle('is-readonly', !edit);
    let b = page.querySelector(':scope > .ga-banner');
    if (!b) { b = document.createElement('div'); b.className = 'ga-banner'; page.prepend(b); }
    b.hidden = edit;
    if (edit) return;
    b.replaceChildren();
    const t = document.createElement('span');
    if (mine() === 'male') {
      t.textContent = `👀 View only — ${partnerName()} manages this page. You can follow everything they log.`;
      b.append(t);
    } else {
      t.textContent = 'Tell us if you are a girl or a boy to set up this page.';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = 'Choose';
      btn.onclick = () => choose();
      b.append(t, btn);
    }
  }

  /* ── Chooser sheet ── */
  let sheet = null;
  function choose() {
    if (sheet) { sheet.classList.add('open'); return; }
    sheet = document.createElement('div');
    sheet.className = 'ga-overlay';
    sheet.innerHTML = `
      <div class="ga-sheet" role="dialog" aria-label="Choose Girl or Boy">
        <div class="ga-grab"></div>
        <h3>One quick thing 💕</h3>
        <p>Are you a girl or a boy? This sets the right access on the Period page. You can change it later in Settings.</p>
        <div class="ga-row">
          <button type="button" data-g="female"><span>👩</span>Girl</button>
          <button type="button" data-g="male"><span>👨</span>Boy</button>
        </div>
        <button type="button" class="ga-later">Not now</button>
      </div>`;
    sheet.addEventListener('click', e => {
      const g = e.target.closest('[data-g]');
      if (g) { set(g.dataset.g); sheet.classList.remove('open'); say('Saved 💕'); return; }
      if (e.target.closest('.ga-later') || e.target === sheet) { sheet.classList.remove('open'); try { sessionStorage.setItem('uwl_gender_later', '1'); } catch (_) {} }
    });
    document.body.append(sheet);
    requestAnimationFrame(() => sheet.classList.add('open'));
  }

  /* ── On load: copy the signup choice into the profile; ask once if still unknown ── */
  function ensure() {
    if (!window.S || !S.userId) return false;
    const g = mine();
    if (g) {
      if (!(S.profile && S.profile[rk()] && S.profile[rk()].gender === g)) set(g);   // push local choice into the shared profile
      applyPeriodAccess();
      return true;
    }
    applyPeriodAccess();
    let later = false; try { later = sessionStorage.getItem('uwl_gender_later') === '1'; } catch (_) {}
    if (!later) choose();
    return true;
  }

  function init() {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      // wait for the cloud copy of the profile to arrive before deciding the gender is unknown
      if (window.S && S.userId && S.setupDone && tries >= 6) { clearInterval(iv); ensure(); }
      else if (tries > 40) clearInterval(iv);
    }, 1000);
  }

  return { mine, partner, set, canEditPeriod, guardPeriod, applyPeriodAccess, choose, ensure, init };
})();

window.Gender = Gender;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Gender.init); else Gender.init();
