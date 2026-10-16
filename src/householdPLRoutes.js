import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { decodeHouseholdPLSnapshot, serializeHouseholdPLSnapshot } from "./householdPLData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function token(password, secret) {
  return crypto.createHmac("sha256", secret).update("household-pl:" + password).digest("hex");
}

function safeEq(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function loginPage(error = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Household P&L Login</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#07101d,#0b1626);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#eef5ff}.card{width:min(92vw,420px);background:#101d2e;border:1px solid #253a55;border-radius:20px;padding:28px;box-shadow:0 24px 60px #0007}h1{margin:0 0 6px;font-size:28px}.sub{color:#9fb1c8;margin-bottom:20px}input,button{width:100%;padding:13px;border-radius:11px;border:1px solid #34506f;font-size:16px}input{background:#0b1727;color:#fff;margin-bottom:12px}button{background:#1c6fd1;color:white;font-weight:800;cursor:pointer}.err{color:#ff8d8d;margin:0 0 12px}</style></head><body><form class="card" method="post" action="/household-pl/login"><h1>Nourie Household P&L</h1><div class="sub">Private financial dashboard</div>${error ? `<div class="err">${error}</div>` : ""}<input name="password" type="password" autocomplete="current-password" placeholder="Password" required autofocus><button type="submit">Open P&L</button></form></body></html>`;
}

export function registerHouseholdPLRoutes(app) {
  const password = process.env.HOUSEHOLD_PL_PASSWORD || "";
  const secret = process.env.HOUSEHOLD_PL_COOKIE_SECRET || "";
  let snapshotJSON = "";
  for (const [source, variable] of [
    ["primary", "HOUSEHOLD_PL_DATA_GZ"],
    ["backup", "HOUSEHOLD_PL_LAST_GOOD_DATA_GZ"],
  ]) {
    try {
      const snapshot = decodeHouseholdPLSnapshot(process.env[variable] || "");
      if (source === "backup") {
        const note = "Latest dataset could not be read; showing last verified backup.";
        const notes = Array.isArray(snapshot.coverageNotes) ? [...snapshot.coverageNotes] : snapshot.coverageNotes ? [snapshot.coverageNotes] : [];
        if (!notes.includes(note)) notes.push(note);
        snapshot.coverageNotes = notes;
      }
      snapshotJSON = serializeHouseholdPLSnapshot(snapshot);
      console.info("Household P&L snapshot ready:", JSON.stringify({
        source,
        period: snapshot.actualMonth || snapshot.period || "2026-09",
        asOf: snapshot.asOf || null,
        rows: snapshot.rows.length,
        transactions: snapshot.tx.length,
      }));
      break;
    } catch (error) {
      console.error("Household P&L snapshot unavailable:", source, error.code || "HOUSEHOLD_PL_DATA_INVALID", error.detail || "");
    }
  }
  const valid = (req) =>
    password &&
    secret &&
    safeEq(cookies(req).household_pl_auth, token(password, secret));

  app.use(["/household-pl", "/household-pl.html", "/household-pl-insights.js"], (req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store, private");
    next();
  });

  app.get("/household-pl/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!snapshotJSON) {
      return res.status(503).json({ ready: false, code: "HOUSEHOLD_PL_SNAPSHOT_UNAVAILABLE" });
    }
    try {
      const snapshot = JSON.parse(snapshotJSON);
      return res.json({
        ready: true,
        actualMonth: snapshot.actualMonth || snapshot.period || null,
        previousMonth: snapshot.previousMonth || null,
        budgetStartMonth: snapshot.budgetStartMonth || null,
        asOf: snapshot.asOf || null,
        refreshedAt: snapshot.refreshedAt || null,
        rows: Array.isArray(snapshot.rows) ? snapshot.rows.length : null,
        transactions: Array.isArray(snapshot.tx) ? snapshot.tx.length : null,
        coverageNotes: Array.isArray(snapshot.coverageNotes) ? snapshot.coverageNotes : snapshot.coverageNotes ? [snapshot.coverageNotes] : []
      });
    } catch {
      return res.status(503).json({ ready: false, code: "HOUSEHOLD_PL_STATUS_PARSE_FAILED" });
    }
  });

  app.get("/household-pl-insights.js", (req, res) => {
    if (!valid(req)) return res.status(401).type("text/plain").send("Unauthorized");
    res.setHeader("Cache-Control", "no-store, private");
    res.type("application/javascript");
    res.sendFile(path.join(__dirname, "..", "public", "household-pl-insights.js"));
  });

  app.get(["/household-pl", "/household-pl.html"], async (req, res) => {
    if (!valid(req)) return res.status(401).type("html").send(loginPage());
    try {
      if (!snapshotJSON) return res.status(503).send("Household P&L data is unavailable. Please try again later.");
      const file = path.join(__dirname, "..", "public", "household-pl.html");
      let page = (await fs.readFile(file, "utf8")).replace(
        "__HOUSEHOLD_PL_DATA__",
        () => snapshotJSON
      );
      const insights = '<script>window.__HPL_SNAPSHOT__=typeof Z!=="undefined"?Z:null;</script><script src="/household-pl-insights.js?v=20261016-1"></script>';
      page = page.includes("</body>") ? page.replace("</body>", `${insights}</body>`) : `${page}${insights}`;
      res.type("html").send(page);
    } catch (error) {
      console.error("Household P&L load failed:", error);
      res.status(500).send("Household P&L could not be loaded.");
    }
  });

  app.get("/household-pl/login", (_req, res) => {
    res.redirect(302, "/household-pl");
  });

  app.post(
    "/household-pl/login",
    express.urlencoded({ extended: false, limit: "8kb" }),
    (req, res) => {
      if (!password || !secret) {
        return res.status(503).type("html").send(loginPage("Private access is not configured."));
      }
      if (!safeEq(req.body?.password, password)) {
        return res.status(401).type("html").send(loginPage("Incorrect password."));
      }
      const value = token(password, secret);
      res.setHeader(
        "Set-Cookie",
        `household_pl_auth=${value}; Path=/household-pl; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
      );
      res.redirect(303, "/household-pl");
    }
  );

  app.post("/household-pl/logout", (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      "household_pl_auth=; Path=/household-pl; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    );
    res.redirect(303, "/household-pl");
  });
}
