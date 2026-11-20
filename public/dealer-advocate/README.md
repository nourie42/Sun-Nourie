# Independent Dealer Advisory — Pre-launch Concept

This is a **separate, unlaunched business concept website** within Sun-Nourie.

- **Working name:** Independent Dealer Advisory. This is a descriptive placeholder, not a validated company name or trademark.
- **Feature branch:** \`feature/independent-dealer-advisory\`
- **Future path when deployed:** \`/dealer-advocate/\`
- **Entrypoint:** \`public/dealer-advocate/index.html\`
- **Supporting assets:** \`style.css\`, \`app.js\`
- **No modifications to weather pages, AI benchmark pages, Fuel IQ analysis, server routing, or private financial pages.**
- **Preview status:** Not accepting clients. No forms, file uploads, payments, or third-party analytics. The calculator runs locally in the visitor's browser.
- **Search visibility:** \`noindex,nofollow\` is set while this is a concept. **Noindex is not authentication.** Publishing or merging this branch makes the page potentially accessible to anyone with the URL.

## Product positioning

Dealer-paid commercial advisory for independent convenience-store owners, particularly one- to ten-site operators.

1. Fuel supply economics and agreement cost comparisons.
2. Store profitability reviews and practical margin improvement.
3. Commercial negotiation preparation and recurring dealer-side support.

The site is intentionally not affiliated with Sunoco or other suppliers. Contract-law interpretation and legal representation are excluded and referred to licensed counsel. No savings are guaranteed.

## Calculator formulas

- Fuel economics illustration = annual gallons × anticipated cents-per-gallon improvement / 100.
- Inside economics illustration = annual inside sales × anticipated gross-margin percentage-point improvement / 100.
- Illustrative additional annual gross profit = fuel illustration + inside illustration.

The inputs are hypothetical and should not be marketed as forecasts or validated customer savings. Calculations exclude advisory fees, taxes, working capital, changeover costs, contractual limitations, and offsetting operational changes.

## Before commercial launch

1. Obtain independent legal advice regarding current and former employment duties, restrictive covenants, customer contact and confidential information.
2. Validate the trade name, trademark availability, domain and business registration.
3. Confirm any licensing, insurance, legal services, disclosure and privacy requirements.
4. Replace preview notice and contact language **only after** a secure intake channel and business contacts are established.
5. Decide on pricing and scope after paid customer discovery. Avoid showing unvalidated prices as final rates.
6. Add a privacy policy, terms and accessibility review before accepting documents, inquiries or payments.
7. Check responsive layout in phone and desktop browsers and run calculator regression tests.
8. Confirm hosting of the Sun-Nourie app serves static directories from \`public\` (the current Express legacy server does so), then test \`/dealer-advocate/\`.
9. Deliberately add a navigation link from the main site **when ready to publish**. The feature branch intentionally does not change any existing navigation.
10. Only then merge or deploy the branch. Do not merge solely to get a draft preview if business confidentiality matters.

## Current validation

The feature branch's HTML, CSS and JS are standalone with no build dependencies. The JS syntax was verified, and a smoke test of the calculator produced:

- 1,000,000 gallons × 1.00¢ + $1,000,000 inside sales × 1.00 pp = $20,000.
- 1,500,000 gallons × 2.00¢ + $0 inside sales = $30,000.

These are development checks, not a full browser-based QA pass.
