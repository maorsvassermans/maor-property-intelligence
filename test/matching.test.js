import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCrossSourceMatch } from '../src/matching.js';
import { deduplicateListings } from '../src/repository.js';

const base={source:'yad2',listing_type:'sale',city:'קריית אונו',neighborhood:'קיראון',street:'איריס',house_number:null,rooms:4,area_sqm:100,floor:4,asking_price:2350000,raw:{}};

test('missing house number can still produce a probable cross-source match',()=>{
  const result=scoreCrossSourceMatch(base,{...base,source:'komo',area_sqm:104,asking_price:2380000});
  assert.equal(result.status,'probable'); assert.ok(result.score>=75); assert.ok(result.reasons.includes('אותו רחוב'));
});

test('conflicting house numbers reject an otherwise similar listing',()=>{
  const result=scoreCrossSourceMatch({...base,house_number:'1'},{...base,source:'madlan',house_number:'8'});
  assert.equal(result.status,'rejected'); assert.equal(result.score,0);
});

test('dashboard deduplication keeps one representative per canonical property',()=>{
  const rows=[
    {id:900001,property_id:700001,source:'ad',last_seen:'2026-09-01T10:00:00Z'},
    {id:900002,property_id:700001,source:'yad2',last_seen:'2026-09-01T09:00:00Z'}
  ];
  const result=deduplicateListings(rows);
  assert.equal(result.length,1);assert.equal(result[0].source,'yad2');assert.equal(result[0].source_count,2);
  assert.deepEqual(result[0].duplicate_listing_ids,[900002,900001]);
});
