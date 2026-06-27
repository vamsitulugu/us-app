const express = require('express');
const router = express.Router();

router.post('/chat', async (req, res) => {
  const { message, myName, partnerName, anniversary, recentMood } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "Groq API key missing"
    });
  }


  const prompt = `You are a warm, caring AI Love Guide for "${myName || 'the user'}" and "${partnerName || 'their partner'}", a couple using the "Us With Love" app.
${anniversary ? `They have been together since ${anniversary}.` : ''}
${recentMood ? `Recent mood: ${recentMood}.` : ''}

Give heartfelt, specific, and practical relationship advice. Be empathetic and warm. Use occasional gentle emojis. Keep responses to 3-5 sentences unless more detail is needed.

User asks: ${message}`;

  try {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: prompt,
          },
          {
            role: "user",
            content: message,
          },
        ],
        max_tokens: 800,
      }),
    }
  );

  const data = await response.json();

  console.log("Groq Response:");
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    return res.status(500).json({
      error: data.error?.message || "Groq API Error",
    });
  }

  const text =
    data.choices?.[0]?.message?.content || "I'm here for you! 💕";

  return res.json({
    reply: text,
  });
} catch (e) {
  console.error(e);

  return res.status(500).json({
    error: e.message,
  });
}

});

router.get('/status', (req, res) => {
  res.json({
    configured: !!process.env.GROQ_API_KEY
  });
});

module.exports = router;
