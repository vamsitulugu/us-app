// ═══════════════════════════════════════════════════════════════
//  Admin Support Routes — Dedicated Customer Care Control Center
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { requireAdmin, logAudit } = require('../middleware/adminAuth');
const supportStore = require('../lib/supportStore');

router.use(requireAdmin);

// ── GET /api/admin/support/overview ────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const stats = await supportStore.getStats();
    res.json({ stats });
  } catch (err) {
    console.error('[admin-support] stats failed:', err.message);
    res.status(500).json({ error: 'Failed to load support stats' });
  }
});

// ── GET /api/admin/support/tickets ─────────────────────────────
router.get('/tickets', async (req, res) => {
  try {
    const status = (req.query.status || 'all').trim();
    const search = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 30));

    const result = await supportStore.listTickets({ status, search, page, pageSize });
    res.json(result);
  } catch (err) {
    console.error('[admin-support] tickets failed:', err.message);
    res.status(500).json({ error: 'Failed to load support tickets' });
  }
});

// ── GET /api/admin/support/ticket/:ticketId ────────────────────
router.get('/ticket/:ticketId', async (req, res) => {
  try {
    const ticket = await supportStore.getTicket(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket });
  } catch (err) {
    console.error('[admin-support] get ticket failed:', err.message);
    res.status(500).json({ error: 'Failed to load ticket details' });
  }
});

// ── POST /api/admin/support/ticket/:ticketId/reply ─────────────
// Admin replies to the customer
router.post('/ticket/:ticketId/reply', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { text, adminName } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Reply text is required' });
    }

    const ticket = await supportStore.getTicket(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const msg = await supportStore.addMessage({
      ticketId,
      sender: 'admin',
      senderName: adminName || (req.admin?.email ? `Admin (${req.admin.email.split('@')[0]})` : 'Twin Hearts Support'),
      text: text.trim()
    });

    try {
      await logAudit(req, 'support.reply', {
        ticketId,
        userName: ticket.user_name,
        replyLength: text.length
      });
    } catch (_) {}

    const updated = await supportStore.getTicket(ticketId);
    res.json({ success: true, message: msg, ticket: updated });
  } catch (err) {
    console.error('[admin-support] reply failed:', err.message);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// ── PATCH /api/admin/support/ticket/:ticketId/status ───────────
router.patch('/ticket/:ticketId/status', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;

    if (!['open', 'waiting_admin', 'waiting_user', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = await supportStore.updateTicketStatus(ticketId, status);
    if (!updated) return res.status(404).json({ error: 'Ticket not found' });

    try {
      await logAudit(req, 'support.update_status', { ticketId, status });
    } catch (_) {}

    res.json({ success: true, ticket: updated });
  } catch (err) {
    console.error('[admin-support] status update failed:', err.message);
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});

// ── DELETE /api/admin/support/ticket/:ticketId ─────────────────
router.delete('/ticket/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;
    await supportStore.deleteTicket(ticketId);

    try {
      await logAudit(req, 'support.delete', { ticketId });
    } catch (_) {}

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-support] delete ticket failed:', err.message);
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

module.exports = router;
