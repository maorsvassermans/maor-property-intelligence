import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeListing, estimateRent } from '../src/analytics.js';

test('calculates the verified listing metrics', () => {
  const result=analyzeListing({asking_price:2480000,area_sqm:103,address_confidence:0.55,house_number:null});
  assert.equal(result.pricePerSqm,24078);
  assert.equal(result.grossYieldPct,3.19);
  assert.equal(result.evidenceLevel,'street-level');
  assert.equal(result.walkAwayPrice,2450000);
  assert.ok(result.netYieldPct < result.grossYieldPct);
});

test('rent estimate uses the median',()=>assert.equal(estimateRent([{asking_price:6500},{asking_price:7000},{asking_price:6500}]),6500));
