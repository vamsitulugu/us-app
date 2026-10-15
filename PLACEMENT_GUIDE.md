# Twin Hearts — Pro Subscription System
## Complete Placement Guide (Where Everything Goes)

Pricing: **₹99 / month** and **₹499 lifetime (one-time)**. Pro is **per-couple** — when either partner pays and you (admin) approve, **both partners** get Pro access to Music, Movies, AI Both Mode, and Memory Globe.

---

## ════════════════════════════════════════════════════════════════
## 1. DATABASE — run FIRST (Supabase SQL Editor)
## ════════════════════════════════════════════════════════════════

**File:** `migrations/pro_subscription.sql` (NEW — already created)

Paste the entire file into your Supabase SQL editor and run it BEFORE deploying the backend. It adds:
- `couples.pro_plan` ('monthly' | 'lifetime'), `pro_expires_at`, `pro_activated_at`, `pro_activated_by`
- `pro_upgrade_requests` table (pending/approved/rejected, paid-by + partner details, transaction ID, payment-proof URL)

---

## ═══════════════════════════════════════════════════════════════
## 2. BACKEND — Node.js / Express routes
## ════════════════════════════════════════════════════════════════

### File A: `server.js` (EDIT — already edited)
Add these two blocks:

**(a) Register the public Pro route** — insert right after the music route mount:
```js
app.use('/api/music', require('./routes/music'));
app.use('/api/pro', require('./routes/pro'));   // <-- ADD THIS

// ── Admin Control Center ────────────────────────────────
```

**(b) Register the admin Pro route** — insert after `app.use('/api/admin/notifications', ...)`:
```js
app.use('/api/admin/notifications', require('./routes/admin-notifications'));
app.use('/api/admin/pro', require('./routes/admin-pro'));  // <-- ADD THIS
app.use('/api/admin/flags', require('./routes/admin-flags'));
```

**(c) Auto-create the payments storage bucket** — replace the `app.listen(...)` block at the bottom with:
```js
async function ensureProPaymentsBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const has = (buckets || []).some(b => b.name === 'pro-payments');
    if (!has) {
      await supabase.storage.createBucket('pro-payments', { public: true });
      console.log('[pro] created storage bucket: pro-payments');
    }
  } catch (e) {
    console.warn('[pro] could not ensure pro-payments bucket:', e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`\n💕 Twin Hearts server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  await ensureProPaymentsBucket();
  console.log(`   Press Ctrl+C to stop\n`);
});
```

### File B: `routes/pro.js` (NEW — already created)
Full route file. Place at `routes/pro.js`. Contains:
- `GET /api/pro/status?coupleId=` → returns `{ isPro, plan, expiresAt }`
- `POST /api/pro/upgrade-request` (multipart) → saves payment proof to `pro-payments` bucket + creates a pending request

### File C: `routes/admin-pro.js` (NEW — already created)
Full route file. Place at `routes/admin-pro.js`. Contains:
- `GET /api/admin/pro` → lists all upgrade requests enriched with couple names
- `POST /api/admin/pro/:id/approve` (body `{ plan }`) → activates Pro on the couple (monthly = 30 days, lifetime = never expires)
- `POST /api/admin/pro/:id/reject` (body `{ note }`) → rejects the request

---

## ═══════════════════════════════════════════════════════════════
## 3. FRONTEND — Pro card module
## ════════════════════════════════════════════════════════════════

### File D: `public/js/pro-card.js` (NEW — already created)
Place at `public/js/pro-card.js`. This is the shared upgrade card with:
- Plan picker (₹99/month, ₹499 lifetime, "Best Value" tag)
- Pay button → shows **QR code** (UPI QR via qrserver API)
- "I've Paid" → details form (paid person name/phone, partner name/phone, transaction ID, upload payment screenshot, optional note)
- Submit → sends to admin
- `ProCard.requirePro(feature)` → returns `false` and opens the card if not Pro
- `ProCard.check()` → returns Pro status

**Include it on every page that needs Pro gating:**
```html
<script src="/js/pro-card.js?v=1"></script>
```

---

## ═══════════════════════════════════════════════════════════════
## 4. FRONTEND — Pro features page
## ════════════════════════════════════════════════════════════════

### File E: `public/pro.html` (NEW — already created)
Place at `public/pro.html`. Standalone page listing:
- Plan cards (Monthly ₹99, Lifetime ₹499)
- Pro features grid: Music, Movies, AI Both Mode, Memory Globe (locked), Chat & Vault (free)
- "Upgrade to Pro" button that opens `ProCard.open()`

---

## ═══════════════════════════════════════════════════════════════
## 5. FRONTEND — Shell (index.html) edits
## ════════════════════════════════════════════════════════════════

File: `public/index.html` (EDIT — already edited). Four changes:

**(a) Include pro-card.js** — right after `/both-mode.js` (near line 7697):
```html
<script src="/both-mode.js"></script>
<script src="/js/pro-card.js?v=1"></script>   // <-- ADD THIS
```

**(b) Add Pro page iframe** — right after the `page-globe` div (near line 5442):
```html
<div class="page" id="page-globe">
  <div class="iframe-page-wrap">
    <iframe id="globeFrame" data-src="/globe.html" title="Memory Globe"></iframe>
  </div>
</div>
<div class="page" id="page-pro">                                     // <-- ADD THIS
  <div class="iframe-page-wrap">
    <iframe id="proFrame" data-src="/pro.html" title="Go Pro"></iframe>
  </div>
</div>
```

**(c) Add Pro nav item in sidebar** — after the "AI & Tools" nav group (near line 5324):
```html
<div class="nav-group">
  <div class="nav-label">AI & Tools</div>
  <div class="ni" data-page="ai"><span class="ico">🤖</span>Twin</div>
</div>
<div class="nav-group">                                             // <-- ADD THIS
  <div class="nav-label">Pro</div>
  <div class="ni" data-page="pro"><span class="ico">💎</span>Pro Upgrade<span class="ico ni-chev">›</span></div>
</div>
```

**(d) Add Pro badge on couple widget + Pro badge checker** — two edits:

(i) In the couple-widget div (near line 5288), add the badge span:
```html
<div class="couple-widget" onclick="goto('profile')">
  <div class="av av1" id="sbAv1">U</div>
  <span style="font-size:13px;color:var(--text3)">♥</span>
  <div class="av av2" id="sbAv2">P</div>
  <span class="couple-names" id="coupleLabel">You & Partner</span>
  <span id="sbProBadge" class="sb-pro-badge" style="display:none">Pro</span>  // <-- ADD THIS
</div>
```

(ii) Add badge CSS — right after the `.pulse-off { ... }` block:
```css
.sb-pro-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 42px; height: 20px; border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--accent-d));
  color: #fff; font-size: 10px; font-weight: 800;
  letter-spacing: 0.5px; margin-left: 6px;
  box-shadow: 0 2px 8px var(--accent-glow);
  border: 1px solid rgba(255,255,255,0.2);
  white-space: nowrap;
}
```

(iii) Add the Pro-badge refresh JS — right before `init();` at the bottom (near line 14003):
```js
async function refreshProBadge() {
  try {
    const cid = (window.S && S.coupleId) || (function () {
      try { return JSON.parse(localStorage.getItem('uwl_v5') || 'null')?.coupleId; } catch (e) { return null; }
    })();
    if (!cid) return;
    const res = await fetch('/api/pro/status?coupleId=' + encodeURIComponent(cid), { credentials: 'include' });
    if (!res.ok) return;
    const st = await res.json();
    const badge = document.getElementById('sbProBadge');
    if (badge && st.isPro) {
      badge.style.display = 'inline-flex';
      badge.textContent = st.plan === 'lifetime' ? 'Pro (Lifetime)' : 'Pro';
    } else if (badge) {
      badge.style.display = 'none';
    }
  } catch (e) { /* non-fatal */ }
}
refreshProBadge();
window.addEventListener('storage', refreshProBadge);
document.addEventListener('click', function (e) {
  const el = document.getElementById('th-pro-modal');
  if (el && !el.classList.contains('open') && el.dataset.checked !== '1') {
    el.dataset.checked = '1';
    setTimeout(refreshProBadge, 600);
  }
});

init();
```

---

## ═══════════════════════════════════════════════════════════════
## 6. FRONTEND — Gate Pro tasks (show card on click)
## ════════════════════════════════════════════════════════════════

The Pro card shows when the user tries a Pro task. Edit these three files:

### File F: `public/both-mode.js` (EDIT — already edited)
Replace `switchMode(mode)` start with the Pro gate:
```js
function switchMode(mode) {
  if (mode === state.mode) return;
  // ══ Pro gate ══ "Both" AI mode is Pro-only
  if (mode === 'both' && window.ProCard) {
    (async () => {
      const ok = await window.ProCard.requirePro('AI Both Mode');
      if (!ok) return; // stay in current mode, card is now open
      doSwitch('both');
    })();
    return;
  }
  doSwitch(mode);
}
```

### File G: `public/music.html` (EDIT — already edited)
Include pro-card.js right after `/import-service.js`:
```html
<script src="/import-service.js"></script>
<script src="/js/pro-card.js?v=1"></script>   // <-- ADD THIS
```

### File H: `public/music/library.js` (EDIT — already edited)
Wrap `MX.act('add-songs', ...)` with the Pro check:
```js
MX.act('add-songs', async () => {
  if (!MX.ctx()) { MX.toast('Connect with your partner first'); return; }
  if (!MX.online()) { MX.toast("You're offline — connect to add songs"); return; }
  // ══ Pro gate ══ adding songs is a Pro feature
  if (window.ProCard) {
    const ok = await window.ProCard.requirePro('Music');
    if (!ok) return; // card is now open
  }
  const inp = document.getElementById('fileIn'); if (inp) { inp.value = ''; inp.click(); }
});
```

### File I: `public/globe.html` (EDIT — already edited)
**(i)** Include pro-card.js right after `/js/audio/audio-integration.js`:
```html
<script src="/js/audio/audio-integration.js"></script>
<script src="/js/pro-card.js?v=1"></script>   // <-- ADD THIS
```

**(ii)** Gate the "Pin a Memory" button:
```html
<button class="add-memory-btn" onclick="ProCard.requirePro('Memory Globe').then(ok=>{if(ok)openAddMemory();})">
  <span>📍</span> Pin a Memory
</button>
```

### File J: `public/movie.html` (EDIT — already edited)
**(i)** Include pro-card.js right after `/movie-collection.js?v=2`:
```html
<script src="/movie.js?v=6"></script>
<script src="/movie-collection.js?v=2"></script>
<script src="/js/pro-card.js?v=1"></script>   // <-- ADD THIS
```

**(ii)** Gate "add movie from cloud" — add after the movie-collection script:
```html
<script>
  (function () {
    var el = document.getElementById('btnCloudUpload');
    if (!el) return;
    var orig = el.onclick;
    el.onclick = function (e) {
      ProCard.requirePro('Watch Together').then(function (ok) {
        if (!ok) { e.preventDefault(); e.stopPropagation(); return; }
        if (orig) orig.call(el, e);
      });
    };
  })();
</script>
```

---

## ═══════════════════════════════════════════════════════════════
## 7. ADMIN CONTROL CENTER — Pro Upgrades page
## ════════════════════════════════════════════════════════════════

### File K: `admin/index.html` (EDIT — already edited)
Add the Pro page container after `pageAudit`:
```html
<div id="pageAudit" class="page"></div>
<div id="pagePro" class="page"></div>   // <-- ADD THIS
```

### File L: `admin/admin.js` (EDIT — already edited)
Three edits:

**(i)** Add the Pro icon (near line 18, after the `support` icon entry):
```js
  support: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 13a3.5 3.5 0 0 0 5 0"/>',
  pro: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/><path d="M7 11h2v6h-2zM15 11h2v6h-2zM11 15h2v2h-2z"/>'
```

**(ii)** Add Pro to the NAV menu (after `audit`):
```js
  { id: 'audit', label: 'Audit Logs', icon: 'audit' },
  { id: 'pro', label: 'Pro Upgrades', icon: 'pro' }   // <-- ADD THIS
];
```

**(iii)** Add the `renderers.pro` + `loadPro()` block — insert right before the `SUPPORT & CUSTOMER CARE` comment block. It renders a couples-per-pair table with:
- Couple names (user1 & user2) + paired status
- Plan (Monthly / Lifetime)
- Paid-by person name + phone
- Partner person name + phone
- Transaction ID
- Status badge (pending / approved / rejected)
- Requested date
- "View proof" link (opens the uploaded payment screenshot)
- **Approve** button (choose Monthly ₹99 or Lifetime ₹499 → activates Pro for both partners)
- **Reject** button (optional reason)

### File M: `admin/admin.css` (EDIT — already edited)
Add the pending badge style (near the bottom, after `.hint`):
```css
.badge.pending { background: rgba(251,191,36,.15); color: var(--amber); }
```

---

## ═══════════════════════════════════════════════════════════════
## 8. ENV VAR — required for admin login
## ════════════════════════════════════════════════════════════════

In your `.env` (and Render/Vercel env vars), set:
```
ADMIN_SESSION_SECRET=your_long_random_secret_string_here
```
Without this, the admin panel cannot sign in (it throws loudly on boot).

---

## ═══════════════════════════════════════════════════════════════
## 9. REAL UPI MERCHANT ID (important!)
## ════════════════════════════════════════════════════════════════

In `public/js/pro-card.js`, the QR code uses a placeholder UPI ID. Replace `twinhearts@upi` with your actual merchant UPI ID so customers can pay you:

```js
const upiUrl = `upi://pay?pa=YOUR_ACTUAL_UPI_ID@upi&pn=...`;
```

---

## ═══════════════════════════════════════════════════════════════
## 10. DEPLOYMENT ORDER
## ════════════════════════════════════════════════════════════════

1. Run `migrations/pro_subscription.sql` in Supabase SQL Editor.
2. Set `ADMIN_SESSION_SECRET` in your hosting env vars.
3. Deploy all edited/new files.
4. Log into the Admin Control Center → **Pro Upgrades** → approve pending requests.
5. Once approved, both partners see the **Pro** badge on the couple widget and get access to Music, Movies, AI Both Mode, Memory Globe.

---

## Files summary

| Type | File | Action |
|------|------|--------|
| DB | `migrations/pro_subscription.sql` | NEW — run in Supabase |
| Backend | `server.js` | EDIT — register 2 routes + bucket |
| Backend | `routes/pro.js` | NEW |
| Backend | `routes/admin-pro.js` | NEW |
| Frontend | `public/js/pro-card.js` | NEW — shared upgrade card |
| Frontend | `public/pro.html` | NEW — Pro features page |
| Frontend | `public/index.html` | EDIT — script, iframe, nav, badge |
| Frontend | `public/both-mode.js` | EDIT — gate AI Both mode |
| Frontend | `public/music.html` | EDIT — include pro-card |
| Frontend | `public/music/library.js` | EDIT — gate add-songs |
| Frontend | `public/globe.html` | EDIT — include + gate Pin Memory |
| Frontend | `public/movie.html` | EDIT — include + gate add movie |
| Admin | `admin/index.html` | EDIT — add pagePro container |
| Admin | `admin/admin.js` | EDIT — icon, nav, renderer |
| Admin | `admin/admin.css` | EDIT — pending badge style |

All JS files have been syntax-checked and load correctly. The only server-boot error you may see locally (`@aws-sdk/client-s3` missing in `movie-library.js`) is **pre-existing and unrelated** to these Pro changes.
