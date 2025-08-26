// ---------- AADT (NCDOT) nearest: points + lines, compute true nearest ----------
app.get("/aadt", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  // NCDOT AADT stations (points)
  const STATIONS =
    "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query";

  // NCDOT Traffic Volume Map (lines) – main AADT line layer
  const LINES =
    "https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query";

  // We’ll use a single, generous window (10 km) and compute the actual nearest.
  const SEARCH_M = 10000; // 10,000 m ~ 6.2 miles
  const OUT_FIELDS_PTS = "AADT,YEAR_,OBJECTID";
  const OUT_FIELDS_LNS = "*"; // field names vary across vintages, we’ll pick from candidates

  function toRad(x) { return x * Math.PI / 180; }
  function haversineMiles(aLat, aLng, bLat, bLng) {
    const R = 3958.761; // miles
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const A = Math.sin(dLat/2)**2 +
              Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(A));
  }

  async function queryLayer(url, outFields, wantGeometry = true) {
    const params = new URLSearchParams({
      f: "json",
      where: "1=1",
      outFields,
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(SEARCH_M),
      units: "esriSRUnit_Meter",
      returnGeometry: wantGeometry ? "true" : "false",
      // pull plenty; we’ll sort by our own distance
      resultRecordCount: "200"
    });
    const r = await fetch(`${url}?${params.toString()}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.features) ? j.features : [];
  }

  // Scrape an AADT + Year pair from a feature with unknown field names
  function readAADTAttrs(attrs) {
    if (!attrs) return null;
    const aadt =
      Number(attrs.AADT ?? attrs.AADT_2022 ?? attrs.AADT_2021 ?? attrs.AADT_2020 ??
             attrs.AADT2WAY ?? attrs.VOLUME ?? attrs.AADT_VALUE);
    const year = attrs.YEAR_ ?? attrs.AADT_YEAR ?? attrs.YEAR ?? null;
    if (!Number.isFinite(aadt) || aadt <= 0) return null;
    return { aadt, year };
  }

  try {
    // 1) Pull candidates from stations (points)
    const ptFeats = await queryLayer(STATIONS, OUT_FIELDS_PTS, true);

    // 2) Pull candidates from lines
    const lnFeats = await queryLayer(LINES, OUT_FIELDS_LNS, true);

    // Build a single candidate list with computed distances
    const candidates = [];

    // Points
    for (const f of ptFeats) {
      const g = f.geometry;
      if (!g || typeof g.y !== "number" || typeof g.x !== "number") continue;
      const distMi = haversineMiles(Number(lat), Number(lng), g.y, g.x);
      const attrs = f.attributes || {};
      const aadt = Number(attrs.AADT);
      const year = attrs.YEAR_;
      if (Number.isFinite(aadt) && aadt > 0) {
        candidates.push({ aadt, year, distMi, layer: "NCDOT AADT Stations" });
      }
    }

    // Lines
    for (const f of lnFeats) {
      const g = f.geometry;
      // Line geometries can be paths (arrays). We’ll use the first vertex if present.
      let y, x;
      if (g?.paths?.[0]?.[0]) {
        const first = g.paths[0][0];
        x = Number(first[0]); y = Number(first[1]);
      } else if (typeof g?.y === "number" && typeof g?.x === "number") {
        // some services return centroids as points
        x = Number(g.x); y = Number(g.y);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const distMi = haversineMiles(Number(lat), Number(lng), y, x);
      const pick = readAADTAttrs(f.attributes);
      if (pick) {
        candidates.push({ aadt: pick.aadt, year: pick.year, distMi, layer: "NCDOT Traffic Volume Map" });
      }
    }

    if (!candidates.length) {
      return res.json({ error: "No AADT found nearby", search_m: SEARCH_M });
    }

    // Pick the nearest; if multiple at same distance, pick the highest AADT / newest year
    candidates.sort((a, b) => {
      if (a.distMi !== b.distMi) return a.distMi - b.distMi;
      if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
      return (b.aadt ?? 0) - (a.aadt ?? 0);
    });

    const best = candidates[0];
    return res.json({
      aadt: best.aadt,
      year: best.year ?? null,
      distance_m: Math.round(best.distMi * 1609.344),
      layer: best.layer
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

