import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// ✅ CORS allow static site calls
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // change * to your static site domain for security
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health check
app.get("/", (_req, res) => res.send("OK"));

// ===== Chat (OpenAI) =====
app.post("/chat", async (req, res) => {
  try {
    const { messages = [], system = "You are helpful." } = req.body;

    const oai = await fetch("https://api.openai.com/v1/responses", {
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

    const body = await oai.json();
    if (!oai.ok) return res.status(oai.status).json({ error: body.error?.message || "OpenAI error" });

    const text = body.output_text ||
      (Array.isArray(body.output) ? body.output.map(o => o.content?.map(p=>p.text).join(" ")).join(" ") : "") ||
      body.choices?.[0]?.message?.content || "[No text from model]";

    res.json({ output_text: text });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ===== Google Geocode =====
app.get("/geocode", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address parameter" });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ===== Google Places Nearby =====
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng parameters" });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ===== Google Places Text Search for Developments =====
app.get("/developments", async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const query = "planned gas station OR gas station construction OR new gas station OR fuel station permit";
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${radius}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
