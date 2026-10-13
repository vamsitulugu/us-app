// ═══════════════════════════════════════════════════════════════
//  Support Routes — Public / App User Customer Care & AI Help
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const supportStore = require('../lib/supportStore');

const GROQ_MODELS = [
  process.env.GROQ_SUPPORT_MODEL,
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile'
].filter(Boolean);

async function callGroqChat(messages, maxTokens = 600) {
  let lastErr = null;
  for (const model of GROQ_MODELS) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.6
        }),
      });
      const data = await response.json();
      if (response.ok && data.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
      }
      if (!response.ok) {
        lastErr = new Error(data.error?.message || `Groq error ${response.status}`);
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No Groq model succeeded');
}

// ── Curated FAQs & Quick Answers ───────────────────────────────
const FAQS = [
  {
    id: 'faq-pair',
    category: 'Pairing & Account',
    question: 'How do I connect / pair with my partner?',
    answer: 'To pair with your partner, both of you need to install the Twin Hearts app. Go to Settings > Partner Connection, enter your partner\'s 10-digit registered phone number, and tap "Send connection request". Your partner will receive the request under "Requests received" and can tap "Accept" to instantly link your accounts!',
    tags: ['pairing', 'partner', 'connect', 'phone']
  },
  {
    id: 'faq-pin',
    category: 'Privacy & Security',
    question: 'How does the Secret Vault and PIN work?',
    answer: 'Your Vault is a private encrypted space for your most personal notes, photos, and memories. You set a 4-digit PIN when signing up. You can change your PIN anytime from Settings > Privacy & Security > Change vault PIN by entering your current PIN and choosing a new one.',
    tags: ['vault', 'pin', 'security', 'password', 'privacy']
  },
  {
    id: 'faq-globe',
    category: 'Memory Globe & Map',
    question: 'How do I add pins and memories to the Memory Globe?',
    answer: 'Open the Globe page from the bottom menu. You can rotate the 3D earth to any location. Tap anywhere on the globe or use the Search bar to find cities, and tap "Add Memory". You can attach photos, dates, travel stories, and budgets to every pin.',
    tags: ['globe', '3d', 'memories', 'travel', 'trips']
  },
  {
    id: 'faq-livemap',
    category: 'Memory Globe & Map',
    question: 'How does live location tracking and privacy work?',
    answer: 'Live Map allows you and your partner to see each other\'s real-time distance and location status. Location sharing is 100% private between the two of you only. You can adjust privacy settings or pause location sharing anytime in the Live Map settings menu.',
    tags: ['location', 'map', 'live', 'distance', 'gps', 'privacy']
  },
  {
    id: 'faq-music',
    category: 'Music & Entertainment',
    question: 'Can my partner and I listen to music together in sync?',
    answer: 'Yes! The Music player lets you stream songs, share custom tracks, and listen together. When both of you are connected, playback and karaoke lyrics synchronize so you feel like you are listening in the same room.',
    tags: ['music', 'songs', 'karaoke', 'sync', 'listen together']
  },
  {
    id: 'faq-watch',
    category: 'Music & Entertainment',
    question: 'How do we watch movies together?',
    answer: 'Open "Watch Together" from the app menu. Choose a video or movie link from the library, invite your partner, and enjoy synchronous video streaming with live couple reactions!',
    tags: ['movie', 'watch together', 'video', 'stream']
  },
  {
    id: 'faq-notifications',
    category: 'Notifications & Alerts',
    question: 'Why am I not receiving notifications from my partner?',
    answer: 'Make sure push notifications are enabled both in the app (Settings > Notifications > Push notifications toggle) and in your phone\'s system settings for the Twin Hearts app. Also check that Quiet Hours / DND isn\'t silencing alerts during your sleep schedule.',
    tags: ['notifications', 'push', 'alerts', 'quiet hours', 'dnd']
  },
  {
    id: 'faq-offline',
    category: 'Troubleshooting & Sync',
    question: 'Does Twin Hearts work offline or with slow internet?',
    answer: 'Twin Hearts saves your journal, photos, and messages locally in your device cache so you can read memories even without internet. When you reconnect to Wi-Fi or cellular data, all changes sync to the cloud automatically.',
    tags: ['offline', 'sync', 'cloud', 'backup', 'data']
  }
];

// ── GET /api/support/faqs ──────────────────────────────────────
router.get('/faqs', (req, res) => {
  res.json({ faqs: FAQS });
});

// ── POST /api/support/ai-ask ───────────────────────────────────
// Specialized AI Customer Care Assistant
router.post('/ai-ask', async (req, res) => {
  const { question, myName, partnerName, history = [] } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: 'AI support service is temporarily unavailable. Please switch to Live Support to chat with an agent.'
    });
  }

  const systemPrompt = `You are "Twin Care AI", the official customer support assistant for the "Twin Hearts" couple application.
The user's name is "${myName || 'Valued User'}"${partnerName ? ` (partner is ${partnerName})` : ''}.

Twin Hearts is a private couple application featuring:
- Couple Pairing via phone number and instant requests
- Private real-time Couple Chat with voice notes, media, and reactions
- 3D Memory Globe for pinning travel memories and photos
- Live Map with real-time location and distance updates (with privacy controls)
- Music & Karaoke with shared synced playback
- Watch Together for movies & shared video streaming
- Secret Vault protected by 4-digit PIN
- Daily Routine, Love Counter, and Dream Goals
- Customizable themes (Dark Plum/Rose and Light Burgundy/Blush)

Your role as Twin Care AI:
1. Provide accurate, clear, friendly, and step-by-step guidance on how to use any feature in Twin Hearts.
2. Be empathetic, polite, warm, and concise (2-4 paragraphs maximum).
3. If the user's issue seems like an account bug, billing problem, phone number change, or if they ask to speak with a real human or customer support agent, kindly answer what you can AND explicitly let them know they can click the "Talk to Human Agent / Live Chat" button right below to reach the Twin Hearts admin team directly.`;

  try {
    const messages = [{ role: 'system', content: systemPrompt }];

    // Include recent history if provided
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history.slice(-6)) {
        if (h.sender === 'user' && h.text) messages.push({ role: 'user', content: h.text });
        else if (h.sender === 'ai' && h.text) messages.push({ role: 'assistant', content: h.text });
      }
    }

    messages.push({ role: 'user', content: question });

    const answer = await callGroqChat(messages, 800);
    return res.json({ answer });
  } catch (err) {
    console.error('[support ai-ask error]:', err.message);
    return res.status(500).json({
      error: 'Could not generate an AI response right now. Please switch to Live Agent chat.'
    });
  }
});

// ── POST /api/support/ticket ───────────────────────────────────
// Initialize or fetch support session
router.post('/ticket', async (req, res) => {
  try {
    const { ticketId, userId, couple_id, userName, userEmail, userPhone, subject, mode } = req.body;
    const ticket = await supportStore.getOrCreateTicket({
      ticketId,
      userId,
      couple_id,
      userName,
      userEmail,
      userPhone,
      subject,
      mode: mode || 'ai'
    });

    const fullTicket = await supportStore.getTicket(ticket.id);
    return res.json({ ticket: fullTicket });
  } catch (err) {
    console.error('[support/ticket error]:', err.message);
    return res.status(500).json({ error: 'Failed to initialize support ticket' });
  }
});

// ── GET /api/support/ticket/:ticketId ──────────────────────────
router.get('/ticket/:ticketId', async (req, res) => {
  try {
    const ticket = await supportStore.getTicket(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    return res.json({ ticket });
  } catch (err) {
    console.error('[support/ticket/:id error]:', err.message);
    return res.status(500).json({ error: 'Failed to retrieve ticket' });
  }
});

// ── POST /api/support/ticket/:ticketId/message ─────────────────
// User sends a message (can trigger AI response if in AI mode)
router.post('/ticket/:ticketId/message', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { text, senderName, askAi = false } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const ticket = await supportStore.getTicket(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Add user message
    const userMsg = await supportStore.addMessage({
      ticketId,
      sender: 'user',
      senderName: senderName || ticket.user_name,
      text: text.trim()
    });

    let aiMsg = null;

    // If ticket mode is 'ai' or user requested AI answer
    if ((ticket.mode === 'ai' || askAi) && process.env.GROQ_API_KEY) {
      try {
        const systemPrompt = `You are "Twin Care AI", the official customer support assistant for "Twin Hearts".
The user is "${ticket.user_name || 'Valued User'}".
Provide helpful, warm, accurate support about Twin Hearts features (Pairing, Chat, Globe, Music, Live Map, PIN Vault).
If the user needs manual human assistance or if the query requires account-level investigation, invite them to toggle to "Live Support" anytime. Keep answers concise.`;

        const history = (ticket.messages || []).slice(-6).map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text
        }));

        history.push({ role: 'user', content: text.trim() });

        const aiReplyText = await callGroqChat([{ role: 'system', content: systemPrompt }, ...history], 600);
        if (aiReplyText) {
          aiMsg = await supportStore.addMessage({
            ticketId,
            sender: 'ai',
            senderName: 'Twin Care AI',
            text: aiReplyText
          });
        }
      } catch (aiErr) {
        console.warn('[support AI response failed]:', aiErr.message);
      }
    }

    const updatedTicket = await supportStore.getTicket(ticketId);
    return res.json({
      success: true,
      userMessage: userMsg,
      aiMessage: aiMsg,
      ticket: updatedTicket
    });
  } catch (err) {
    console.error('[support send message error]:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── POST /api/support/ticket/:ticketId/switch-mode ─────────────
router.post('/ticket/:ticketId/switch-mode', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { mode } = req.body; // 'ai' or 'human'

    if (!['ai', 'human'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    const ticket = await supportStore.switchTicketMode(ticketId, mode);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Send a system message recording the switch
    if (mode === 'human') {
      await supportStore.addMessage({
        ticketId,
        sender: 'ai',
        senderName: 'Twin Hearts Support',
        text: '👋 You are now connected to Live Support! Your conversation has been sent to our customer care team on the admin dashboard. An admin will reply directly here.'
      });
    } else {
      await supportStore.addMessage({
        ticketId,
        sender: 'ai',
        senderName: 'Twin Care AI',
        text: '🤖 Switched to Twin Care AI mode. Ask me anything about Twin Hearts features!'
      });
    }

    const updated = await supportStore.getTicket(ticketId);
    return res.json({ success: true, ticket: updated });
  } catch (err) {
    console.error('[support switch mode error]:', err.message);
    return res.status(500).json({ error: 'Failed to switch mode' });
  }
});

module.exports = router;
