/**
 * Auditable, dependency-free fuel-retail acquisition underwriting.
 * All monetary inputs are USD. Margins in cents are converted to dollars once.
 * This is an unlevered, pre-tax illustrative model, not a financing model.
 * Structure labels do not supply or imply Sunoco or other company economics.
 */

export const structures = Object.freeze(['COOP', 'COAG', 'CALS']);

export const defaultInputs = Object.freeze({
  siteCount: 18,
  annualGallonsPerSite: 1_300_000,
  fuelMarginCPG: 20,
  merchandiseRevenuePerSite: 1_200_000,
  merchandiseMarginPercent: 30,
  otherProfitPerSite: 15_000,
  opexPerSite: 420_000,
  sustainingCapexPerSite: 35_000,
  synergyPerSite: 0,
  purchasePrice: 42_000_000,
  realEstateValue: 12_000_000,
  transactionCostPercent: 2,
  growthPercent: 2,
  terminalMultiple: 7,
  terminalSellingCostPercent: 2,
  targetYieldPercent: 15,
  targetIrrPercent: 15,
  years: 10,
  structure: 'COOP',
  operatorFuelMarginCPG: null,
  operatorMerchandiseMarginPercent: null,
  annualRentPerSite: 0,
  operatorOpexPerSite: null,
});

const field = (key, label, group, unit, min, max, step, description, extras = {}) =>
  Object.freeze({
    key, label, group, type: 'number', unit, min, max, step, description,
    optional: false, defaultValue: defaultInputs[key], ...extras,
  });

/** Input descriptors are also the validation schema used by auditModel. */
export const inputFields = Object.freeze([
  field('siteCount', 'Sites in portfolio', 'Operations', 'sites', 1, 10_000, 1,
    'Number of operating sites. Per-site assumptions are multiplied by this once.', { integer: true }),
  field('annualGallonsPerSite', 'Annual gallons per site', 'Operations', 'gallons', 0, 100_000_000, 10_000,
    'Annual gallons at one average site; portfolio gallons equal sites times this value.'),
  field('fuelMarginCPG', 'Fuel gross margin', 'Operations', 'cents/gallon', 0, 1_000, 0.5,
    'Realized fuel gross profit in cents per gallon before operating expenses.'),
  field('merchandiseRevenuePerSite', 'Annual merchandise sales per site', 'Operations', 'USD/year/site', 0, 1_000_000_000, 10_000,
    'Annual merchandise revenue at one average site, before cost of goods sold.'),
  field('merchandiseMarginPercent', 'Merchandise gross margin', 'Operations', '%', 0, 100, 1,
    'Merchandise gross profit as a percentage of merchandise revenue.'),
  field('otherProfitPerSite', 'Other annual gross profit per site', 'Operations', 'USD/year/site', 0, 1_000_000_000, 1_000,
    'Annual gross profit from other operations, such as commissions; enter profit, not revenue.'),
  field('opexPerSite', 'Annual operating expenses per site', 'Operations', 'USD/year/site', 0, 1_000_000_000, 5_000,
    'All operating expenses per site, excluding sustaining capex, financing, tax, and additional rent entered below.'),
  field('sustainingCapexPerSite', 'Annual sustaining capex per site', 'Operations', 'USD/year/site', 0, 1_000_000_000, 1_000,
    'Annual maintenance capital expenditure per site; deducted from adjusted EBITDA for cash flow.'),
  field('synergyPerSite', 'Annual synergy per site', 'Operations', 'USD/year/site', 0, 1_000_000_000, 1_000,
    'Explicit annual recurring savings per site, assumed available in year 1. Integration costs are not modeled.'),
  field('purchasePrice', 'Portfolio purchase price', 'Valuation', 'USD', 0.01, 1_000_000_000_000, 100_000,
    'Total debt-free, cash-free enterprise purchase price for the entire portfolio, including owned real estate.'),
  field('realEstateValue', 'Real estate value allocation', 'Valuation', 'USD', 0, 1_000_000_000_000, 100_000,
    'Allocation within the purchase price. This does not reduce cash invested or add separate terminal proceeds.'),
  field('transactionCostPercent', 'Acquisition transaction costs', 'Valuation', '% of purchase price', 0, 100, 0.25,
    'Acquisition costs added to the portfolio purchase price to determine total cash invested.'),
  field('targetYieldPercent', 'Target annual cash yield', 'Valuation', '%', 0.01, 100, 0.5,
    'Target unlevered, pre-tax year-1 cash yield on purchase price plus transaction costs, distinct from IRR.'),
  field('targetIrrPercent', 'Target investment IRR', 'Valuation', '%', 0.01, 100, 0.5,
    'Target annual unlevered, pre-tax investment IRR over the projection period, including terminal proceeds; distinct from annual cash yield.'),
  field('growthPercent', 'Annual operating growth', 'Projection', '% per year', -99, 100, 0.5,
    'Annual growth applied to EBITDA, recurring synergies, and sustaining capex from year 2; declines are allowed.'),
  field('terminalMultiple', 'Terminal EBITDA multiple', 'Projection', 'x', 0, 50, 0.25,
    'Exit enterprise value divided by final-year adjusted EBITDA. The enterprise multiple includes real estate.'),
  field('terminalSellingCostPercent', 'Exit selling costs', 'Projection', '% of exit value', 0, 100, 0.25,
    'Selling costs deducted from terminal enterprise value. Separate from acquisition transaction costs.'),
  field('years', 'Projection years', 'Projection', 'years', 1, 30, 1,
    'Annual forecast periods. Year 1 uses the entered operating assumptions; exit occurs at the end of the last year.', { integer: true }),
  Object.freeze({ key: 'structure', label: 'Operating structure', group: 'Operator assumptions',
    type: 'select', unit: '', options: structures, optional: false,
    defaultValue: defaultInputs.structure,
    description: 'COOP, COAG, or CALS planning label. A label alone never changes economics; enter verified operator terms explicitly.' }),
  field('operatorFuelMarginCPG', 'Operator fuel margin override', 'Operator assumptions', 'cents/gallon', 0, 1_000, 0.5,
    'Optional user-entered retained fuel margin for this structure. Blank uses the fuel margin above; no company terms are assumed.', { optional: true }),
  field('operatorMerchandiseMarginPercent', 'Operator merchandise margin override', 'Operator assumptions', '%', 0, 100, 1,
    'Optional user-entered retained merchandise margin. Blank uses the merchandise margin above.', { optional: true }),
  field('annualRentPerSite', 'Additional annual rent per site', 'Operator assumptions', 'USD/year/site', 0, 1_000_000_000, 1_000,
    'Rent payable by the modeled acquirer/operator in addition to the operating expenses above. Do not enter rent already included in expenses.'),
  field('operatorOpexPerSite', 'Operator operating expense override', 'Operator assumptions', 'USD/year/site', 0, 1_000_000_000, 5_000,
    'Optional user-entered operating expense responsibility per site, before additional rent. Blank uses operating expenses above.', { optional: true }),
]);

const fieldByKey = new Map(inputFields.map((descriptor) => [descriptor.key, descriptor]));
const issue = (fieldName, code, message, severity = 'error') => ({ field: fieldName, code, message, severity });

export class ModelValidationError extends RangeError {
  constructor(issues) {
    super(issues.map((entry) => entry.message).join(' '));
    this.name = 'ModelValidationError';
    this.issues = issues;
  }
}

function validate(input) {
  const issues = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { inputs: null, issues: [issue('input', 'invalid_object', 'Model inputs must be an object.')] };
  }
  const inputs = { ...defaultInputs };
  for (const key of Object.keys(input)) {
    if (!fieldByKey.has(key)) {
      issues.push(issue(key, 'unknown_field', `Unknown model field: ${key}.`, 'warning'));
      continue;
    }
    inputs[key] = input[key];
  }
  for (const descriptor of inputFields) {
    const value = inputs[descriptor.key];
    if (descriptor.type === 'select') {
      if (!descriptor.options.includes(value)) {
        issues.push(issue(descriptor.key, 'invalid_choice', `${descriptor.label} must be ${descriptor.options.join(', ')}.`));
      }
      continue;
    }
    if (descriptor.optional && value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push(issue(descriptor.key, 'invalid_number', `${descriptor.label} must be a finite number${descriptor.optional ? ' or null' : ''}.`));
      continue;
    }
    if (descriptor.integer && !Number.isInteger(value)) {
      issues.push(issue(descriptor.key, 'not_integer', `${descriptor.label} must be a whole number.`));
    }
    if (value < descriptor.min || value > descriptor.max) {
      issues.push(issue(descriptor.key, 'out_of_range', `${descriptor.label} must be between ${descriptor.min} and ${descriptor.max}.`));
    }
  }
  if (Number.isFinite(inputs.realEstateValue) && Number.isFinite(inputs.purchasePrice)
      && inputs.realEstateValue > inputs.purchasePrice) {
    issues.push(issue('realEstateValue', 'allocation_exceeds_price', 'Real estate allocation cannot exceed the total portfolio purchase price.'));
  }
  return { inputs, issues };
}

/**
 * Returns an annual IRR as a decimal (0.10 means 10%), or null when no unique
 * finite conventional IRR exists. Equal annual spacing is required. Cash-flow
 * streams with more than one sign change are deliberately not assigned a root.
 */
export function irr(cashFlows) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2
      || cashFlows.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError('IRR requires at least two finite annual cash flows.');
  }
  const signs = cashFlows.filter((value) => value !== 0).map(Math.sign);
  let signChanges = 0;
  for (let index = 1; index < signs.length; index += 1) {
    if (signs[index] !== signs[index - 1]) signChanges += 1;
  }
  if (signChanges !== 1 || cashFlows[0] === 0) return null;
  const scale = Math.max(...cashFlows.map(Math.abs));
  const normalized = cashFlows.map((value) => value / scale);
  // Horner evaluation avoids powers overflowing for rates close to -100%.
  const npv = (rate) => {
    const divisor = 1 + rate;
    let value = normalized.at(-1);
    for (let index = normalized.length - 2; index >= 0; index -= 1) {
      value = value / divisor + normalized[index];
    }
    return value;
  };
  let lower = -1 + 1e-12;
  let upper = 1;
  let lowerValue = npv(lower);
  let upperValue = npv(upper);
  while (Math.sign(lowerValue) === Math.sign(upperValue) && upper < Number.MAX_VALUE / 4) {
    upper = upper * 2 + 1;
    upperValue = npv(upper);
  }
  if (Number.isNaN(lowerValue) || Number.isNaN(upperValue)
      || Math.sign(lowerValue) === Math.sign(upperValue)) return null;
  if (lowerValue === 0) return lower;
  if (upperValue === 0) return upper;
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const middle = (lower + upper) / 2;
    const middleValue = npv(middle);
    if (middleValue === 0 || upper - lower < 1e-12 * Math.max(1, Math.abs(middle))) return middle;
    if (Math.sign(middleValue) === Math.sign(lowerValue)) {
      lower = middle;
      lowerValue = middleValue;
    } else {
      upper = middle;
      upperValue = middleValue;
    }
  }
  return (lower + upper) / 2;
}

function metrics(inputs, withProjection = true) {
  const fuelMargin = inputs.operatorFuelMarginCPG ?? inputs.fuelMarginCPG;
  const merchandiseMargin = inputs.operatorMerchandiseMarginPercent ?? inputs.merchandiseMarginPercent;
  const expenses = inputs.operatorOpexPerSite ?? inputs.opexPerSite;
  const gallons = inputs.siteCount * inputs.annualGallonsPerSite;
  const fuelGrossProfit = gallons * fuelMargin / 100;
  const merchandiseGrossProfit = inputs.siteCount * inputs.merchandiseRevenuePerSite * merchandiseMargin / 100;
  const otherGrossProfit = inputs.siteCount * inputs.otherProfitPerSite;
  const grossProfit = fuelGrossProfit + merchandiseGrossProfit + otherGrossProfit;
  const rent = inputs.siteCount * inputs.annualRentPerSite;
  const opex = inputs.siteCount * expenses + rent;
  const ebitda = grossProfit - opex;
  const synergy = inputs.siteCount * inputs.synergyPerSite;
  const adjustedEbitda = ebitda + synergy;
  const sustainingCapex = inputs.siteCount * inputs.sustainingCapexPerSite;
  const transactionCosts = inputs.purchasePrice * inputs.transactionCostPercent / 100;
  const acquisitionCost = inputs.purchasePrice + transactionCosts;
  const cashFlow = adjustedEbitda - sustainingCapex;
  const operatingBusinessValue = inputs.purchasePrice - inputs.realEstateValue;
  const result = {
    gallons, fuelGrossProfit, merchandiseGrossProfit, otherGrossProfit, grossProfit,
    rent, opex, ebitda, synergy, adjustedEbitda, sustainingCapex, transactionCosts,
    acquisitionCost, enterpriseValue: inputs.purchasePrice, operatingBusinessValue,
    cashFlow, yieldPercent: cashFlow / acquisitionCost * 100,
    impliedMultiple: adjustedEbitda > 0 ? inputs.purchasePrice / adjustedEbitda : null,
    operatingBusinessMultiple: adjustedEbitda > 0 ? operatingBusinessValue / adjustedEbitda : null,
    maxPriceForTargetYield: Math.max(0, cashFlow) / (inputs.targetYieldPercent / 100)
      / (1 + inputs.transactionCostPercent / 100),
    paybackYears: cashFlow > 0 ? acquisitionCost / cashFlow : null,
    effectiveFuelMarginCPG: fuelMargin,
    effectiveMerchandiseMarginPercent: merchandiseMargin,
    effectiveOpexPerSite: expenses,
  };
  if (!withProjection) return result;
  let cumulativeCashFlow = 0;
  let projectedPaybackYears = null;
  const projections = [];
  for (let year = 1; year <= inputs.years; year += 1) {
    const factor = (1 + inputs.growthPercent / 100) ** (year - 1);
    const projectedAdjustedEbitda = adjustedEbitda * factor;
    const projectedCapex = sustainingCapex * factor;
    const projectedCashFlow = projectedAdjustedEbitda - projectedCapex;
    const terminalValue = year === inputs.years
      ? Math.max(0, projectedAdjustedEbitda) * inputs.terminalMultiple * (1 - inputs.terminalSellingCostPercent / 100)
      : 0;
    if (projectedPaybackYears === null && projectedCashFlow > 0
        && cumulativeCashFlow < acquisitionCost && cumulativeCashFlow + projectedCashFlow >= acquisitionCost) {
      projectedPaybackYears = year - 1 + (acquisitionCost - cumulativeCashFlow) / projectedCashFlow;
    }
    cumulativeCashFlow += projectedCashFlow;
    projections.push({ year, ebitda: ebitda * factor, adjustedEbitda: projectedAdjustedEbitda,
      sustainingCapex: projectedCapex, cashFlow: projectedCashFlow, terminalValue,
      totalCashFlow: projectedCashFlow + terminalValue, cumulativeCashFlow });
  }
  const cashFlows = [-acquisitionCost, ...projections.map((period) => period.totalCashFlow)];
  const rate = irr(cashFlows);
  const presentValueAtTargetIrr = projections.reduce((value, period) =>
    value + period.totalCashFlow / (1 + inputs.targetIrrPercent / 100) ** period.year, 0);
  const maxPriceForTargetIrr = Math.max(0, presentValueAtTargetIrr)
    / (1 + inputs.transactionCostPercent / 100);
  return { ...result, projections, cashFlows, irrPercent: rate === null ? null : rate * 100,
    projectedPaybackYears, terminalValue: projections.at(-1).terminalValue,
    presentValueAtTargetIrr, maxPriceForTargetIrr };
}

function warningsFor(inputs, result) {
  const warnings = [];
  if (result.adjustedEbitda <= 0) warnings.push(issue('opexPerSite', 'nonpositive_ebitda',
    'Adjusted EBITDA is not positive; EBITDA multiples are unavailable and modeled terminal enterprise value is zero.', 'warning'));
  if (result.cashFlow <= 0) warnings.push(issue('sustainingCapexPerSite', 'nonpositive_cash_flow',
    'Annual cash flow is not positive; no positive purchase price can achieve the target annual cash yield.', 'warning'));
  if (result.yieldPercent < inputs.targetYieldPercent) warnings.push(issue('purchasePrice', 'below_target_yield',
    'The entered purchase price produces a year-1 cash yield below the selected target.', 'warning'));
  if (result.irrPercent !== undefined && result.irrPercent === null) warnings.push(issue('cashFlows', 'irr_unavailable',
    'These projected cash flows have no unique finite conventional annual IRR.', 'warning'));
  if (Number.isFinite(result.irrPercent) && result.irrPercent < inputs.targetIrrPercent) warnings.push(issue('purchasePrice', 'below_target_irr',
    'The entered purchase price produces an investment IRR below the selected target.', 'warning'));
  if (result.paybackYears === null || result.paybackYears > inputs.years) warnings.push(issue('purchasePrice', 'payback_exceeds_horizon',
    'At the year-1 cash-flow run rate, operating cash flows do not repay invested capital within the selected projection period.', 'warning'));
  if (inputs.synergyPerSite > 0) warnings.push(issue('synergyPerSite', 'unverified_synergy',
    'Recurring synergies are assumed from year 1 without integration costs; verify timing, execution costs, and overlap with operating expenses.', 'warning'));
  const operatorEntered = inputs.operatorFuelMarginCPG !== null || inputs.operatorMerchandiseMarginPercent !== null
    || inputs.operatorOpexPerSite !== null || inputs.annualRentPerSite > 0;
  if (inputs.structure !== 'COOP' && !operatorEntered) warnings.push(issue('structure', 'operator_terms_missing',
    'This structure uses the baseline operating assumptions. Enter verified operator margin, rent, and expense responsibilities to reflect its economics.', 'warning'));
  if (inputs.growthPercent > 10) warnings.push(issue('growthPercent', 'high_growth_assumption',
    'Annual growth exceeds 10%; validate the resulting long-term operating and capex projections.', 'warning'));
  return warnings;
}

/** Validate inputs and identify model concerns without throwing or mutating. */
export function auditModel(input = {}) {
  const checked = validate(input);
  const errors = checked.issues.filter((entry) => entry.severity === 'error');
  const warnings = checked.issues.filter((entry) => entry.severity === 'warning');
  if (errors.length === 0) warnings.push(...warningsFor(checked.inputs, metrics(checked.inputs)));
  return { valid: errors.length === 0, issues: [...errors, ...warnings], errors, warnings };
}

function clampField(key, value) {
  const descriptor = fieldByKey.get(key);
  return Math.max(descriptor.min, Math.min(descriptor.max, value));
}

function buildScenarios(inputs) {
  const definitions = [
    { key: 'downside', label: 'Downside', changes: { annualGallonsPercent: -10, fuelMarginCPG: -3, merchandiseRevenuePercent: -5, opexPercent: 5 } },
    { key: 'base', label: 'Base', changes: { annualGallonsPercent: 0, fuelMarginCPG: 0, merchandiseRevenuePercent: 0, opexPercent: 0 } },
    { key: 'upside', label: 'Upside', changes: { annualGallonsPercent: 10, fuelMarginCPG: 3, merchandiseRevenuePercent: 5, opexPercent: -5 } },
  ];
  return definitions.map((definition) => {
    const adjusted = { ...inputs };
    const fuelKey = inputs.operatorFuelMarginCPG === null ? 'fuelMarginCPG' : 'operatorFuelMarginCPG';
    const expenseKey = inputs.operatorOpexPerSite === null ? 'opexPerSite' : 'operatorOpexPerSite';
    adjusted.annualGallonsPerSite = clampField('annualGallonsPerSite', inputs.annualGallonsPerSite * (1 + definition.changes.annualGallonsPercent / 100));
    adjusted[fuelKey] = clampField(fuelKey, inputs[fuelKey] + definition.changes.fuelMarginCPG);
    adjusted.merchandiseRevenuePerSite = clampField('merchandiseRevenuePerSite', inputs.merchandiseRevenuePerSite * (1 + definition.changes.merchandiseRevenuePercent / 100));
    adjusted[expenseKey] = clampField(expenseKey, inputs[expenseKey] * (1 + definition.changes.opexPercent / 100));
    const result = metrics(adjusted);
    return { ...definition, inputs: adjusted, ebitda: result.ebitda, adjustedEbitda: result.adjustedEbitda,
      cashFlow: result.cashFlow, yieldPercent: result.yieldPercent, irrPercent: result.irrPercent,
      impliedMultiple: result.impliedMultiple, acquisitionCost: result.acquisitionCost,
      effectiveFuelMarginCPG: result.effectiveFuelMarginCPG };
  });
}

function buildSensitivity(inputs) {
  const fuelKey = inputs.operatorFuelMarginCPG === null ? 'fuelMarginCPG' : 'operatorFuelMarginCPG';
  const fuelMarginsCPG = [...new Set([-5, 0, 5].map((delta) => clampField(fuelKey, inputs[fuelKey] + delta)))];
  const purchasePrices = [...new Set([0.8, 1, 1.2].map((factor) => clampField('purchasePrice', inputs.purchasePrice * factor)))];
  const values = fuelMarginsCPG.map((margin) => purchasePrices.map((price) =>
    metrics({ ...inputs, [fuelKey]: margin, purchasePrice: price,
      realEstateValue: Math.min(inputs.realEstateValue, price) }, false).yieldPercent));
  return { metric: 'yieldPercent', rowLabel: 'Fuel margin (cents per gallon)',
    columnLabel: 'Portfolio purchase price', fuelMarginsCPG, purchasePrices, values };
}

/** Compute the entered base case, specified scenario shocks, and sensitivity. */
export function calculate(input = {}) {
  const checked = validate(input);
  const errors = checked.issues.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) throw new ModelValidationError(errors);
  const inputs = checked.inputs;
  const result = metrics(inputs);
  const flags = [...checked.issues.filter((entry) => entry.severity === 'warning'), ...warningsFor(inputs, result)];
  const assumptions = {
    nature: 'Illustrative user-entered underwriting assumptions; not verified target financials or company-specific operating terms.',
    cashFlowBasis: 'Unlevered, pre-tax annual cash flow = adjusted EBITDA minus sustaining capital expenditure.',
    yieldBasis: 'Year-1 unlevered, pre-tax cash flow divided by total acquisition cost; distinct from investment IRR.',
    enterpriseValueBasis: 'Portfolio debt-free, cash-free purchase price including real estate; allocation does not reduce cash invested.',
    irrBasis: 'Equally spaced annual cash flows; full acquisition outlay at time zero; final-year operating cash flow plus enterprise exit proceeds net of explicit selling costs.',
    targetIrrPriceBasis: 'Maximum portfolio purchase price for the target investment IRR equals the present value of all projected operating and terminal cash flows discounted at that target, divided by one plus the acquisition transaction cost rate. Distinct from the year-1 cash-yield maximum price.',
    terminalBasis: 'Final-year adjusted EBITDA times the terminal enterprise multiple, including real estate. No separate property proceeds are added.',
    paybackBasis: 'Static, undiscounted acquisition cost divided by year-1 cash flow, excluding exit proceeds. projectedPaybackYears uses forecast operating cash flows and is null if they do not repay capital within the horizon.',
    growthBasis: 'Year 1 uses entered values. EBITDA, recurring synergies, and sustaining capex all grow at the same annual rate from year 2.',
    operatorBasis: 'COOP/COAG/CALS are labels. Only explicit user-entered retained margins, additional rent, and operating expense overrides change results; no Sunoco economics are assumed.',
    exclusions: ['Debt, interest, and financing fees', 'Income taxes', 'Working-capital changes',
      'Integration and transition costs', 'Development capex and expansion', 'Deferred maintenance and environmental remediation',
      'Real estate sale-leaseback proceeds or separate property exit proceeds'],
  };
  return { inputs, ...result, scenarios: buildScenarios(inputs), sensitivity: buildSensitivity(inputs), flags,
    audit: { valid: true, issues: flags, errors: [], warnings: flags }, assumptions };
}
