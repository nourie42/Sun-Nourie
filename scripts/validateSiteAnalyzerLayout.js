import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const layout = fs.readFileSync(path.join(root, "public", "site-research-layout.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const requiredLayoutSnippets = [
  'estimateButton.insertAdjacentElement("afterend", researchButton)',
  'firstCard.appendChild(researchCard)',
  'notes?.remove()',
  'wrap.appendChild(card)',
  'card.appendChild(results)',
  'Export Basic Report to Word',
  'Export Exhaustive Research to Word',
  'fiq-professional-layout',
];

for (const snippet of requiredLayoutSnippets) {
  if (!layout.includes(snippet)) throw new Error(`Site analyzer layout is missing required behavior: ${snippet}`);
}

if (!server.includes('"/site-research-layout.js"')) {
  throw new Error("server.js does not expose or inject the professional site analyzer layout script.");
}

const estimateMove = layout.indexOf('estimateButton.insertAdjacentElement("afterend", researchButton)');
const optionsMove = layout.indexOf("firstCard.appendChild(researchCard)");
if (estimateMove < 0 || optionsMove < 0 || estimateMove > optionsMove) {
  throw new Error("The exhaustive search button must be placed below Estimate before the selection panel is moved underneath.");
}

console.log("Site analyzer layout validation passed.");
