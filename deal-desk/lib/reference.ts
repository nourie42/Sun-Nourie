export const auditGroups=[{title:'Book1 / Global: replace deal inputs, preserve reviewed formulas',rows:[
 ['C32:C34','Replace with sourced channel counts and explicitly connect downstream.','Current ARKO counts have no dependents. Changing them does not change synergy.'],
 ['Rows 3–12','Replace operational volumes, eligible shares, rates, counts and ramp assumptions.','Category EBITDA/capital estimates; terminal row later drops eligibility.'],
 ['Rows 15–22','Rebuild G&A, brand, credit and payment assumptions with owners and contracts.','G15/G18 mix realization with severance. E19 is #REF!. Some H-column costs do not feed capital.'],
 ['Rows 25–28','Separate procurement savings on growth and maintenance capital.','About $11.554m legacy annual savings are presented under EBITDA despite capital bases.'],
 ['Historical and forecast financials','Replace legacy Global/GLP 2021–2023 figures with target-period financials.','Old financials are not ARKO results. Do not infer target margins from this sheet.'],
 ['K9:R9','Apply validated terminal eligibility consistently through years.','Later years omit the 75% factor used earlier, overstating that opportunity.'],
 ['E19; L19:R19','Repair formula source and recalculate in Excel before relying on outputs.','Stored values can remain numeric despite a broken upstream reference.'],
 ['Entire Global tab','Add a separate acquisition cash-flow model and Sun/dealer split.','No purchase price, IRR, NPV or complete commission-conversion valuation exists.']
 ]},{title:'Simple Model: reference mechanics and material checks',rows:[
 ['COOP!A1; COAG Dealer vs Sun P&L','Use explicit Sunoco and dealer economics for the converted operating model.','COOP assumes conversion, but Combined does not use the detailed split P&L.'],
 ['Combined','Remove all example channels and reconcile each channel’s contribution.','1 COOP + 1,000 DODO example sites currently feed the summary.'],
 ['DODO!C16','Confirm expense sign.','Positive $900,000 Opex adds to earnings in the current example.'],
 ['COOP!S18:S19','Confirm dealer income and ongoing support with the owner.','Values disagree with notes; do not treat examples as approved standards.'],
 ['COCM/CODO/DODO!S19','Populate or explicitly confirm ongoing G&A.','Blank assumption cells produce zero support costs.'],
 ['COOP!C29','Source any upfront dealer/asset proceeds independently.','Current formula creates proceeds from annual dealer income.'],
 ['COOP!C16 and C21','Reconcile whether rent is included in operating cost.','Labels create potential double deduction of rental expense.'],
 ['Combined COOP activation','Review blank versus zero site-count logic before clearing channels.','Zeroing COOP does not reliably remove remaining cash flows.']
 ]}];
export const ideas=[
 {title:'Fuel purchasing & freight',owner:'Supply + Pricing',body:'Compare seller delivered cost with a matched Sunoco quote by terminal, product, brand and contract. Multiply the net CPG improvement by eligible gallons. Separate freight only if it is not already included.',proof:'Invoices, supply agreements, lane bids, contract expiry dates.'},
 {title:'Dealer conversion',owner:'Account Management + Real Estate',body:'Remove transferred inside gross profit, add dealer rent, deduct commission and retained owner costs. No blanket 100% Opex takeout. Prove the operator can earn a sustainable return.',proof:'Site P&Ls, dealer proposals and cost responsibility matrix.'},
 {title:'G&A and shared services',owner:'Finance + operating owners',body:'Build avoidable costs by role and vendor, then deduct new Sunoco support and stranded costs. Separate severance and integration cash costs. Rebuilt retained G&A already captures the takeout.',proof:'Payroll, vendor ledger, future org chart and approved support budget.'},
 {title:'Payments, property and capital',owner:'Payments + Real Estate + Environmental',body:'Use card sales and transaction counts for processing savings. Separate fuel and store fees. Rent is constrained by dealer earnings. Tank and environmental obligations follow ownership and contracts.',proof:'Merchant statements, lease terms, title and equipment schedules.'}
];
export const sources=[
 {title:'Sunoco commission-agent conversion · 2 April 2018',url:'https://www.sunocolp.com/press-release/item/27a640b3-aac0-4761-8186-1f793aa17d3a',note:'Sunoco retained fuel ownership/pricing, paid a fixed CPG commission and received rent. Operators ran stores and restaurants.'},
 {title:'Sunoco 2025 Form 10-K · 19 February 2026',url:'https://www.sec.gov/Archives/edgar/data/1552275/000155227526000021/sun-20251231.htm',note:'Agency operations, owned versus leased property, related-party and retained expense considerations.'},
 {title:'Parkland acquisition presentation · 5 May 2025',url:'https://s24.q4cdn.com/191304019/files/doc_presentations/2025/05/05/Parkland-Acquisition-Presentation-FINAL.pdf',note:'At least $250m initial Year-3 run-rate synergy forecast for a diverse acquisition. Not a per-store benchmark.'},
 {title:'Sunoco investor presentation · August 2026',url:'https://s24.q4cdn.com/191304019/files/doc_presentations/2026/08/August-2026-Investor-Presentation_vF.pdf',note:'Operational acquisition strategy and 4.0× long-term leverage target. NuStar results are not retail Opex assumptions.'},
 {title:'Sunoco Q2 results · 4 August 2026',url:'https://www.sunocolp.com/press-release/item/sunoco-lp-and-sunococorp-llc-report-strong-second-quarter-2026-financial-and-operating-results-2026',note:'Reported credit-agreement leverage about 3.7×. Treasury definitions and current funding plans remain required.'}
];

