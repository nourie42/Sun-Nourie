(() => {
const $id = (id) => document.getElementById(id);
const MAX_BOOT_ATTEMPTS = 40;
function addProfessionalStyles() {
if ($id("siteResearchProfessionalStyles")) return;
const style = document.createElement("style");
style.id = "siteResearchProfessionalStyles";
style.textContent = `:root{--bg:#edf3f7;--panel:#ffffff;--panel2:#ffffff;--line:#d7e0e8;--text:#0b1f33;--muted:#5b6b7b;--brand:#1f5f8b;--brand2:#2d7fb8;--pill:#f5f8fb;--gold:#f4b942;--shadow:0 16px 42px rgba(9,30,49,.11);}body.fiq-professional-layout{min-height:100vh;padding-bottom:0!important;color:var(--text);background:linear-gradient(180deg,#071522 0 320px,#edf3f7 320px 100%);}body.fiq-professional-layout .wrap{width:min(1440px,calc(100% - 32px));max-width:none;margin:0 auto;padding:0 0 58px;}.fiq-topbar{min-height:72px;margin:0!important;display:flex!important;align-items:center!important;gap:12px!important;color:#fff;}.fiq-brand-mark{width:38px;height:38px;flex:0 0 38px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(145deg,var(--gold),#ffda7a);color:#0b1f33;font-size:12px;font-weight:900;letter-spacing:.02em;box-shadow:0 8px 24px rgba(244,185,66,.2);}.fiq-brand-copy{display:flex;align-items:baseline;gap:10px;min-width:0}.fiq-brand-copy h1{margin:0!important;color:#fff;font-size:20px!important;letter-spacing:-.015em!important;white-space:nowrap;}.fiq-brand-copy .build{margin:0!important;color:#91aac0!important;font-size:11px!important;white-space:nowrap}.fiq-top-actions{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.fiq-top-actions a{padding:8px 12px!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:9px!important;background:rgba(255,255,255,.07)!important;color:#e5f0f8!important;text-decoration:none!important;font-size:12px!important;font-weight:750!important;white-space:nowrap;transition:background .15s,border-color .15s,transform .15s;}.fiq-top-actions a:hover{background:rgba(255,255,255,.13)!important;border-color:rgba(255,255,255,.3)!important;transform:translateY(-1px)}.fiq-top-actions #fuelDistributorIntelligenceTop{background:var(--gold)!important;border-color:var(--gold)!important;color:#0b1f33!important;}body.fiq-professional-layout .aadt-tabs{margin:16px 0 0;color:#c8dae7;}body.fiq-professional-layout .aadt-tab{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#e5f0f8;}body.fiq-professional-layout .aadt-tab:hover{background:rgba(255,255,255,.13)}.fiq-intro{min-height:172px;margin:0!important;padding:22px 0 30px!important;color:#d9e7f2!important;}.fiq-intro .fiq-kicker{display:block;color:#8fc4ea;text-transform:uppercase;letter-spacing:.17em;font-weight:850;font-size:11px;margin-bottom:9px;}.fiq-intro h2{max-width:890px;margin:0 0 10px;color:#fff;font-size:clamp(28px,3vw,43px);line-height:1.04;letter-spacing:-.035em;}.fiq-intro p{max-width:980px;margin:0;color:#c8dae7;font-size:14px;line-height:1.55}body.fiq-professional-layout .card{margin:16px 0;padding:20px;color:var(--text);border:1px solid rgba(12,38,59,.09);border-radius:16px;background:#fff;box-shadow:var(--shadow);}body.fiq-professional-layout .fiq-intro + .card{margin-top:0}body.fiq-professional-layout .row.input-row{grid-template-columns:minmax(290px,1.55fr) repeat(4,minmax(112px,.62fr)) minmax(230px,.82fr);gap:14px;align-items:start;}body.fiq-professional-layout .input-row > div{min-width:0}body.fiq-professional-layout .input-row > div > label{min-height:0!important;margin:0 0 7px!important;color:#34495b;font-size:11px;font-weight:850;letter-spacing:.055em;text-transform:uppercase;align-items:flex-start!important;}body.fiq-professional-layout input,body.fiq-professional-layout select,body.fiq-professional-layout textarea{color:var(--text);background:#fbfdff;border:1px solid var(--line);border-radius:11px;outline:none;transition:border-color .15s,box-shadow .15s,background .15s;}body.fiq-professional-layout input:focus,body.fiq-professional-layout select:focus,body.fiq-professional-layout textarea:focus{border-color:var(--brand2);box-shadow:0 0 0 4px rgba(45,127,184,.11);background:#fff;}body.fiq-professional-layout .ac-list{color:var(--text);background:#fff;border-color:var(--line);box-shadow:0 18px 36px rgba(9,30,49,.16);}body.fiq-professional-layout .ac-item{border-bottom-color:#edf1f4}body.fiq-professional-layout .ac-item:hover,body.fiq-professional-layout .ac-item.active{background:#eef6fb}.analysis-action-stack{display:flex!important;flex-direction:column!important;align-self:stretch}.analysis-action-stack #go,.analysis-action-stack #runSiteResearch,.analysis-action-stack #refreshAfterChange{width:100%!important;min-width:0!important;margin-top:9px!important;border-radius:11px!important;padding:13px 14px!important;font-weight:850!important;transition:transform .15s,filter .15s,box-shadow .15s;}.analysis-action-stack #go{background:linear-gradient(135deg,var(--brand),#123f62)!important;border:1px solid transparent!important;color:#fff!important;box-shadow:0 10px 24px rgba(31,95,139,.22);font-size:15px!important;}.analysis-action-stack #runSiteResearch{background:linear-gradient(135deg,#0b1f33,#183f5f)!important;border:1px solid transparent!important;color:#fff!important;box-shadow:0 10px 22px rgba(9,30,49,.17);font-size:13px!important;}.analysis-action-stack #refreshAfterChange{background:#fff!important;border:1px solid var(--line)!important;color:#31516a!important;box-shadow:none!important;font-size:12px!important;}.analysis-action-stack #go:hover,.analysis-action-stack #runSiteResearch:hover{transform:translateY(-1px);filter:brightness(1.04)}.analysis-action-stack #refreshAfterChange:hover{border-color:#8db5d2!important;background:#f4f9fc!important}.research-options-panel{margin-top:20px;padding-top:19px;border-top:1px solid var(--line);}.research-options-panel .research-head{align-items:flex-start!important;margin-bottom:0}.research-options-panel .research-head b{font-size:16px;color:var(--text)}.research-options-panel .research-actions{gap:7px!important}.research-options-panel .research-actions button{padding:7px 10px!important;border:1px solid var(--line)!important;border-radius:8px!important;background:#fff!important;color:#31516a!important;font-size:11px!important;font-weight:800!important;}.research-options-panel .research-actions button:hover{border-color:#8db5d2!important;background:#f4f9fc!important}.research-options-panel .site-research-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:14px;}.research-options-panel .site-research-grid .chip{min-height:44px;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:#fbfdff;color:#29475d;line-height:1.3;}.research-options-panel .site-research-grid .chip:hover{border-color:#8db5d2;background:#f4f9fc}.research-options-panel .site-research-grid .chip:has(input:checked){border-color:#8bb8d7;background:#eef7fc}.research-options-panel .property-record-note{margin:13px 0 0!important;padding:11px 12px!important;border:1px solid #ead084!important;border-radius:10px!important;background:#fff8e6!important;color:#6b4d00!important;font-size:12px;line-height:1.45;}.research-feedback-row{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:13px}.research-feedback-row #siteResearchProgress{width:100%!important;height:8px!important;accent-color:var(--brand2)}body.fiq-professional-layout #siteResearchStatus{margin:0!important;min-height:18px!important;color:#526678!important;font-size:12px!important;line-height:1.45}.report-export-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#f7fafc;}.report-export-copy strong{display:block;font-size:13px;color:var(--text)}.report-export-copy span{display:block;margin-top:3px;color:#6c7c8b;font-size:11px;line-height:1.4}.report-export-actions{display:flex;gap:9px;flex-wrap:wrap;justify-content:flex-end}.report-export-actions button{margin:0!important;padding:10px 12px!important;border-radius:9px!important;font-size:12px!important;font-weight:800!important;white-space:nowrap;}.report-export-actions #exportPDF{background:#fff!important;color:#29475d!important;border:1px solid var(--line)!important;box-shadow:none!important;}.report-export-actions #siteResearchWordButton{background:var(--brand)!important;color:#fff!important;border:1px solid var(--brand)!important;box-shadow:0 8px 18px rgba(31,95,139,.18);}.report-export-actions #siteResearchWordButton:disabled{background:#dbe4ea!important;border-color:#dbe4ea!important;color:#7b8a96!important;box-shadow:none!important;cursor:not-allowed!important;}#siteResearchWord.fiq-export-source{display:none!important}body.fiq-professional-layout .aadt-choice{color:var(--text)!important;background:#fbfdff!important;border-color:var(--line)!important;}body.fiq-professional-layout .aadt-choice:has(input:checked){background:#eef7fc!important;border-color:var(--brand2)!important;box-shadow:0 0 0 1px rgba(45,127,184,.15) inset!important;}body.fiq-professional-layout .aadt-choice .meta{color:#627484!important}body.fiq-professional-layout .chip{color:#29475d;background:#f7fafc;border-color:var(--line)}body.fiq-professional-layout details summary{color:#1d3c54}body.fiq-professional-layout hr{border:0;border-top:1px solid var(--line)}body.fiq-professional-layout th{color:#41576a;background:#f7fafc}body.fiq-professional-layout td{color:#273f52}body.fiq-professional-layout th,body.fiq-professional-layout td{border-bottom-color:#e8edf1}body.fiq-professional-layout tr:hover{background:#f7fafc}body.fiq-professional-layout .hero .num{color:#0b1f33}body.fiq-professional-layout .hero .sub,body.fiq-professional-layout .small{color:#66798a}body.fiq-professional-layout #map,body.fiq-professional-layout #aadtMap,body.fiq-professional-layout #sv{border-color:var(--line)}body.fiq-professional-layout .footerbar{display:none!important}.fiq-results-card{padding:0!important;overflow:hidden}.fiq-results-card[hidden]{display:none!important}.fiq-results-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid var(--line);background:#fff;}.fiq-results-head h2{margin:0;color:var(--text);font-size:21px}.fiq-results-head p{margin:4px 0 0;color:#66798a;font-size:12px;line-height:1.45}.fiq-results-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border-radius:999px;background:#e9f8f1;color:#0e7a53;font-size:11px;font-weight:850;white-space:nowrap;}.fiq-results-badge:before{content:"";width:7px;height:7px;border-radius:50%;background:#0e7a53}.fiq-results-card #siteResearchResults{margin:0!important;padding:20px!important;background:#edf3f7}.fiq-results-card .site-research-report{border:1px solid #dbe4ea;box-shadow:0 12px 30px rgba(9,30,49,.07)}@media(max-width:1180px){body.fiq-professional-layout .row.input-row{grid-template-columns:repeat(3,minmax(0,1fr))}body.fiq-professional-layout .input-row > div:first-child{grid-column:span 2}.analysis-action-stack{grid-column:span 1}}@media(max-width:900px){body.fiq-professional-layout{background:linear-gradient(180deg,#071522 0 390px,#edf3f7 390px 100%)}.fiq-brand-copy h1{font-size:17px!important;white-space:normal}.fiq-topbar{align-items:flex-start!important;padding:16px 0;flex-wrap:wrap}.fiq-top-actions{width:100%;margin-left:50px;justify-content:flex-start}.fiq-intro{min-height:170px;padding-top:12px!important}.research-options-panel .site-research-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-export-row{align-items:flex-start;flex-direction:column}.report-export-actions{justify-content:flex-start}}@media(max-width:700px){body.fiq-professional-layout .wrap{width:min(100% - 18px,1440px)}body.fiq-professional-layout .row.input-row{grid-template-columns:1fr}body.fiq-professional-layout .input-row > div:first-child,.analysis-action-stack{grid-column:span 1}.fiq-brand-copy{display:block}.fiq-brand-copy .build{display:block;margin-top:2px!important}.fiq-top-actions{margin-left:0}.fiq-intro h2{font-size:29px}body.fiq-professional-layout .card{padding:16px;border-radius:14px}.research-options-panel .site-research-grid{grid-template-columns:1fr}.report-export-actions{width:100%;display:grid;grid-template-columns:1fr}.report-export-actions button{width:100%}.fiq-results-head{display:block}.fiq-results-badge{margin-top:10px}.fiq-results-card #siteResearchResults{padding:12px!important}}`;
document.head.appendChild(style);
}
function decorateHeader() {
const header = document.querySelector(".wrap > header");
if (!header || header.classList.contains("fiq-topbar")) return;
header.classList.add("fiq-topbar");
const mark = document.createElement("span");
mark.className = "fiq-brand-mark";
mark.textContent = "FIQ";
mark.setAttribute("aria-hidden", "true");
const brandCopy = document.createElement("div");
brandCopy.className = "fiq-brand-copy";
const heading = header.querySelector("h1");
const build = header.querySelector(".build");
if (heading) brandCopy.appendChild(heading);
if (build) brandCopy.appendChild(build);
const actions = document.createElement("div");
actions.className = "fiq-top-actions";
[...header.querySelectorAll("a")].forEach((link) => actions.appendChild(link));
header.prepend(brandCopy);
header.prepend(mark);
header.appendChild(actions);
}
function enhanceIntro() {
const instructions = document.querySelector(".instructions");
if (!instructions || instructions.classList.contains("fiq-intro")) return;
const instructionHtml = instructions.innerHTML;
instructions.classList.add("fiq-intro");
instructions.innerHTML = `
<span class="fiq-kicker">Fuel site underwriting</span>
<h2>Estimate volume, validate traffic, and run sourced diligence in one workflow.</h2>
<p>${instructionHtml}</p>`;
const quickLinks = document.querySelector(".aadt-tabs");
if (quickLinks) instructions.appendChild(quickLinks);
}
function removeUserComments() {
const notes = document.querySelector(".notes-toolbar");
const textarea = notes?.querySelector("#siteNotes");
if (textarea) {
textarea.value = "";
textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
notes?.remove();
}
function moveResearchControls() {
const firstCard = document.querySelector(".wrap > .card");
const inputRow = firstCard?.querySelector(".input-row");
const estimateButton = $id("go");
const researchButton = $id("runSiteResearch");
const refreshButton = $id("refreshAfterChange");
const researchCard = $id("siteResearchCard");
if (!firstCard || !inputRow || !estimateButton || !researchButton || !researchCard) return false;
const actionStack = estimateButton.closest(".input-row > div") || estimateButton.parentElement;
actionStack?.classList.add("analysis-action-stack");
estimateButton.insertAdjacentElement("afterend", researchButton);
if (refreshButton && refreshButton.parentElement !== actionStack) actionStack?.appendChild(refreshButton);
researchCard.classList.remove("card");
researchCard.classList.add("research-options-panel");
firstCard.appendChild(researchCard);
const title = researchCard.querySelector(".research-head > div:first-child");
if (title) {
title.innerHTML = '<b>Exhaustive report selections</b><div class="muted subtle" style="margin-top:5px">Choose the sections included when you run the exhaustive search. Property records and ownership remain included on every run.</div>';
}
const progress = $id("siteResearchProgress");
const status = $id("siteResearchStatus");
const runbar = researchCard.querySelector(".site-research-runbar");
let feedback = $id("siteResearchFeedback");
if (!feedback) {
feedback = document.createElement("div");
feedback.id = "siteResearchFeedback";
feedback.className = "research-feedback-row";
}
if (progress) feedback.appendChild(progress);
if (status) feedback.appendChild(status);
const propertyNote = researchCard.querySelector(".property-record-note");
if (propertyNote) propertyNote.insertAdjacentElement("afterend", feedback);
else researchCard.appendChild(feedback);
const exhaustiveLink = $id("siteResearchWord");
if (exhaustiveLink) researchCard.appendChild(exhaustiveLink);
runbar?.remove();
return true;
}
function buildResultsCard() {
const results = $id("siteResearchResults");
const wrap = document.querySelector(".wrap");
if (!results || !wrap) return;
let card = $id("siteResearchResultsCard");
if (!card) {
card = document.createElement("section");
card.id = "siteResearchResultsCard";
card.className = "card fiq-results-card";
card.hidden = true;
card.innerHTML = `
<div class="fiq-results-head">
<div><h2>Exhaustive Site Research Results</h2><p>The completed public-source report is kept below the full site-analysis workspace so the underwriting flow remains easy to scan.</p></div>
<span class="fiq-results-badge">Research complete</span>
</div>`;
wrap.appendChild(card);
}
card.appendChild(results);
const sync = () => {
const hasContent = Boolean(results.textContent.trim() || results.children.length);
card.hidden = !hasContent;
};
new MutationObserver(sync).observe(results, { childList: true, subtree: true, characterData: true });
sync();
}
function buildExportRow() {
const researchCard = $id("siteResearchCard");
const basicButton = $id("exportPDF");
const exhaustiveLink = $id("siteResearchWord");
if (!researchCard || !basicButton || !exhaustiveLink) return;
let row = $id("reportExportRow");
if (!row) {
row = document.createElement("div");
row.id = "reportExportRow";
row.className = "report-export-row";
row.innerHTML = `
<div class="report-export-copy"><strong>Word reports</strong><span>Export the current estimate now, or export the exhaustive sourced report after research finishes.</span></div>
<div class="report-export-actions"></div>`;
researchCard.appendChild(row);
}
const actions = row.querySelector(".report-export-actions");
basicButton.textContent = "Export Basic Report to Word";
actions.appendChild(basicButton);
exhaustiveLink.classList.add("fiq-export-source");
actions.appendChild(exhaustiveLink);
let exhaustiveButton = $id("siteResearchWordButton");
if (!exhaustiveButton) {
exhaustiveButton = document.createElement("button");
exhaustiveButton.id = "siteResearchWordButton";
exhaustiveButton.type = "button";
exhaustiveButton.textContent = "Export Exhaustive Research to Word";
actions.appendChild(exhaustiveButton);
exhaustiveButton.addEventListener("click", () => {
if (exhaustiveButton.disabled) return;
exhaustiveLink.click();
});
}
const sync = () => {
const href = String(exhaustiveLink.getAttribute("href") || "").trim();
const ready = !exhaustiveLink.hidden && href && href !== "#";
exhaustiveButton.disabled = !ready;
exhaustiveButton.setAttribute("aria-disabled", ready ? "false" : "true");
exhaustiveButton.title = ready ? "Download the completed exhaustive Word report" : "Run the exhaustive search before exporting this report";
};
new MutationObserver(sync).observe(exhaustiveLink, { attributes: true, attributeFilter: ["href", "hidden"] });
sync();
const footer = document.querySelector(".footerbar");
if (footer && !footer.querySelector("button,a")) footer.remove();
}
function initialize(attempt = 0) {
addProfessionalStyles();
const uiReady = $id("siteResearchCard") && $id("runSiteResearch") && $id("exportPDF");
if (!uiReady && attempt < MAX_BOOT_ATTEMPTS) {
setTimeout(() => initialize(attempt + 1), 50);
return;
}
if (document.body.dataset.fiqProfessionalLayout === "ready") return;
document.body.classList.add("fiq-professional-layout");
decorateHeader();
enhanceIntro();
removeUserComments();
moveResearchControls();
buildResultsCard();
buildExportRow();
document.body.dataset.fiqProfessionalLayout = "ready";
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initialize(), { once: true });
else initialize();
})();
