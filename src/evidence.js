import crypto from 'node:crypto';
import { db, json } from './db.js';

const requiredNumber=(value,name)=>{const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error(`${name} must be a positive number`);return n};
const clean=(value)=>String(value??'').trim().replace(/[\s"׳״'-]+/g,'').toLowerCase().replace(/^קריתאונו$/,'קרייתאונו');
const canonicalKey=(row)=>`address|${[clean(row.city),clean(row.street),clean(row.houseNumber)].join('|')}`;

function ensureProperty(row){
  const city=String(row.city||'').trim(),street=String(row.street||'').trim();if(!city||!street)throw new Error('city and street are required');
  const key=canonicalKey(row),confidence=row.houseNumber?0.9:0.55;
  db.prepare(`INSERT INTO properties(canonical_key,city,neighborhood,street,house_number,block,parcel,address_confidence) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(canonical_key) DO UPDATE SET neighborhood=COALESCE(excluded.neighborhood,properties.neighborhood),house_number=COALESCE(excluded.house_number,properties.house_number),block=COALESCE(excluded.block,properties.block),parcel=COALESCE(excluded.parcel,properties.parcel),address_confidence=MAX(properties.address_confidence,excluded.address_confidence)`)
    .run(key,city,row.neighborhood||null,street,row.houseNumber||null,row.block||null,row.parcel||null,confidence);
  return db.prepare('SELECT id FROM properties WHERE canonical_key=?').get(key).id;
}

export function importTaxTransactions(rows,{source='tax-authority-import'}={}){
  if(!Array.isArray(rows)||!rows.length)throw new Error('transactions array is required');
  const imported=[];
  const insert=db.prepare(`INSERT INTO transactions(property_id,source,source_transaction_id,transaction_date,price,area_sqm,rooms,floor,build_year,distance_m,source_url,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_transaction_id) DO UPDATE SET transaction_date=excluded.transaction_date,price=excluded.price,area_sqm=excluded.area_sqm,rooms=excluded.rooms,floor=excluded.floor,raw_json=excluded.raw_json`);
  db.exec('BEGIN');
  try{
    for(const row of rows){
      const propertyId=ensureProperty(row),date=String(row.transactionDate||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('transactionDate must be YYYY-MM-DD');
      const price=Math.round(requiredNumber(row.price,'price')),sourceId=String(row.sourceTransactionId||crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex'));
      insert.run(propertyId,source,sourceId,date,price,row.areaSqm||null,row.rooms||null,row.floor??null,row.buildYear||null,row.distanceM||null,row.sourceUrl||'https://www.nadlan.gov.il/',json(row));
      imported.push(sourceId);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  return {imported:imported.length,source,sourceTransactionIds:imported};
}

export function addGovMapEvidence({listingId,latitude,longitude,block,parcel,confidence=0.8,sourceUrl='https://www.govmap.gov.il/'},observedAt=new Date().toISOString()){
  const listing=db.prepare('SELECT property_id FROM listings WHERE id=?').get(Number(listingId));if(!listing)throw new Error('listing not found');
  const lat=latitude==null?null:Number(latitude),lon=longitude==null?null:Number(longitude),conf=Math.max(0,Math.min(1,Number(confidence)));
  if(lat==null&&lon==null&&!block&&!parcel)throw new Error('coordinates or block/parcel are required');
  if(lat!=null&&(!Number.isFinite(lat)||lat<29||lat>34))throw new Error('latitude is outside Israel');
  if(lon!=null&&(!Number.isFinite(lon)||lon<34||lon>36))throw new Error('longitude is outside Israel');
  db.prepare(`INSERT INTO property_geo_evidence(property_id,source,latitude,longitude,block,parcel,confidence,source_url,observed_at,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(listing.property_id,'govmap',lat,lon,block||null,parcel||null,conf,sourceUrl,observedAt,json({listingId,latitude,longitude,block,parcel}));
  db.prepare(`UPDATE properties SET latitude=COALESCE(?,latitude),longitude=COALESCE(?,longitude),block=COALESCE(?,block),parcel=COALESCE(?,parcel),address_confidence=MAX(address_confidence,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(lat,lon,block||null,parcel||null,conf,listing.property_id);
  return {listingId:Number(listingId),propertyId:listing.property_id,latitude:lat,longitude:lon,block:block||null,parcel:parcel||null,confidence:conf};
}

export function govMapLink(listing){
  const query=[listing.city,listing.street,listing.house_number].filter(Boolean).join(' ');
  return `https://www.govmap.gov.il/?q=${encodeURIComponent(query)}`;
}
