import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketplaceOcrText } from '../src/ocr.js';
import { importTaxTransactions } from '../src/evidence.js';
import { getEvidenceAssumptions, getListing } from '../src/repository.js';
import { db } from '../src/db.js';

test('Marketplace OCR parser extracts Hebrew property fields',()=>{
  const parsed=parseMarketplaceOcrText('דירה למכירה\nקריית אונו\nהמעגל 16\n4 חדרים | 103 מ״ר | קומה 6\n₪ 2,480,000');
  assert.equal(parsed.city,'קריית אונו');assert.equal(parsed.price,2480000);assert.equal(parsed.rooms,4);assert.equal(parsed.areaSqm,103);assert.equal(parsed.floor,6);assert.equal(parsed.street,'המעגל');assert.equal(parsed.houseNumber,'16');
});

test('Tax Authority transaction import feeds evidence-based valuation',(t)=>{
  const sourceId=`tax-test-${Date.now()}`;
  const result=importTaxTransactions([{sourceTransactionId:sourceId,transactionDate:'2026-08-01',price:2400000,city:'קריית אונו',neighborhood:'רימון',street:'המעגל',houseNumber:'16',rooms:4,areaSqm:100}],{source:'tax-authority-test'});
  t.after(()=>db.prepare('DELETE FROM transactions WHERE source=? AND source_transaction_id=?').run('tax-authority-test',sourceId));
  assert.equal(result.imported,1);
  const evidence=getEvidenceAssumptions(getListing(1));
  assert.ok(evidence.evidence.transactionCount>=1);assert.equal(evidence.evidence.valuationMethod,'tax-transactions-price-per-sqm');assert.ok(evidence.overrides.fairValueLow>0);
});
