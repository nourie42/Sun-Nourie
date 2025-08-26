import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

// Proxy Google Places Nearby Search
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query; // radius default 1 mile in meters
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Proxy Geocoding API (address → lat/lng)
app.get("/geocode", async (req, res) => {
  const { address } = req.query;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});


