import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// POST /chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const { messages, system } = req.body;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{ role: "system", content: system }, ...messages],
        stream: false
      })
    });

    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
