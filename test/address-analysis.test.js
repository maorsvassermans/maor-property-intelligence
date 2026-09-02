import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAddress, parseAddressInput, suggestAddresses } from '../src/address-analysis.js';
import { importTaxTransactions } from '../src/evidence.js';
import { upsertNormalized } from '../src/repository.js';
import { db } from '../src/db.js';

test('parses a full Israeli address',()=>{
  assert.deepEqual(parseAddressInput('יצחק רבין 10, קריית אונו'),{city:'קריית אונו',street:'יצחק רבין',houseNumber:'10'});
});

test('address analysis prioritizes local evidence and excludes city median',t=>{
  const suffix=String(Date.now()),street=`בדיקת מיקוד ${suffix}`,parallelStreet=`רחוב מקביל ${suffix}`,farStreet=`רחוב רחוק ${suffix}`,source=`address-focus-${suffix}`,listingSourceId=`address-listing-${suffix}`;
  const listingId=upsertNormalized({property:{canonicalKey:`address|קרייתאונו|${street.replace(/\s/g,'')}|8`,city:'קריית אונו',neighborhood:'שכונת בדיקה',street,houseNumber:'8',latitude:null,longitude:null,addressConfidence:.9},listing:{source:'yad2',sourceId:listingSourceId,listingType:'sale',sourceUrl:null,propertyType:'דירה',rooms:4,areaSqm:100,floor:3,totalFloors:8,askingPrice:3000000,sellerType:'private',parking:1,elevator:1,balcony:1,mamad:1,storage:0,description:null,raw:{test:true}}});
  importTaxTransactions([
    {sourceTransactionId:`${source}-building`,transactionDate:'2026-06-01',price:2900000,city:'קריית אונו',neighborhood:'שכונת בדיקה',street,houseNumber:'8',rooms:4,areaSqm:100,floor:2},
    {sourceTransactionId:`${source}-street`,transactionDate:'2026-05-01',price:3000000,city:'קריית אונו',neighborhood:'שכונת בדיקה',street,houseNumber:'12',rooms:4,areaSqm:102,floor:4},
    {sourceTransactionId:`${source}-neighborhood`,transactionDate:'2026-04-01',price:2800000,city:'קריית אונו',neighborhood:'שכונת בדיקה',street:parallelStreet,houseNumber:'2',rooms:4,areaSqm:98,floor:3},
    {sourceTransactionId:`${source}-city`,transactionDate:'2026-03-01',price:5000000,city:'קריית אונו',neighborhood:'שכונה אחרת',street:farStreet,houseNumber:'1',rooms:4,areaSqm:100,floor:3}
  ],{source});
  t.after(()=>{
    const listing=db.prepare('SELECT property_id FROM listings WHERE id=?').get(listingId);
    db.prepare('DELETE FROM listing_price_history WHERE listing_id=?').run(listingId);db.prepare('DELETE FROM alerts WHERE listing_id=?').run(listingId);db.prepare('DELETE FROM listings WHERE id=?').run(listingId);
    db.prepare('DELETE FROM transactions WHERE source=?').run(source);
    db.prepare(`DELETE FROM properties WHERE id=? OR (city='קריית אונו' AND street IN (?,?,?) AND NOT EXISTS(SELECT 1 FROM listings WHERE listings.property_id=properties.id) AND NOT EXISTS(SELECT 1 FROM transactions WHERE transactions.property_id=properties.id))`).run(listing.property_id,street,parallelStreet,farStreet);
  });
  const result=analyzeAddress({address:`${street} 8, קריית אונו`});
  assert.equal(result.matchedListing.id,listingId);assert.equal(result.comparables.length,3);assert.equal(result.evidence.availableInCity>=4,true);assert.equal(result.evidence.cityFallbackUsed,false);
  assert.deepEqual(result.comparables.map((item)=>item.scope),['building','street','neighborhood']);
  assert.equal(result.valuation.midpoint,2900000);assert.ok(result.comparables.every((item)=>item.street!==farStreet));
  assert.ok(suggestAddresses({q:street}).some((item)=>item.address.includes(street)));
  const unsupported=analyzeAddress({city:'קריית אונו',street:'רחוב ללא ראיות',houseNumber:'99',areaSqm:100,rooms:4});
  assert.equal(unsupported.comparables.length,0);assert.equal(unsupported.valuation,null);assert.equal(unsupported.evidence.cityFallbackUsed,false);
});
