// server.js
import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

// Health check
app.get("/", (_req, res) => res.send("OK"));

/**
 * 1) Chat proxy (OpenAI Responses API)
 * - Uses: process.env.OPENAI_API_KEY
 * - Returns: { output_text: "..." } or { error: "..." }
 */
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

    const contentType = oai.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await oai.json() : await oai.text();

    if (!oai.ok) {
      const errMsg = typeof body === "string" ? body : (body.error?.message || JSON.stringify(body));
      return res.status(oai.status).json({ error: errMsg });
    }

    // Normalize output to { output_text: "..." }
    let text = "";
    if (typeof body === "string") text = body;
    else if (body.output_text) text = body.output_text;
    else if (Array.isArray(body.output)) {
      const msg = body.output.find(o => o.type === "message");
      if (msg?.content?.length) {
        text = msg.content
          .filter(p => p.type === "output_text" || p.type === "text")
          .map(p => p.text)
          .join("");
      }
    } else if (body.choices?.[0]?.message?.content) {
      text = body.choices[0].message.content;
    }

    if (!text) text = "[No text from model]";
    return res.json({ output_text: text });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

/**
 * 2) Geocode (Google) – address -> lat/lng
 * - Uses: process.env.GOOGLE_MAPS_API_KEY
 * - Example: GET /geocode?address=Raleigh,NC
 */
app.get("/geocode", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address parameter" });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * 3) Nearby Places (Google) – gas stations near lat/lng
 * - Uses: process.env.GOOGLE_MAPS_API_KEY
 * - Example: GET /places?lat=35.7796&lng=-78.6382&radius=1609
 */
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query; // default ~1 mile
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng parameters" });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * 4) Developments (Google Text Search) – “planned gas station” etc.
 * - Uses: process.env.GOOGLE_MAPS_API_KEY
 * - Example: GET /developments?lat=35.7796&lng=-78.6382&radius=5000
 */
app.get("/developments", async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query; // meters
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const query = "planned gas station OR gas station construction OR new gas station OR fuel station permit";
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${radius}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
