import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

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
function safeEq(a,b) {
  const x=Buffer.from(String(a||"")), y=Buffer.from(String(b||""));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function loginPage(error="") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Household P&L Login</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#07101d,#0b1626);font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#eef5ff}.card{width:min(92vw,420px);background:#101d2e;border:1px solid #253a55;border-radius:20px;padding:28px;box-shadow:0 24px 60px #0007}h1{margin:0 0 6px;font-size:28px}.sub{color:#9fb1c8;margin-bottom:20px}input,button{width:100%;padding:13px;border-radius:11px;border:1px solid #34506f;font-size:16px}input{background:#0b1727;color:#fff;margin-bottom:12px}button{background:#1c6fd1;color:white;font-weight:800;cursor:pointer}.err{color:#ff8d8d;margin:0 0 12px}</style></head><body><form class="card" method="post" action="/household-pl/login"><h1>Nourie Household P&L</h1><div class="sub">Private financial dashboard</div>${error?`<div class="err">${error}</div>`:""}<input name="password" type="password" autocomplete="current-password" placeholder="Password" required autofocus><button type="submit">Open P&L</button></form></body></html>`;
}

export function registerHouseholdPLRoutes(app) {
  const password = process.env.HOUSEHOLD_PL_PASSWORD || "";
  const secret = process.env.HOUSEHOLD_PL_COOKIE_SECRET || "";
  const valid = (req) => password && secret && safeEq(cookies(req).household_pl_auth, token(password, secret));

  app.use("/household-pl", (req,res,next) => {
    res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
    res.setHeader("Cache-Control","no-store, private");
    next();
  });

  app.get(["/household-pl","/household-pl.html"], async (req,res) => {
    if (!valid(req)) return res.status(401).type("html").send(loginPage());
    try {
      const data = process.env.HOUSEHOLD_PL_DATA_GZ || "";
      if (!data) return res.status(503).send("Household P&L data is not configured.");
      const file = path.join(__dirname, "..", "public", "household-pl.html");
      const page = (await fs.readFile(file,"utf8")).replace("__HOUSEHOLD_PL_DATA__", JSON.stringify(data));
      res.type("html").send(page);
    } catch (e) {
      console.error("Household P&L load failed:", e);
      res.status(500).send("Household P&L could not be loaded.");
    }
  });

  app.post("/household-pl/login", express.urlencoded({extended:false,limit:"8kb"}), (req,res) => {
    if (!password || !secret) return res.status(503).type("html").send(loginPage("Private access is not configured."));
    if (!safeEq(req.body?.password, password)) return res.status(401).type("html").send(loginPage("Incorrect password."));
    const value = token(password,secret);
    res.setHeader("Set-Cookie", `household_pl_auth=${value}; Path=/household-pl; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`);
    res.redirect(303,"/household-pl");
  });

  app.post("/household-pl/logout", (req,res) => {
    res.setHeader("Set-Cookie","household_pl_auth=; Path=/household-pl; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    res.redirect(303,"/household-pl");
  });
}
