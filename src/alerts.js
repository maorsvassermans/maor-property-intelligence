import { config } from './config.js';
import { db, json, parseJson } from './db.js';
import { analyzeListing } from './analytics.js';
import { getListing } from './repository.js';

function createAlert({type,listingId,title,message,severity,dedupeKey,metadata={}}){
  const result=db.prepare(`INSERT OR IGNORE INTO alerts(type,listing_id,title,message,severity,dedupe_key,metadata_json)
    VALUES(?,?,?,?,?,?,?)`).run(type,listingId,title,message,severity,dedupeKey,json(metadata));
  return result.changes?Number(result.lastInsertRowid):null;
}

export function evaluateListingChange(change){
  const listing=getListing(change.id); if(!listing)return [];
  const ids=[];
  if(change.isNew){
    const id=createAlert({type:'new_listing',listingId:change.id,title:'נכס חדש',message:`${listing.street||listing.city}: ${Number(listing.asking_price).toLocaleString('he-IL')} ₪`,severity:'info',dedupeKey:`new:${change.id}`,metadata:{price:listing.asking_price}});
    if(id)ids.push(id);
  }
  if(change.previousPrice&&change.currentPrice<change.previousPrice){
    const reduction=change.previousPrice-change.currentPrice,pct=reduction/change.previousPrice*100;
    if(pct>=config.priceDropAlertPercent){
      const id=createAlert({type:'price_drop',listingId:change.id,title:'ירידת מחיר',message:`המחיר ירד ב-${reduction.toLocaleString('he-IL')} ₪ (${pct.toFixed(1)}%)`,severity:'warning',dedupeKey:`drop:${change.id}:${change.currentPrice}`,metadata:{previousPrice:change.previousPrice,currentPrice:change.currentPrice,reduction,percent:pct}});
      if(id)ids.push(id);
    }
  }
  if(change.listingType==='sale'){
    const score=analyzeListing(listing).scores.deal;
    if(score>=config.dealScoreAlertThreshold){
      const id=createAlert({type:'high_score',listingId:change.id,title:'Deal Score גבוה',message:`הנכס קיבל ציון ${score}/100`,severity:'high',dedupeKey:`score:${change.id}:${score}:${change.currentPrice}`,metadata:{score,threshold:config.dealScoreAlertThreshold}});
      if(id)ids.push(id);
    }
  }
  return ids;
}

export function listAlerts({unreadOnly=false,limit=100}={}){
  const rows=unreadOnly
    ? db.prepare(`SELECT a.*,p.city,p.neighborhood,p.street,p.house_number FROM alerts a JOIN listings l ON l.id=a.listing_id JOIN properties p ON p.id=l.property_id WHERE a.read_at IS NULL ORDER BY a.created_at DESC LIMIT ?`).all(limit)
    : db.prepare(`SELECT a.*,p.city,p.neighborhood,p.street,p.house_number FROM alerts a JOIN listings l ON l.id=a.listing_id JOIN properties p ON p.id=l.property_id ORDER BY a.created_at DESC LIMIT ?`).all(limit);
  return rows.map((row)=>({...row,metadata:parseJson(row.metadata_json,{}),metadata_json:undefined}));
}

export function markAlertRead(id){return db.prepare('UPDATE alerts SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=?').run(id).changes>0}

export async function deliverPendingAlerts(fetchImpl=fetch){
  const alerts=listAlerts({unreadOnly:true,limit:100});
  if(!config.alertWebhookUrl||!alerts.length)return {delivered:0,skipped:alerts.length,reason:config.alertWebhookUrl?'no_alerts':'webhook_not_configured'};
  const response=await fetchImpl(config.alertWebhookUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'maor-property-intelligence',createdAt:new Date().toISOString(),alerts})});
  if(!response.ok)throw new Error(`Alert webhook returned ${response.status}`);
  for(const alert of alerts)markAlertRead(alert.id);
  return {delivered:alerts.length,skipped:0};
}
