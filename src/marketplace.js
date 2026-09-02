import crypto from 'node:crypto';
import { db } from './db.js';
import { normalizeApifyListing } from './normalize.js';
import { upsertNormalizedWithChanges, getCrossSourceCandidates } from './repository.js';
import { evaluateListingChange } from './alerts.js';

const requiredNumber=(value,name)=>{const number=Number(value);if(!Number.isFinite(number)||number<=0)throw new Error(`${name} must be a positive number`);return number};
const marketplaceUrl=(value)=>{
  if(!value)return null;
  const parsed=new URL(value);
  if(!(parsed.hostname==='facebook.com'||parsed.hostname.endsWith('.facebook.com'))||!parsed.pathname.includes('/marketplace/'))throw new Error('Only Facebook Marketplace URLs are accepted');
  return parsed.toString();
};

export function ingestMarketplaceItem(input,observedAt=new Date().toISOString()){
  const url=marketplaceUrl(input.url),listingType=input.listingType==='rent'?'rent':'sale';
  const city=String(input.city||'').trim(); if(!city)throw new Error('city is required');
  const askingPrice=Math.round(requiredNumber(input.price,'price'));
  const itemId=url?.match(/\/item\/(\d+)/)?.[1]||crypto.createHash('sha1').update(JSON.stringify({url,city,street:input.street,houseNumber:input.houseNumber,askingPrice,rooms:input.rooms,areaSqm:input.areaSqm})).digest('hex');
  const screenshot=String(input.screenshotDataUrl||'');
  if(screenshot&&!/^data:image\/(?:png|jpeg|webp);base64,/.test(screenshot))throw new Error('screenshot must be PNG, JPEG or WebP');
  if(screenshot.length>2_800_000)throw new Error('screenshot is too large');
  const row={listingId:itemId,url,cityHebrew:city,neighbourhood:input.neighborhood||null,streetName:input.street||null,streetNumber:input.houseNumber||null,
    price:askingPrice,rooms:input.rooms||null,areaSqm:input.areaSqm||null,floor:input.floor||null,propertyType:input.propertyType||'דירה',
    description:input.description||null,contactPhone:input.contactPhone||null,manualEntry:true};
  const change=upsertNormalizedWithChanges(normalizeApifyListing(row,listingType,'facebook_marketplace_manual'),observedAt);
  const alertIds=evaluateListingChange(change);
  db.prepare(`INSERT INTO marketplace_inbox_items(listing_id,marketplace_url,screenshot_data_url,notes,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(listing_id) DO UPDATE SET marketplace_url=excluded.marketplace_url,screenshot_data_url=COALESCE(excluded.screenshot_data_url,marketplace_inbox_items.screenshot_data_url),notes=excluded.notes,updated_at=excluded.updated_at`)
    .run(change.id,url,screenshot||null,input.notes||null,observedAt,observedAt);
  return {listingId:change.id,isNew:change.isNew,alertsCreated:alertIds.length,matches:getCrossSourceCandidates(change.id)};
}

export function listMarketplaceInbox(limit=50){
  return db.prepare(`SELECT m.id,m.marketplace_url,m.notes,m.created_at,m.updated_at,l.id AS listing_id,l.listing_type,l.asking_price,l.rooms,l.area_sqm,
    p.city,p.neighborhood,p.street,p.house_number,
    CASE WHEN m.screenshot_data_url IS NULL THEN 0 ELSE 1 END AS has_screenshot
    FROM marketplace_inbox_items m JOIN listings l ON l.id=m.listing_id JOIN properties p ON p.id=l.property_id
    ORDER BY m.updated_at DESC LIMIT ?`).all(limit);
}
