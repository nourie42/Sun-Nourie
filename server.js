import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

// Health check
app.get("/", (_req, res) => res.send("OK"));

/**
 * 1) Chat proxy (OpenAI Responses API)
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

    // Normalize text output
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
 * 2) Google Geocoding (address -> lat/lng) via server key
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
 * 3) Google Places Nearby Search (gas stations near lat/lng) via server key
 */
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query; // default 1 mile
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

