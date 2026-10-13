// ═══════════════════════════════════════════════════════════════
//  Support Store — Dual Storage Engine (Supabase + Local Fallback)
//  ─────────────────────────────────────────────────────────────
//  If Supabase `support_tickets` and `support_messages` exist,
//  it uses Supabase. If the migration has not been run yet in the
//  Supabase dashboard, it transparently falls back to local JSON
//  persistence in `data/support_store.json` so support chat and
//  admin dashboard work instantly with zero errors or disruption.
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../middleware/supabase');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_STORE_FILE = path.join(DATA_DIR, 'support_store.json');

let hasSupabaseTable = null; // null = unverified, true = yes, false = fallback

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (_) {}

function readLocal() {
  try {
    if (fs.existsSync(LOCAL_STORE_FILE)) {
      const raw = fs.readFileSync(LOCAL_STORE_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[supportStore] local read error:', e.message);
  }
  return { tickets: {}, messages: [] };
}

function writeLocal(data) {
  try {
    fs.writeFileSync(LOCAL_STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[supportStore] local write error:', e.message);
  }
}

async function checkSupabaseAvailable() {
  if (hasSupabaseTable !== null) return hasSupabaseTable;
  try {
    const { error } = await supabase.from('support_tickets').select('id').limit(1);
    if (error && (error.message?.includes('schema cache') || error.code === '42P01')) {
      hasSupabaseTable = false;
    } else if (error) {
      console.warn('[supportStore] Supabase check warning:', error.message);
      hasSupabaseTable = false;
    } else {
      hasSupabaseTable = true;
    }
  } catch (e) {
    hasSupabaseTable = false;
  }
  return hasSupabaseTable;
}

// ── GET OR CREATE TICKET ────────────────────────────────────────
async function getOrCreateTicket(payload = {}) {
  const isSupa = await checkSupabaseAvailable();
  const ticketId = payload.ticketId || uuidv4();
  const now = new Date().toISOString();

  if (isSupa) {
    try {
      if (payload.ticketId) {
        const { data: existing, error: findErr } = await supabase
          .from('support_tickets')
          .select('*')
          .eq('id', payload.ticketId)
          .maybeSingle();

        if (existing && !findErr) {
          // Update user info if provided
          if (payload.userName || payload.userEmail || payload.userPhone) {
            const updates = { updated_at: now };
            if (payload.userName) updates.user_name = payload.userName;
            if (payload.userEmail) updates.user_email = payload.userEmail;
            if (payload.userPhone) updates.user_phone = payload.userPhone;
            await supabase.from('support_tickets').update(updates).eq('id', existing.id);
            Object.assign(existing, updates);
          }
          return existing;
        }
      }

      // Check if user has an active open ticket by couple_id or user_id
      if (payload.couple_id || payload.userId) {
        let q = supabase.from('support_tickets').select('*').neq('status', 'resolved');
        if (payload.couple_id) q = q.eq('couple_id', payload.couple_id);
        else if (payload.userId) q = q.eq('user_id', payload.userId);
        const { data: active } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (active) return active;
      }

      // Create new ticket
      const newTicket = {
        id: ticketId,
        user_id: payload.userId || null,
        couple_id: payload.couple_id || null,
        user_name: payload.userName || 'Valued User',
        user_email: payload.userEmail || null,
        user_phone: payload.userPhone || null,
        subject: payload.subject || 'General Inquiry',
        status: 'open',
        mode: payload.mode || 'ai',
        last_message: 'Session started',
        unread_admin: 0,
        unread_user: 0,
        created_at: now,
        updated_at: now
      };

      const { data, error } = await supabase.from('support_tickets').insert(newTicket).select().single();
      if (!error && data) return data;
    } catch (e) {
      console.warn('[supportStore] Supabase getOrCreateTicket error, falling back:', e.message);
    }
  }

  // ── Local fallback ──
  const store = readLocal();
  if (payload.ticketId && store.tickets[payload.ticketId]) {
    const t = store.tickets[payload.ticketId];
    if (payload.userName) t.user_name = payload.userName;
    if (payload.userEmail) t.user_email = payload.userEmail;
    if (payload.userPhone) t.user_phone = payload.userPhone;
    t.updated_at = now;
    writeLocal(store);
    return t;
  }

  // Check active ticket
  const list = Object.values(store.tickets);
  const found = list.find(t => 
    t.status !== 'resolved' && 
    ((payload.couple_id && t.couple_id === payload.couple_id) || 
     (payload.userId && t.user_id === payload.userId))
  );
  if (found) return found;

  const newTicket = {
    id: ticketId,
    user_id: payload.userId || null,
    couple_id: payload.couple_id || null,
    user_name: payload.userName || 'Valued User',
    user_email: payload.userEmail || null,
    user_phone: payload.userPhone || null,
    subject: payload.subject || 'General Inquiry',
    status: 'open',
    mode: payload.mode || 'ai',
    last_message: 'Session started',
    unread_admin: 0,
    unread_user: 0,
    created_at: now,
    updated_at: now
  };

  store.tickets[ticketId] = newTicket;
  writeLocal(store);
  return newTicket;
}

// ── GET TICKET BY ID WITH MESSAGES ──────────────────────────────
async function getTicket(ticketId) {
  const isSupa = await checkSupabaseAvailable();

  if (isSupa) {
    try {
      const { data: ticket, error: tErr } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('id', ticketId)
        .maybeSingle();

      if (ticket && !tErr) {
        const { data: messages } = await supabase
          .from('support_messages')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: true });

        return { ...ticket, messages: messages || [] };
      }
    } catch (e) {
      console.warn('[supportStore] Supabase getTicket error, falling back:', e.message);
    }
  }

  const store = readLocal();
  const ticket = store.tickets[ticketId];
  if (!ticket) return null;

  const messages = store.messages
    .filter(m => m.ticket_id === ticketId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return { ...ticket, messages };
}

// ── ADD MESSAGE ────────────────────────────────────────────────
async function addMessage({ ticketId, sender, senderName, text }) {
  const isSupa = await checkSupabaseAvailable();
  const now = new Date().toISOString();
  const messageId = uuidv4();

  const msgObj = {
    id: messageId,
    ticket_id: ticketId,
    sender: sender || 'user',
    sender_name: senderName || (sender === 'admin' ? 'Support Agent' : sender === 'ai' ? 'Twin Care AI' : 'User'),
    text: String(text || '').trim(),
    read: sender === 'admin',
    created_at: now
  };

  if (isSupa) {
    try {
      const { data: insertedMsg, error: mErr } = await supabase
        .from('support_messages')
        .insert(msgObj)
        .select()
        .single();

      if (!mErr && insertedMsg) {
        // Update ticket last_message, unread count & status
        const updates = {
          last_message: msgObj.text.slice(0, 140),
          updated_at: now
        };
        if (sender === 'user') {
          updates.status = 'waiting_admin';
          const { data: cur } = await supabase.from('support_tickets').select('unread_admin').eq('id', ticketId).maybeSingle();
          updates.unread_admin = (cur?.unread_admin || 0) + 1;
        } else if (sender === 'admin') {
          updates.status = 'waiting_user';
          updates.unread_admin = 0;
          const { data: cur } = await supabase.from('support_tickets').select('unread_user').eq('id', ticketId).maybeSingle();
          updates.unread_user = (cur?.unread_user || 0) + 1;
        } else if (sender === 'ai') {
          // AI message
          updates.status = 'open';
        }

        await supabase.from('support_tickets').update(updates).eq('id', ticketId);
        return insertedMsg;
      }
    } catch (e) {
      console.warn('[supportStore] Supabase addMessage error, falling back:', e.message);
    }
  }

  // Local fallback
  const store = readLocal();
  store.messages.push(msgObj);

  if (store.tickets[ticketId]) {
    const t = store.tickets[ticketId];
    t.last_message = msgObj.text.slice(0, 140);
    t.updated_at = now;
    if (sender === 'user') {
      t.status = 'waiting_admin';
      t.unread_admin = (t.unread_admin || 0) + 1;
    } else if (sender === 'admin') {
      t.status = 'waiting_user';
      t.unread_admin = 0;
      t.unread_user = (t.unread_user || 0) + 1;
    } else if (sender === 'ai') {
      t.status = 'open';
    }
  }
  writeLocal(store);
  return msgObj;
}

// ── UPDATE TICKET STATUS ───────────────────────────────────────
async function updateTicketStatus(ticketId, status) {
  const isSupa = await checkSupabaseAvailable();
  const now = new Date().toISOString();

  if (isSupa) {
    try {
      const updates = { status, updated_at: now };
      if (status === 'resolved') {
        updates.unread_admin = 0;
        updates.unread_user = 0;
      }
      const { data, error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', ticketId)
        .select()
        .single();
      if (!error && data) return data;
    } catch (e) {
      console.warn('[supportStore] Supabase updateTicketStatus error, falling back:', e.message);
    }
  }

  const store = readLocal();
  if (store.tickets[ticketId]) {
    store.tickets[ticketId].status = status;
    store.tickets[ticketId].updated_at = now;
    if (status === 'resolved') {
      store.tickets[ticketId].unread_admin = 0;
      store.tickets[ticketId].unread_user = 0;
    }
    writeLocal(store);
    return store.tickets[ticketId];
  }
  return null;
}

// ── SWITCH TICKET MODE (ai / human) ────────────────────────────
async function switchTicketMode(ticketId, mode) {
  const isSupa = await checkSupabaseAvailable();
  const now = new Date().toISOString();

  if (isSupa) {
    try {
      const updates = { mode, updated_at: now };
      if (mode === 'human') updates.status = 'waiting_admin';
      const { data, error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', ticketId)
        .select()
        .single();
      if (!error && data) return data;
    } catch (e) {
      console.warn('[supportStore] Supabase switchTicketMode error, falling back:', e.message);
    }
  }

  const store = readLocal();
  if (store.tickets[ticketId]) {
    store.tickets[ticketId].mode = mode;
    store.tickets[ticketId].updated_at = now;
    if (mode === 'human') store.tickets[ticketId].status = 'waiting_admin';
    writeLocal(store);
    return store.tickets[ticketId];
  }
  return null;
}

// ── LIST TICKETS FOR ADMIN ─────────────────────────────────────
async function listTickets({ status, search, page = 1, pageSize = 30 } = {}) {
  const isSupa = await checkSupabaseAvailable();

  if (isSupa) {
    try {
      let q = supabase
        .from('support_tickets')
        .select('*', { count: 'exact' });

      if (status && status !== 'all') {
        if (status === 'waiting') {
          q = q.eq('status', 'waiting_admin');
        } else {
          q = q.eq('status', status);
        }
      }

      if (search) {
        q = q.or(`user_name.ilike.%${search}%,user_email.ilike.%${search}%,last_message.ilike.%${search}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      q = q.order('updated_at', { ascending: false }).range(from, to);

      const { data, error, count } = await q;
      if (!error) {
        return {
          tickets: data || [],
          total: count || 0,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil((count || 0) / pageSize))
        };
      }
    } catch (e) {
      console.warn('[supportStore] Supabase listTickets error, falling back:', e.message);
    }
  }

  // Local fallback
  const store = readLocal();
  let list = Object.values(store.tickets);

  if (status && status !== 'all') {
    if (status === 'waiting') list = list.filter(t => t.status === 'waiting_admin');
    else list = list.filter(t => t.status === status);
  }

  if (search) {
    const s = search.toLowerCase();
    list = list.filter(t =>
      (t.user_name && t.user_name.toLowerCase().includes(s)) ||
      (t.user_email && t.user_email.toLowerCase().includes(s)) ||
      (t.last_message && t.last_message.toLowerCase().includes(s))
    );
  }

  list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  const total = list.length;
  const from = (page - 1) * pageSize;
  const sliced = list.slice(from, from + pageSize);

  return {
    tickets: sliced,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

// ── GET OVERVIEW STATS FOR ADMIN ───────────────────────────────
async function getStats() {
  const isSupa = await checkSupabaseAvailable();

  if (isSupa) {
    try {
      const [totalRes, waitingRes, openRes, resolvedRes] = await Promise.all([
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'waiting_admin'),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'resolved')
      ]);

      return {
        total: totalRes.count || 0,
        waiting_admin: waitingRes.count || 0,
        open: openRes.count || 0,
        resolved: resolvedRes.count || 0
      };
    } catch (e) {
      console.warn('[supportStore] Supabase getStats error, falling back:', e.message);
    }
  }

  const store = readLocal();
  const list = Object.values(store.tickets);
  return {
    total: list.length,
    waiting_admin: list.filter(t => t.status === 'waiting_admin').length,
    open: list.filter(t => t.status === 'open').length,
    resolved: list.filter(t => t.status === 'resolved').length
  };
}

// ── DELETE TICKET ──────────────────────────────────────────────
async function deleteTicket(ticketId) {
  const isSupa = await checkSupabaseAvailable();

  if (isSupa) {
    try {
      await supabase.from('support_messages').delete().eq('ticket_id', ticketId);
      const { error } = await supabase.from('support_tickets').delete().eq('id', ticketId);
      if (!error) return true;
    } catch (e) {
      console.warn('[supportStore] Supabase deleteTicket error, falling back:', e.message);
    }
  }

  const store = readLocal();
  delete store.tickets[ticketId];
  store.messages = store.messages.filter(m => m.ticket_id !== ticketId);
  writeLocal(store);
  return true;
}

module.exports = {
  getOrCreateTicket,
  getTicket,
  addMessage,
  updateTicketStatus,
  switchTicketMode,
  listTickets,
  getStats,
  deleteTicket
};
