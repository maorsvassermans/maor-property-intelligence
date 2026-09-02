const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const median = (values) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export const defaultAssumptions = {
  estimatedMonthlyRent: 6600,
  vacancyRate: 0.03,
  maintenanceRate: 0.05,
  annualInsurance: 1200,
  managementRate: 0,
  purchaseTaxRate: 0.08,
  lawyerRateWithVat: 0.0059,
  brokerRateWithVat: 0.0236,
  appraisal: 2500,
  renovation: 100000,
  furniture: 0,
  miscellaneous: 10000,
  fairValueLow: 2350000,
  fairValueHigh: 2500000,
  sellerDaysOnline: 60,
  priceReduction: 160000
};

export function analyzeListing(listing, overrides = {}) {
  const a = { ...defaultAssumptions, ...overrides };
  const price = listing.asking_price;
  const area = listing.area_sqm;
  const annualGrossRent = a.estimatedMonthlyRent * 12;
  const annualNetRent = annualGrossRent * (1 - a.vacancyRate - a.maintenanceRate - a.managementRate) - a.annualInsurance;
  const acquisitionCosts = price * (a.purchaseTaxRate + a.lawyerRateWithVat + a.brokerRateWithVat) + a.appraisal + a.renovation + a.furniture + a.miscellaneous;
  const totalInvestment = price + acquisitionCosts;
  const fairValueMid = (a.fairValueLow + a.fairValueHigh) / 2;
  const discountToMarket = (fairValueMid - price) / fairValueMid;
  const grossYield = annualGrossRent / price;
  const netYield = annualNetRent / totalInvestment;
  const priceDropPct = a.priceReduction / (price + a.priceReduction);
  const priceScore = clamp(50 + discountToMarket * 500, 0, 100);
  const yieldScore = clamp((netYield - 0.015) / 0.025 * 100, 0, 100);
  const priceDropScore = clamp(priceDropPct / 0.08 * 100, 0, 100);
  const rentalDemandScore = 78;
  const liquidityScore = 80;
  const locationScore = 82;
  const riskScore = listing.address_confidence >= 0.8 ? 80 : 58;
  const dealScore = Math.round(priceScore * 0.30 + yieldScore * 0.20 + rentalDemandScore * 0.15 + priceDropScore * 0.10 + liquidityScore * 0.10 + locationScore * 0.10 + riskScore * 0.05);
  const motivationScore = Math.round(clamp(a.sellerDaysOnline / 120 * 35 + priceDropPct / 0.08 * 45 + 10, 0, 100));
  return {
    evidenceLevel: listing.house_number ? 'building-level' : 'street-level',
    pricePerSqm: area ? Math.round(price / area) : null,
    estimatedMonthlyRent: a.estimatedMonthlyRent,
    annualGrossRent: Math.round(annualGrossRent), annualNetRent: Math.round(annualNetRent),
    grossYieldPct: +(grossYield * 100).toFixed(2), netYieldPct: +(netYield * 100).toFixed(2),
    acquisitionCosts: Math.round(acquisitionCosts), totalInvestment: Math.round(totalInvestment),
    fairValue: { low: a.fairValueLow, high: a.fairValueHigh, midpoint: fairValueMid },
    askingVsMidpointPct: +((price / fairValueMid - 1) * 100).toFixed(2),
    suggestedOpeningOffer: Math.round(a.fairValueLow * 0.95 / 10000) * 10000,
    targetAcquisition: { low: Math.round(a.fairValueLow / 10000) * 10000, high: Math.round(fairValueMid / 10000) * 10000 },
    walkAwayPrice: Math.round(Math.min(a.fairValueHigh * 0.99, fairValueMid * 1.01) / 10000) * 10000,
    scores: { price: Math.round(priceScore), yield: Math.round(yieldScore), rentalDemand: rentalDemandScore, priceDrop: Math.round(priceDropScore), liquidity: liquidityScore, location: locationScore, risk: riskScore, deal: dealScore, sellerMotivation: motivationScore },
    assumptions: a
  };
}

export function estimateRent(comps) { return median(comps.map((x) => Number(x.asking_price))); }
