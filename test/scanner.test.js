import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { fetchYad2 } from '../src/apify.js';
import { listAlerts } from '../src/alerts.js';
import { runScan } from '../src/scanner.js';
import { fetchSource } from '../src/apify.js';
import { normalizeApifyListing } from '../src/normalize.js';
import { db } from '../src/db.js';
import { parseKomoHtml } from '../src/komo.js';
import { parseAdHtml } from '../src/ad.js';
import { ingestMarketplaceItem } from '../src/marketplace.js';

const response=(rows)=>new Response(JSON.stringify(rows),{status:200,headers:{'content-type':'application/json'}});
const removeListing=(sourceId)=>{
  const row=db.prepare('SELECT id,property_id FROM listings WHERE source_listing_id=?').get(sourceId); if(!row)return;
  db.prepare('DELETE FROM listing_match_candidates WHERE listing_id_a=? OR listing_id_b=?').run(row.id,row.id);
  db.prepare('DELETE FROM marketplace_inbox_items WHERE listing_id=?').run(row.id);
  db.prepare('DELETE FROM alerts WHERE listing_id=?').run(row.id); db.prepare('DELETE FROM listing_price_history WHERE listing_id=?').run(row.id);
  db.prepare('DELETE FROM analyses WHERE listing_id=?').run(row.id); db.prepare('DELETE FROM listings WHERE id=?').run(row.id);
  db.prepare('DELETE FROM properties WHERE id=? AND NOT EXISTS(SELECT 1 FROM listings WHERE property_id=?)').run(row.property_id,row.property_id);
};

test('Apify ingestion detects a new listing and a price drop',async(t)=>{
  const originalToken=config.apifyToken,originalThreshold=config.priceDropAlertPercent;
  config.apifyToken='test-token'; config.priceDropAlertPercent=3;
  t.after(()=>{config.apifyToken=originalToken;config.priceDropAlertPercent=originalThreshold;removeListing('mock-price-drop-1')});
  const base={id:'mock-price-drop-1',city:'קריית אונו',neighborhood:'רימון',street:'בדיקה',rooms:4,area:100,floor:4};
  const first=await fetchYad2('sale',{fetchImpl:async()=>response([{...base,price:2500000}]),maxItems:1});
  const second=await fetchYad2('sale',{fetchImpl:async()=>response([{...base,price:2350000}]),maxItems:1});
  assert.equal(first.fetched,1); assert.equal(second.fetched,1);
  const alerts=listAlerts({limit:100}).filter((alert)=>alert.listing_id===first.listingIds[0]);
  assert.ok(alerts.some((alert)=>alert.type==='new_listing'));
  assert.ok(alerts.some((alert)=>alert.type==='price_drop'));
});

test('Komo server-rendered cards are parsed into normalized fields',()=>{
  const html=`<div class="View_Ad_Details modaa__box"><a href="/code/nadlan/details/?modaaNum=4920283"><h2 class="title">קריית אונו, קיראון, איריס 1</h2></a><div class="price">2,350,000&nbsp;&#8362;</div><div class="description">דירה&nbsp;4.0 חדרים (100 מ"ר)<br>קומה: 4 מתוך 5<div class="mFooterAction"></div></div></div>`;
  const [row]=parseKomoHtml(html,{city:'קריית אונו',listingType:'sale'});
  assert.equal(row.listingId,'4920283'); assert.equal(row.price,2350000); assert.equal(row.rooms,4);
  assert.equal(row.areaSqm,100); assert.equal(row.streetName,'איריס'); assert.equal(row.streetNumber,'1');
});

test('ad.co.il server-rendered cards are parsed and implausible prices are skipped',()=>{
  const card=(id,price)=>`<div class="card-block" data-id="${id}"><a href="/ad/${id}"><h2 class="card-title">קריית אונו רימון</h2></a><p class="card-text">המעגל 16</p><div class="price">${price} ₪</div><i class="fa-expand-arrows-alt"></i><span>103</span><i class="fa-bed"></i><span>4.5</span></div>`;
  const rows=parseAdHtml(card('8811','2,480,000')+card('8812','480'),{city:'קריית אונו',listingType:'sale'});
  assert.equal(rows.length,1);assert.equal(rows[0].listingId,'8811');assert.equal(rows[0].price,2480000);
  assert.equal(rows[0].rooms,4.5);assert.equal(rows[0].areaSqm,103);assert.equal(rows[0].streetName,'המעגל');assert.equal(rows[0].streetNumber,'16');
});

test('manual Marketplace inbox stores a listing and checks cross-source matches',(t)=>{
  const id=`991${Date.now()}`,result=ingestMarketplaceItem({url:`https://www.facebook.com/marketplace/item/${id}/`,listingType:'sale',city:'קריית אונו',neighborhood:'רימון',street:'המעגל',houseNumber:'16',price:2480000,rooms:4,areaSqm:103,notes:'בדיקת קליטה'});
  t.after(()=>removeListing(id));
  assert.equal(result.isNew,true);assert.ok(Array.isArray(result.matches));
  const saved=db.prepare(`SELECT m.notes,l.source FROM marketplace_inbox_items m JOIN listings l ON l.id=m.listing_id WHERE l.id=?`).get(result.listingId);
  assert.equal(saved.source,'facebook_marketplace_manual');assert.equal(saved.notes,'בדיקת קליטה');
});

test('scheduled scanner handles sale and rent runs',async(t)=>{
  const originalToken=config.apifyToken,originalSources=config.enabledSources; config.apifyToken='test-token'; config.enabledSources=new Set(['yad2']); t.after(()=>{config.apifyToken=originalToken;config.enabledSources=originalSources});
  const mockFetch=async(_url,options)=>{
    const input=JSON.parse(options.body),isRent=input.startUrls[0].url.includes('/rent/');
    return response([{id:isRent?'mock-scan-rent':'mock-scan-sale',city:'קריית אונו',neighborhood:'רימון',street:'סריקה',rooms:4,area:100,price:isRent?6800:2400000}]);
  };
  const result=await runScan({maxItems:1,fetchImpl:mockFetch,deliver:false});
  t.after(()=>{for(const id of ['mock-scan-sale','mock-scan-rent'])removeListing(id);db.prepare('DELETE FROM source_scan_runs WHERE scan_run_id=?').run(result.runId);db.prepare('DELETE FROM scan_runs WHERE id=?').run(result.runId)});
  assert.equal(result.status,'completed'); assert.equal(result.results.find((item)=>item.listingType==='sale').fetched,1); assert.equal(result.results.find((item)=>item.listingType==='rent').fetched,1);
});

test('Madlan and Homeless use their documented city and dealType inputs',async(t)=>{
  const originalToken=config.apifyToken; config.apifyToken='test-token'; t.after(()=>{config.apifyToken=originalToken});
  const bodies=[];
  const mockFetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return response([])};
  await fetchSource('madlan','sale',{fetchImpl:mockFetch,maxItems:12});
  await fetchSource('homeless','rent',{fetchImpl:mockFetch,maxItems:7});
  assert.equal(bodies[0].dealType,'buy'); assert.equal(bodies[0].maxItems,12);
  assert.equal(bodies[1].dealType,'rent'); assert.equal(bodies[1].enrichListings,true);
});

test('normalizers preserve each source and align exact addresses',()=>{
  const madlan=normalizeApifyListing({id:'m1',cityHebrew:'קריית אונו',streetName:'המעגל',streetNumber:'16',price:2480000,areaSqm:103,hasSecureRoom:true},'sale','madlan');
  const yad2=normalizeApifyListing({id:'y1',city:'קרית אונו',street:'המעגל',houseNumber:'16',price:2490000,area:103},'sale','yad2');
  assert.equal(madlan.listing.source,'madlan'); assert.equal(madlan.listing.mamad,1);
  assert.equal(madlan.property.canonicalKey,yad2.property.canonicalKey);
});
