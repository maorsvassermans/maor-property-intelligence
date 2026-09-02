import { db, json, parseJson } from './db.js';
import { scoreCrossSourceMatch } from './matching.js';

function refreshMatchCandidatesForListing(id){
  const current=getListing(id); if(!current)return;
  const others=db.prepare(`SELECT l.*,p.city,p.neighborhood,p.street,p.house_number FROM listings l JOIN properties p ON p.id=l.property_id
    WHERE l.id<>? AND l.active=1 AND l.source<>? AND l.listing_type=? AND p.city=?`).all(id,current.source,current.listing_type,current.city);
  for(const row of others){
    const candidate={...row,raw:parseJson(row.raw_json,{})},match=scoreCrossSourceMatch(current,candidate);
    const a=Math.min(id,row.id),b=Math.max(id,row.id);
    if(match.status==='rejected'){
      db.prepare('DELETE FROM listing_match_candidates WHERE listing_id_a=? AND listing_id_b=?').run(a,b); continue;
    }
    db.prepare(`INSERT INTO listing_match_candidates(listing_id_a,listing_id_b,score,status,evidence_json,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(listing_id_a,listing_id_b) DO UPDATE SET score=excluded.score,status=excluded.status,evidence_json=excluded.evidence_json,updated_at=excluded.updated_at`)
      .run(a,b,match.score,match.status,json(match.reasons),new Date().toISOString());
  }
}

export function upsertNormalized({ property, listing }, observedAt = new Date().toISOString()) {
  db.prepare(`INSERT INTO properties(canonical_key,city,neighborhood,street,house_number,latitude,longitude,address_confidence)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(canonical_key) DO UPDATE SET
    neighborhood=excluded.neighborhood, street=excluded.street, house_number=COALESCE(excluded.house_number,properties.house_number),
    latitude=COALESCE(excluded.latitude,properties.latitude), longitude=COALESCE(excluded.longitude,properties.longitude),
    address_confidence=MAX(excluded.address_confidence,properties.address_confidence), updated_at=CURRENT_TIMESTAMP`)
    .run(property.canonicalKey, property.city, property.neighborhood, property.street, property.houseNumber, property.latitude, property.longitude, property.addressConfidence);
  const propertyId = db.prepare('SELECT id FROM properties WHERE canonical_key=?').get(property.canonicalKey).id;
  db.prepare(`INSERT INTO listings(property_id,source,source_listing_id,listing_type,source_url,property_type,rooms,area_sqm,floor,total_floors,asking_price,seller_type,parking,elevator,balcony,mamad,storage,description,first_seen,last_seen,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_listing_id) DO UPDATE SET
    property_id=excluded.property_id,source_url=excluded.source_url,rooms=excluded.rooms,area_sqm=excluded.area_sqm,floor=excluded.floor,
    total_floors=excluded.total_floors,asking_price=excluded.asking_price,seller_type=excluded.seller_type,parking=excluded.parking,
    elevator=excluded.elevator,balcony=excluded.balcony,mamad=excluded.mamad,storage=excluded.storage,description=excluded.description,
    last_seen=excluded.last_seen,active=1,raw_json=excluded.raw_json`)
    .run(propertyId,listing.source,listing.sourceId,listing.listingType,listing.sourceUrl,listing.propertyType,listing.rooms,listing.areaSqm,listing.floor,listing.totalFloors,listing.askingPrice,listing.sellerType,listing.parking,listing.elevator,listing.balcony,listing.mamad,listing.storage,listing.description,observedAt,observedAt,json(listing.raw));
  const saved = db.prepare('SELECT id,asking_price FROM listings WHERE source=? AND source_listing_id=?').get(listing.source, listing.sourceId);
  db.prepare('INSERT OR IGNORE INTO listing_price_history(listing_id,observed_at,price) VALUES(?,?,?)').run(saved.id, observedAt, saved.asking_price);
  return saved.id;
}

export function upsertNormalizedWithChanges(normalized, observedAt = new Date().toISOString()) {
  const { source, sourceId, askingPrice }=normalized.listing;
  const existing=db.prepare('SELECT id,asking_price FROM listings WHERE source=? AND source_listing_id=?').get(source,sourceId);
  const id=upsertNormalized(normalized,observedAt);
  refreshMatchCandidatesForListing(id);
  return {id,isNew:!existing,previousPrice:existing?.asking_price??null,currentPrice:askingPrice,listingType:normalized.listing.listingType};
}

export function getListing(id) {
  const row = db.prepare(`SELECT l.*,p.city,p.neighborhood,p.street,p.house_number,p.address_confidence,p.latitude,p.longitude,p.block,p.parcel,
    (SELECT COUNT(DISTINCT l2.source) FROM listings l2 WHERE l2.property_id=l.property_id AND l2.active=1) AS source_count,
    (SELECT GROUP_CONCAT(DISTINCT l2.source) FROM listings l2 WHERE l2.property_id=l.property_id AND l2.active=1) AS source_names
    FROM listings l JOIN properties p ON p.id=l.property_id WHERE l.id=?`).get(id);
  if (!row) return null;
  return { ...row, raw: parseJson(row.raw_json), raw_json: undefined };
}

const sourcePriority={yad2:1,madlan:2,komo:3,homeless:4,facebook_marketplace_manual:5,ad:6,'public-comparable':7};

export function deduplicateListings(rows){
  if(rows.length<2)return rows;
  const byId=new Map(rows.map((row)=>[row.id,row])),parent=new Map(rows.map((row)=>[row.id,row.id]));
  const find=(id)=>{let root=id;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next}return root};
  const unite=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra)};
  const firstByProperty=new Map();
  for(const row of rows){
    if(firstByProperty.has(row.property_id))unite(row.id,firstByProperty.get(row.property_id));
    else firstByProperty.set(row.property_id,row.id);
  }
  const ids=[...byId.keys()],placeholders=ids.map(()=>'?').join(',');
  if(ids.length){
    const confirmed=db.prepare(`SELECT listing_id_a,listing_id_b FROM listing_match_candidates WHERE status='confirmed'
      AND listing_id_a IN (${placeholders}) AND listing_id_b IN (${placeholders})`).all(...ids,...ids);
    for(const pair of confirmed)unite(pair.listing_id_a,pair.listing_id_b);
  }
  const groups=new Map();
  for(const row of rows){const root=find(row.id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(row)}
  return [...groups.values()].map((group)=>{
    group.sort((a,b)=>(sourcePriority[a.source]??99)-(sourcePriority[b.source]??99)||String(b.last_seen).localeCompare(String(a.last_seen)));
    const representative=group[0],sources=[...new Set(group.map((item)=>item.source))];
    return {...representative,source_count:sources.length,source_names:sources.join(','),duplicate_listing_ids:group.map((item)=>item.id)};
  });
}

export function listListings(type, limit = 100, source = null, {deduplicate=false}={}) {
  const rows = type
    ? db.prepare(`SELECT l.id,l.property_id,l.source,l.source_url,l.listing_type,l.asking_price,l.rooms,l.area_sqm,l.floor,l.first_seen,l.last_seen,p.city,p.neighborhood,p.street,p.house_number,p.address_confidence,p.latitude,p.longitude,
      (SELECT COUNT(DISTINCT l2.source) FROM listings l2 WHERE l2.property_id=l.property_id AND l2.active=1) AS source_count,
      (SELECT GROUP_CONCAT(DISTINCT l2.source) FROM listings l2 WHERE l2.property_id=l.property_id AND l2.active=1) AS source_names
      FROM listings l JOIN properties p ON p.id=l.property_id WHERE l.listing_type=? AND l.active=1 AND (? IS NULL OR l.source=?) ORDER BY l.last_seen DESC LIMIT ?`).all(type,source,source,limit)
    : db.prepare(`SELECT l.id,l.property_id,l.source,l.source_url,l.listing_type,l.asking_price,l.rooms,l.area_sqm,l.floor,l.first_seen,l.last_seen,p.city,p.neighborhood,p.street,p.house_number,p.address_confidence,p.latitude,p.longitude,
      (SELECT COUNT(DISTINCT l2.source) FROM listings l2 WHERE l2.property_id=l.property_id AND l2.active=1) AS source_count,
      (SELECT GROUP_CONCAT(DISTINCT l2.source) FROM listings l2 WHERE l2.property_id=l.property_id AND l2.active=1) AS source_names
      FROM listings l JOIN properties p ON p.id=l.property_id WHERE l.active=1 AND (? IS NULL OR l.source=?) ORDER BY l.last_seen DESC LIMIT ?`).all(source,source,limit);
  return deduplicate ? deduplicateListings(rows) : rows;
}

export function getSourceCoverage() {
  return db.prepare(`SELECT source,COUNT(*) AS listings,
    SUM(CASE WHEN listing_type='sale' THEN 1 ELSE 0 END) AS sales,
    SUM(CASE WHEN listing_type='rent' THEN 1 ELSE 0 END) AS rentals,
    MAX(last_seen) AS last_seen FROM listings WHERE active=1 GROUP BY source ORDER BY listings DESC`).all();
}

export function getCrossSourceCandidates(id, limit = 10) {
  return db.prepare(`SELECT l.id,l.source,l.source_url,l.asking_price,l.rooms,l.area_sqm,p.city,p.neighborhood,p.street,p.house_number,
    m.score AS match_score,m.status,m.evidence_json
    FROM listing_match_candidates m
    JOIN listings l ON l.id=CASE WHEN m.listing_id_a=? THEN m.listing_id_b ELSE m.listing_id_a END
    JOIN properties p ON p.id=l.property_id
    WHERE (m.listing_id_a=? OR m.listing_id_b=?) AND l.active=1
    ORDER BY m.score DESC,m.updated_at DESC LIMIT ?`).all(id,id,id,limit)
    .map((item)=>({...item,evidence:parseJson(item.evidence_json,[]),evidence_json:undefined}));
}

export function getListingChartData(id) {
  const listing=getListing(id);
  if(!listing) return null;
  const priceHistory=db.prepare('SELECT observed_at,price FROM listing_price_history WHERE listing_id=? ORDER BY observed_at').all(id);
  const rentalComps=db.prepare(`SELECT l.id,l.asking_price,l.rooms,l.area_sqm,l.floor,p.street,p.house_number,p.neighborhood
    FROM listings l JOIN properties p ON p.id=l.property_id
    WHERE l.listing_type='rent' AND l.active=1 AND p.city=?
      AND (? IS NULL OR p.neighborhood=? OR p.neighborhood IS NULL)
      AND (? IS NULL OR l.rooms BETWEEN ? AND ?)
    ORDER BY ABS(COALESCE(l.rooms,?) - ?) ASC, l.asking_price ASC LIMIT 8`)
    .all(listing.city,listing.neighborhood,listing.neighborhood,listing.rooms,listing.rooms==null?null:listing.rooms-.5,listing.rooms==null?null:listing.rooms+.5,listing.rooms,listing.rooms);
  return {listing,priceHistory,rentalComps,transactionComps:getTransactionComps(listing)};
}

export function getTransactionComps(listingOrId,limit=12){
  const listing=typeof listingOrId==='number'?getListing(listingOrId):listingOrId;if(!listing)return [];
  return db.prepare(`SELECT t.id,t.transaction_date,t.price,t.area_sqm,t.rooms,t.floor,t.build_year,t.source,t.source_url,
    p.city,p.neighborhood,p.street,p.house_number,
    CASE WHEN t.area_sqm>0 THEN ROUND(t.price/t.area_sqm) ELSE NULL END AS price_per_sqm
    FROM transactions t JOIN properties p ON p.id=t.property_id
    WHERE p.city=? AND t.transaction_date>=date('now','-5 years')
      AND (? IS NULL OR t.rooms IS NULL OR t.rooms BETWEEN ? AND ?)
      AND (? IS NULL OR t.area_sqm IS NULL OR t.area_sqm BETWEEN ? AND ?)
    ORDER BY (CASE WHEN p.street=? THEN 0 WHEN p.neighborhood=? THEN 1 ELSE 2 END),t.transaction_date DESC LIMIT ?`)
    .all(listing.city,listing.rooms,listing.rooms==null?null:listing.rooms-1,listing.rooms==null?null:listing.rooms+1,
      listing.area_sqm,listing.area_sqm==null?null:listing.area_sqm*.75,listing.area_sqm==null?null:listing.area_sqm*1.25,
      listing.street,listing.neighborhood,limit);
}

const quantile=(values,q)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const position=(sorted.length-1)*q,base=Math.floor(position),rest=position-base;return sorted[base+1]!==undefined?sorted[base]+rest*(sorted[base+1]-sorted[base]):sorted[base]};

export function getEvidenceAssumptions(listing){
  const transactions=getTransactionComps(listing),pricePerSqm=transactions.map((item)=>Number(item.price_per_sqm)).filter(Number.isFinite);
  const rents=db.prepare(`SELECT l.asking_price FROM listings l JOIN properties p ON p.id=l.property_id WHERE l.listing_type='rent' AND l.active=1 AND p.city=?
    AND (? IS NULL OR l.rooms IS NULL OR l.rooms BETWEEN ? AND ?) ORDER BY l.asking_price`).all(listing.city,listing.rooms,listing.rooms==null?null:listing.rooms-.5,listing.rooms==null?null:listing.rooms+.5).map((row)=>row.asking_price);
  const estimatedRent=quantile(rents,.5),area=Number(listing.area_sqm),lowPsm=quantile(pricePerSqm,.25),midPsm=quantile(pricePerSqm,.5),highPsm=quantile(pricePerSqm,.75);
  const history=db.prepare('SELECT price,observed_at FROM listing_price_history WHERE listing_id=? ORDER BY observed_at').all(listing.id);
  const firstPrice=history[0]?.price??listing.asking_price,currentPrice=listing.asking_price;
  const firstSeenMs=Date.parse(listing.first_seen||listing.last_seen),sellerDaysOnline=Number.isFinite(firstSeenMs)?Math.max(0,Math.floor((Date.now()-firstSeenMs)/86400000)):0;
  const overrides={priceReduction:Math.max(0,firstPrice-currentPrice),sellerDaysOnline};
  if(estimatedRent)overrides.estimatedMonthlyRent=Math.round(estimatedRent);
  if(area&&midPsm){overrides.fairValueLow=Math.round((lowPsm||midPsm)*area/10000)*10000;overrides.fairValueHigh=Math.round((highPsm||midPsm)*area/10000)*10000}
  return {overrides,evidence:{transactionCount:transactions.length,rentalCompCount:rents.length,valuationMethod:pricePerSqm.length?'tax-transactions-price-per-sqm':'default-assumptions',transactions}};
}
