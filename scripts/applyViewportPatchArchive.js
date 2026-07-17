import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const partsDir = path.join(root, ".patchparts");
const parts = fs.readdirSync(partsDir)
  .filter((name) => /^viewport-patch-\d+\.b64$/.test(name))
  .sort();

if (!parts.length) throw new Error("Viewport patch archive parts are missing.");

const encoded = parts
  .map((name) => fs.readFileSync(path.join(partsDir, name), "utf8").trim())
  .join("");
const archive = Buffer.from(encoded, "base64");
const digest = crypto.createHash("sha256").update(archive).digest("hex");
const expected = "b8a9b75c1994590438166c379cd7c79f97dad4fe55d55700a4fbd6127117b113";

if (digest !== expected) throw new Error(`Viewport patch archive SHA mismatch: ${digest}`);

const archivePath = path.join(root, ".viewport-patch.tar.gz");
fs.writeFileSync(archivePath, archive);
execFileSync("tar", ["-xzf", archivePath, "-C", root], { stdio: "inherit" });
fs.rmSync(archivePath, { force: true });
fs.rmSync(partsDir, { recursive: true, force: true });
fs.rmSync(path.join(root, "scripts", "applyViewportPatchArchive.js"), { force: true });
fs.rmSync(path.join(root, ".github", "workflows", "apply-viewport-patch.yml"), { force: true });

console.log("Applied and verified Fuel Atlas viewport-company patch archive.");
