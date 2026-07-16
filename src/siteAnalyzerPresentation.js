const HEADER_HTML = `
<header class="fiq-topbar">
  <a class="fiq-brand" href="/" aria-label="Fuel IQ Site Analyzer home">
    <span class="fiq-brand-mark" aria-hidden="true">FIQ</span>
    <span class="fiq-brand-copy"><strong>Fuel IQ</strong><small>Site Analyzer</small></span>
  </a>
  <nav class="fiq-top-actions" aria-label="Fuel IQ tools">
    <a href="/PA_Signals_AADT_Radius_Map_Final_Generated.html">PA AADT Map</a>
    <a id="fuelDistributorIntelligenceTop" class="fiq-primary-link" href="/distributors.html">Distributor Intelligence</a>
  </nav>
</header>`;

const COMBINED_MAP_HTML = `
<div class="card fiq-map-card" id="mapAadtCard">
  <div class="fiq-section-heading">
    <div>
      <span class="fiq-eyebrow">Traffic and competition</span>
      <h2>Site, competitors, and official AADT sources</h2>
      <p id="mapTitle" class="muted">Map: Site & competitors (1.5 mi) + AADT dots + ⭐ AADT used</p>
    </div>
    <div id="aadtSourceLine" class="small">Source: state official AADT layers and expanded public-source search</div>
  </div>
  <div class="fiq-map-grid">
    <section class="fiq-map-pane" aria-label="Site and competitor map">
      <div id="map"><div id="overlay" class="muted"></div></div>
      <div id="svWrap"><div class="muted fiq-pane-label">Street View</div><iframe id="sv" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>
    </section>
    <section class="fiq-map-pane" aria-label="AADT source map">
      <div class="fiq-pane-label">Official AADT readings</div>
      <div id="aadtMap"></div>
    </section>
  </div>
  <div class="fiq-aadt-table-wrap">
    <table id="aadtTable"><thead><tr><th>Distance</th><th>AADT (Year)</th><th>Route</th><th>Location</th><th>Source</th></tr></thead><tbody></tbody></table>
  </div>
</div>`;

const EXPORT_DOCK_HTML = `
<div class="footerbar fiq-export-dock" id="reportExportDock" role="region" aria-label="Word report exports">
  <div class="fiq-export-dock-inner">
    <div class="fiq-export-copy"><strong>Word reports</strong><span>Exports stay available while you review the site.</span></div>
    <div class="fiq-export-actions">
      <button id="scrollToResearchResults" type="button" hidden>Scroll to Exhaustive Search Results</button>
      <button id="exportPDF" type="button">Export Basic Report to Word</button>
      <button id="siteResearchWordButton" type="button" disabled aria-disabled="true">Export Exhaustive Research to Word</button>
    </div>
  </div>
</div>`;

const RESEARCH_OVERLAY_HTML = `
<div id="siteResearchLoadingOverlay" class="fiq-research-loading" hidden aria-hidden="true" aria-live="polite">
  <div class="fiq-research-loading-inner">
    <div class="fiq-radar" aria-hidden="true"></div>
    <h2>Fuel IQ is researching the site</h2>
    <p id="siteResearchLoadingMessage">Confirming public records, traffic, competition, development activity, and operating context…</p>
    <div class="fiq-loading-progress" aria-hidden="true"><span id="siteResearchLoadingBar"></span></div>
    <small>Deep research can take several minutes because Fuel IQ checks and cross-references public sources.</small>
  </div>
</div>`;

const PROFESSIONAL_CSS = `
<style id="siteResearchProfessionalStyles">
:root{--fiq-ink:#0b1f33;--fiq-blue:#1f5f8b;--fiq-blue2:#2d7fb8;--fiq-gold:#f4b942;--fiq-line:#d7e0e8;--fiq-muted:#5b6b7b;--fiq-soft:#edf3f7;--fiq-shadow:0 16px 44px rgba(9,30,49,.11)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body.fiq-professional-layout{margin:0!important;padding:0 0 106px!important;min-height:100vh;color:var(--fiq-ink)!important;background:linear-gradient(180deg,#071522 0 390px,var(--fiq-soft) 390px 100%)!important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
body.fiq-research-busy{overflow:hidden}body.fiq-professional-layout .wrap{width:min(1460px,calc(100% - 32px));max-width:none;margin:0 auto;padding:0 0 56px}
.fiq-topbar{min-height:84px;display:flex!important;align-items:center!important;justify-content:space-between;gap:18px;margin:0!important;color:#fff}.fiq-brand{display:flex;align-items:center;gap:13px;color:#fff;text-decoration:none}.fiq-brand-mark{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,var(--fiq-gold),#ffda7a);color:var(--fiq-ink);font-size:15px;font-weight:900;box-shadow:0 10px 28px rgba(244,185,66,.22)}.fiq-brand-copy{display:grid;line-height:1.05}.fiq-brand-copy strong{font-size:23px}.fiq-brand-copy small{margin-top:5px;color:#9eb6c8;font-size:12px;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.fiq-top-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}.fiq-top-actions a{padding:12px 16px;border:1px solid rgba(255,255,255,.18);border-radius:11px;background:rgba(255,255,255,.07);color:#e5f0f8;text-decoration:none;font-size:13px;font-weight:850}.fiq-top-actions a:hover{background:rgba(255,255,255,.14)}.fiq-top-actions .fiq-primary-link{border-color:var(--fiq-gold);background:var(--fiq-gold);color:var(--fiq-ink)}
.fiq-intro{min-height:286px;margin:0!important;padding:46px 0 42px!important;color:#d9e7f2!important;display:flex;flex-direction:column;justify-content:center}.fiq-kicker{display:block;color:#8fc4ea;text-transform:uppercase;letter-spacing:.18em;font-size:12px;font-weight:900}.fiq-intro h1{max-width:1180px;margin:12px 0 16px;color:#fff;font-size:clamp(44px,5vw,74px);line-height:.98;letter-spacing:-.05em}.fiq-intro>p{max-width:1100px;margin:0;color:#c8dae7;font-size:clamp(17px,1.4vw,21px);line-height:1.55}.fiq-intro .aadt-tabs{width:fit-content;max-width:100%;margin:28px 0 0;padding:10px 12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;border:1px solid rgba(255,255,255,.13);border-radius:14px;background:rgba(4,19,31,.58);box-shadow:0 12px 30px rgba(0,0,0,.14);backdrop-filter:blur(10px)}.fiq-intro .aadt-tabs .muted{padding:0 8px 0 2px;color:#b7cad8;font-size:11px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.fiq-intro .aadt-tab{display:inline-flex;align-items:center;justify-content:center;min-width:43px;height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.16);border-radius:9px;background:rgba(255,255,255,.08);color:#f7fbff;text-decoration:none;font-size:12px;font-weight:900;box-shadow:none;transition:transform .15s,background .15s,border-color .15s}.fiq-intro .aadt-tab:hover{transform:translateY(-1px);border-color:rgba(244,185,66,.7);background:rgba(244,185,66,.16);color:#fff}.fiq-intro .aadt-tab:focus-visible{outline:3px solid rgba(244,185,66,.35);outline-offset:2px}
body.fiq-professional-layout .card{margin:16px 0;padding:20px;border:1px solid rgba(12,38,59,.08);border-radius:16px;background:#fff;color:var(--fiq-ink);box-shadow:var(--fiq-shadow)}body.fiq-professional-layout .fiq-input-card{margin-top:0}body.fiq-professional-layout .row.input-row{display:grid;grid-template-columns:minmax(290px,1.55fr) repeat(4,minmax(112px,.62fr)) minmax(230px,.82fr);gap:14px;align-items:start}.input-row>div{min-width:0}.input-row>div>label{min-height:0!important;margin:0 0 7px!important;color:#34495b!important;font-size:11px!important;font-weight:850!important;letter-spacing:.055em;text-transform:uppercase;align-items:flex-start!important}.fiq-professional-layout input,.fiq-professional-layout select,.fiq-professional-layout textarea{width:100%;padding:12px;color:var(--fiq-ink);background:#fbfdff;border:1px solid var(--fiq-line);border-radius:11px;outline:none}.fiq-professional-layout input:focus,.fiq-professional-layout select:focus,.fiq-professional-layout textarea:focus{border-color:var(--fiq-blue2);box-shadow:0 0 0 4px rgba(45,127,184,.11);background:#fff}.fiq-professional-layout .ac-list{background:#fff;color:var(--fiq-ink);border-color:var(--fiq-line);box-shadow:0 18px 36px rgba(9,30,49,.16)}.fiq-professional-layout .ac-item{border-bottom-color:#edf1f4}.fiq-professional-layout .ac-item:hover,.fiq-professional-layout .ac-item.active{background:#eef6fb}
.analysis-action-stack{display:flex!important;flex-direction:column!important;align-self:stretch}.analysis-action-stack #go,.analysis-action-stack #runSiteResearch,.analysis-action-stack #refreshAfterChange{width:100%!important;min-width:0!important;margin-top:9px!important;padding:13px 14px!important;border-radius:11px!important;font-weight:850!important}.analysis-action-stack #go{border:1px solid transparent!important;background:linear-gradient(135deg,var(--fiq-blue),#123f62)!important;color:#fff!important;font-size:15px!important;box-shadow:0 10px 24px rgba(31,95,139,.22)}.analysis-action-stack #runSiteResearch{border:1px solid transparent!important;background:linear-gradient(135deg,#0b1f33,#183f5f)!important;color:#fff!important;font-size:13px!important}.analysis-action-stack #refreshAfterChange{border:1px solid var(--fiq-line)!important;background:#fff!important;color:#31516a!important;font-size:12px!important}
#aadtChoiceCard:not(.fiq-positioned),#siteResearchCard:not(.fiq-positioned){display:none!important}.aadt-choice-panel{display:none;margin-top:22px;padding-top:20px;border-top:1px solid var(--fiq-line)}.aadt-choice-panel.is-ready{display:block}.aadt-choice-panel .aadt-choice-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.fiq-professional-layout .aadt-choice{display:flex!important;align-items:flex-start!important;gap:10px!important;min-height:108px;color:var(--fiq-ink)!important;background:#fbfdff!important;border-color:var(--fiq-line)!important}.fiq-professional-layout .aadt-choice input{width:18px!important;height:18px!important;flex:0 0 18px!important;margin:2px 0 0!important;padding:0!important}.fiq-professional-layout .aadt-choice:has(input:checked){background:#eef7fc!important;border-color:var(--fiq-blue2)!important}.fiq-professional-layout .aadt-choice .meta{color:#627484!important}
.research-options-panel{margin-top:24px;padding:24px;border:1px solid #dbe5ec;border-radius:14px;background:linear-gradient(180deg,#fff,#f8fbfd);box-shadow:0 10px 28px rgba(9,30,49,.06)}.research-options-panel .research-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}.research-options-panel .research-head b{font-size:20px;color:var(--fiq-ink)}.research-options-panel .research-head .muted{font-size:13px;line-height:1.5}.research-options-panel .research-actions{display:flex;gap:8px}.research-options-panel .research-actions button{padding:9px 13px!important;border:1px solid var(--fiq-line)!important;border-radius:9px!important;background:#fff!important;color:#31516a!important;font-size:12px!important;font-weight:850!important}.research-options-panel .site-research-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important;margin-top:18px!important}.research-options-panel .site-research-grid .chip{display:flex!important;align-items:flex-start!important;justify-content:flex-start!important;gap:11px!important;width:100%!important;min-width:0!important;min-height:58px!important;margin:0!important;padding:14px!important;border:1px solid #cfdde7!important;border-radius:12px!important;background:#fff!important;color:#29475d!important;font-size:14px!important;font-weight:750!important;line-height:1.35!important;text-align:left!important;cursor:pointer!important;overflow:hidden!important}.research-options-panel .site-research-grid .chip input{appearance:auto!important;width:18px!important;height:18px!important;min-width:18px!important;max-width:18px!important;flex:0 0 18px!important;margin:1px 0 0!important;padding:0!important;accent-color:#1ca7c9!important}.research-options-panel .site-research-grid .chip span{display:block!important;min-width:0!important;overflow-wrap:anywhere!important}.research-options-panel .site-research-grid .chip:hover{border-color:#8db7d2!important;background:#f4f9fc!important}.research-options-panel .site-research-grid .chip:has(input:checked){border-color:#77b4d8!important;background:#eef8fd!important;box-shadow:0 0 0 1px rgba(45,127,184,.08) inset!important}.research-options-panel .property-record-note{margin:16px 0 0!important;padding:13px 14px!important;border:1px solid #ead084!important;border-radius:11px!important;background:#fff8e6!important;color:#6b4d00!important;font-size:12px;line-height:1.5}.research-feedback-row{display:grid;gap:8px;margin-top:14px}.research-feedback-row progress{width:100%!important;height:8px!important;accent-color:var(--fiq-blue2)}#siteResearchStatus{margin:0!important;min-height:18px;color:#526678!important;font-size:12px!important;line-height:1.45}#siteResearchWord.fiq-export-source{display:none!important}
.fiq-professional-layout .chip{color:#29475d;background:#f7fafc;border-color:var(--fiq-line)}.fiq-professional-layout details summary{color:#1d3c54}.fiq-professional-layout hr{border:0;border-top:1px solid var(--fiq-line)}.fiq-professional-layout th{color:#41576a;background:#f7fafc}.fiq-professional-layout td{color:#273f52}.fiq-professional-layout th,.fiq-professional-layout td{border-bottom-color:#e8edf1}.fiq-professional-layout tr:hover{background:#f7fafc}.fiq-professional-layout .hero .num{color:var(--fiq-ink)}.fiq-professional-layout .hero .sub,.fiq-professional-layout .small{color:#66798a}
.fiq-section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.fiq-section-heading h2{margin:4px 0 3px;font-size:21px}.fiq-section-heading p{margin:0}.fiq-eyebrow{color:var(--fiq-blue);text-transform:uppercase;letter-spacing:.09em;font-size:10px;font-weight:900}.fiq-map-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(350px,.8fr);gap:14px}.fiq-map-pane{min-width:0}.fiq-pane-label{margin:0 0 7px;color:#617486;font-size:12px;font-weight:800}.fiq-professional-layout #map,.fiq-professional-layout #aadtMap{height:430px;border:1px solid var(--fiq-line);border-radius:12px}.fiq-professional-layout #sv{height:285px;border-color:var(--fiq-line);background:#f5f8fb}.fiq-aadt-table-wrap{margin-top:14px;overflow:auto;border:1px solid var(--fiq-line);border-radius:10px}.fiq-aadt-table-wrap table{margin:0}.fiq-aadt-table-wrap th,.fiq-aadt-table-wrap td{padding:9px 8px}
.site-research-report>header{display:block!important;margin:0!important}.fiq-results-card{padding:0!important;overflow:hidden;scroll-margin-top:18px}.fiq-results-card[hidden]{display:none!important}.fiq-results-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid var(--fiq-line)}.fiq-results-head h2{margin:0;font-size:21px}.fiq-results-head p{margin:4px 0 0;color:#66798a;font-size:12px}.fiq-results-badge{display:inline-flex;padding:6px 9px;border-radius:999px;background:#e9f8f1;color:#0e7a53;font-size:11px;font-weight:850;white-space:nowrap}.fiq-results-card #siteResearchResults{margin:0!important;padding:20px!important;background:var(--fiq-soft)}.fiq-results-card .site-research-report{border:1px solid #dbe4ea;box-shadow:0 12px 30px rgba(9,30,49,.07)}.expected-gallons-summary{margin:16px 0 22px;padding:16px;border:1px solid #bfd6e6;border-radius:12px;background:#eff8fd}.expected-gallons-summary h2{margin:0 0 12px!important;border:0!important;color:var(--fiq-ink)!important}.expected-gallons-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.expected-gallons-metric{padding:10px;border:1px solid #d5e4ee;border-radius:9px;background:#fff}.expected-gallons-metric span{display:block;color:#71808e;font-size:10px;text-transform:uppercase;letter-spacing:.05em}.expected-gallons-metric strong{display:block;margin-top:3px;font-size:16px}.expected-gallons-summary p{margin:10px 0 0;color:#5f7282;font-size:11px}
.fiq-export-dock{position:fixed!important;left:0;right:0;bottom:0;z-index:900;display:block!important;padding:10px 16px!important;border-top:1px solid rgba(12,38,59,.12)!important;background:rgba(255,255,255,.96)!important;box-shadow:0 -10px 30px rgba(9,30,49,.1);backdrop-filter:blur(14px)}.fiq-export-dock-inner{width:min(1460px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px}.fiq-export-copy strong{display:block;font-size:13px}.fiq-export-copy span{display:block;margin-top:2px;color:#6c7c8b;font-size:11px}.fiq-export-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap}.fiq-export-actions button{margin:0!important;padding:11px 13px!important;border-radius:9px!important;font-size:12px!important;font-weight:850!important;white-space:nowrap}.fiq-export-actions #scrollToResearchResults{border:1px solid #b8cedd!important;background:#eef7fc!important;color:#164f75!important}.fiq-export-actions #exportPDF{border:1px solid var(--fiq-line)!important;background:#fff!important;color:#29475d!important}.fiq-export-actions #siteResearchWordButton{border:1px solid var(--fiq-blue)!important;background:var(--fiq-blue)!important;color:#fff!important}.fiq-export-actions #siteResearchWordButton:disabled{border-color:#dbe4ea!important;background:#dbe4ea!important;color:#7b8a96!important;cursor:not-allowed!important}
.fiq-research-loading[hidden]{display:none!important}.fiq-research-loading{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:28px;background:rgba(247,250,252,.985)}.fiq-research-loading-inner{width:min(880px,100%);text-align:center}.fiq-radar{width:112px;height:112px;margin:0 auto 25px;border-radius:50%;position:relative;background:radial-gradient(circle at center,#fff 0 7%,transparent 8%),repeating-radial-gradient(circle,#d5e4ee 0 1px,transparent 2px 23px),conic-gradient(from 0deg,transparent 0 70%,rgba(45,127,184,.48) 92%,transparent 100%);animation:fiq-radar-spin 2.2s linear infinite}.fiq-radar:after{content:"";position:absolute;inset:9px;border-radius:50%;border:1px solid #b7cfdf}@keyframes fiq-radar-spin{to{transform:rotate(360deg)}}.fiq-research-loading h2{margin:0 0 12px;font-size:clamp(28px,4vw,42px);letter-spacing:-.025em}.fiq-research-loading p{min-height:54px;margin:0 auto;color:var(--fiq-muted);font-size:17px;line-height:1.45}.fiq-loading-progress{height:8px;margin:18px auto 17px;max-width:930px;border-radius:999px;background:#e2eaf0;overflow:hidden}.fiq-loading-progress span{display:block;height:100%;width:10%;border-radius:inherit;background:linear-gradient(90deg,var(--fiq-blue),#65aedd);transition:width .35s ease}.fiq-research-loading small{color:#617486;font-size:12px}
#devs[hidden],#ratingLine[hidden],#siteNotes[type="hidden"]{display:none!important}
@media(max-width:1180px){body.fiq-professional-layout .row.input-row{grid-template-columns:repeat(3,minmax(0,1fr))}.input-row>div:first-child{grid-column:span 2}.analysis-action-stack{grid-column:span 1}.fiq-map-grid{grid-template-columns:1fr}.expected-gallons-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:800px){body.fiq-professional-layout{background:linear-gradient(180deg,#071522 0 430px,var(--fiq-soft) 430px 100%);padding-bottom:176px!important}.fiq-topbar{padding:14px 0;align-items:flex-start;flex-wrap:wrap}.fiq-top-actions{width:100%;justify-content:flex-start;margin-left:65px}.fiq-intro{min-height:305px;padding-top:24px!important}.fiq-intro h1{font-size:44px}.research-options-panel .site-research-grid,.aadt-choice-panel .aadt-choice-list{grid-template-columns:repeat(2,minmax(0,1fr))!important}.fiq-section-heading,.fiq-export-dock-inner{align-items:flex-start;flex-direction:column}.fiq-export-actions{justify-content:flex-start}.expected-gallons-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){body.fiq-professional-layout .wrap{width:min(100% - 18px,1460px)}body.fiq-professional-layout .row.input-row{grid-template-columns:1fr}.input-row>div:first-child,.analysis-action-stack{grid-column:span 1}.fiq-top-actions{margin-left:0}.fiq-intro{min-height:330px}.fiq-intro h1{font-size:38px}.fiq-intro>p{font-size:16px}.fiq-professional-layout .card{padding:16px;border-radius:14px}.research-options-panel{padding:16px}.research-options-panel .site-research-grid,.aadt-choice-panel .aadt-choice-list{grid-template-columns:1fr!important}.fiq-export-actions{width:100%;display:grid;grid-template-columns:1fr}.fiq-export-actions button{width:100%}.expected-gallons-grid{grid-template-columns:1fr}.fiq-results-card #siteResearchResults{padding:12px!important}.fiq-research-loading p{font-size:15px}}
</style>`;

function replaceFirstCard(page) {
  return page.replace(/<div class="card">\s*<div class="row input-row">/, '<div class="card fiq-input-card" id="siteWorkflowCard">\n  <div class="row input-row">');
}

function removeNotes(page) {
  return page.replace(/\s*<div class="toolbar notes-toolbar">[\s\S]*?<textarea id="siteNotes"[\s\S]*?<\/textarea>\s*<div class="muted subtle">[\s\S]*?<\/div>\s*<\/div>/, '\n  <input id="siteNotes" type="hidden" value="" />');
}

function combineMapSections(page) {
  const mapMarker = page.indexOf('id="mapTitle"');
  const developmentMarker = page.indexOf('id="devs"', mapMarker + 1);
  if (mapMarker < 0 || developmentMarker < 0) return page;
  const start = page.lastIndexOf('<div class="card">', mapMarker);
  const end = page.lastIndexOf('<div class="card">', developmentMarker);
  if (start < 0 || end <= start) return page;
  return `${page.slice(0, start)}${COMBINED_MAP_HTML}\n${page.slice(end)}`;
}

export function transformSiteAnalyzerPage(input) {
  let page = String(input || "");
  if (!page || page.includes('data-fiq-rendered="server"')) return page;

  const quickLinks = page.match(/<nav class="aadt-tabs"[\s\S]*?<\/nav>/)?.[0] || "";
  if (quickLinks) page = page.replace(quickLinks, "");
  page = page.replace(/<header>[\s\S]*?<\/header>/, HEADER_HTML);
  page = page.replace(/<div class="instructions">[\s\S]*?<\/div>/, `
<section class="fiq-intro" aria-labelledby="fiqSiteAnalyzerTitle">
  <span class="fiq-kicker">Fuel site underwriting</span>
  <h1 id="fiqSiteAnalyzerTitle">Estimate volume, validate traffic, and run sourced diligence.</h1>
  <p>Select an address, review Fuel IQ’s recommended official AADT reading, calculate expected gallons, and run exhaustive public-record and market research from one workspace.</p>
  ${quickLinks}
</section>`);

  page = replaceFirstCard(page);
  page = removeNotes(page);
  page = combineMapSections(page);
  page = page.replace(/<div class="card"><div id="devs" class="muted">—<\/div><\/div>/, '<div id="devs" hidden>—</div>');
  page = page.replace(/<div class="card"><b>Google Rating<\/b><div id="ratingLine" class="muted">—<\/div><\/div>/, '<div id="ratingLine" hidden>—</div>');
  page = page.replace(/<div class="footerbar">\s*<button id="exportPDF">[\s\S]*?<\/button>\s*<\/div>/, EXPORT_DOCK_HTML);

  if (!page.includes('id="siteResearchLoadingOverlay"')) page = page.replace("</body>", `${RESEARCH_OVERLAY_HTML}\n</body>`);
  if (!page.includes('id="siteResearchProfessionalStyles"')) page = page.replace("</head>", `${PROFESSIONAL_CSS}\n</head>`);
  page = page.replace(/<body(?:\s[^>]*)?>/, '<body class="fiq-professional-layout" data-fiq-rendered="server">');
  return page;
}
