import { db } from './db.js';

const knownCities=['קריית אונו','גני תקווה','אור יהודה','יהוד-מונוסון','יהוד מונוסון'];
const clean=(value)=>String(value??'').trim().replace(/[\s"׳״'_-]+/g,'').toLowerCase().replace(/^קריתאונו$/,'קרייתאונו').replace(/^יהודמונוסון$/,'יהודמונוסון');
const numberOrNull=(value)=>{const number=Number(value);return Number.isFinite(number)?number:null};
const quantile=(values,q)=>{const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const position=(sorted.length-1)*q,base=Math.floor(position),rest=position-base;return sorted[base+1]===undefined?sorted[base]:sorted[base]+rest*(sorted[base+1]-sorted[base])};
const weightedQuantile=(items,q)=>{
  const sorted=items.filter((item)=>Number.isFinite(item.value)&&item.weight>0).sort((a,b)=>a.value-b.value);
  const total=sorted.reduce((sum,item)=>sum+item.weight,0);if(!total)return null;
  const target=total*q;let cumulative=0;
  for(const item of sorted){cumulative+=item.weight;if(cumulative>=target)return item.value}
  return sorted.at(-1)?.value??null;
};
const distanceMeters=(a,b)=>{
  if(!Number.isFinite(a.latitude)||!Number.isFinite(a.longitude)||!Number.isFinite(b.latitude)||!Number.isFinite(b.longitude))return null;
  const radians=(degrees)=>degrees*Math.PI/180,R=6371000,dLat=radians(b.latitude-a.latitude),dLon=radians(b.longitude-a.longitude);
  const x=Math.sin(dLat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
};

export function parseAddressInput(address){
  let remaining=String(address||'').trim().replace(/\s*,\s*/g,' '),city=null;
  for(const candidate of [...knownCities].sort((a,b)=>b.length-a.length)){
    const index=remaining.indexOf(candidate);
    if(index>=0){city=candidate==='יהוד מונוסון'?'יהוד-מונוסון':candidate;remaining=`${remaining.slice(0,index)} ${remaining.slice(index+candidate.length)}`.trim();break}
  }
  remaining=remaining.replace(/\s+/g,' ').trim();
  const houseMatch=remaining.match(/(?:^|\s)(\d+[א-תA-Za-z]?)$/),houseNumber=houseMatch?.[1]||null;
  const street=houseNumber?remaining.slice(0,houseMatch.index).trim():remaining;
  return {city,street,houseNumber};
}

function resolveTarget({address,city,street,houseNumber,neighborhood,rooms,areaSqm,floor}){
  const parsed=address?parseAddressInput(address):{};
  const query={
    city:String(city||parsed.city||'').trim(),street:String(street||parsed.street||'').trim(),
    houseNumber:String(houseNumber||parsed.houseNumber||'').trim()||null,neighborhood:String(neighborhood||'').trim()||null,
    rooms:numberOrNull(rooms),areaSqm:numberOrNull(areaSqm),floor:numberOrNull(floor)
  };
  if(!query.city||!query.street)throw new Error('כתובת חייבת לכלול עיר ורחוב');
  const properties=db.prepare(`SELECT * FROM properties WHERE city=?`).all(query.city);
  const exact=properties.find((property)=>clean(property.street)===clean(query.street)&&query.houseNumber&&clean(property.house_number)===clean(query.houseNumber));
  const streetProperty=properties.find((property)=>clean(property.street)===clean(query.street));
  const property=exact||streetProperty||null;
  if(property){
    query.neighborhood=query.neighborhood||property.neighborhood||null;
    query.latitude=numberOrNull(property.latitude);query.longitude=numberOrNull(property.longitude);query.propertyId=property.id;
    const listing=db.prepare(`SELECT id,asking_price,rooms,area_sqm,floor,listing_type,source,source_url FROM listings WHERE property_id=? AND active=1 ORDER BY CASE WHEN listing_type='sale' THEN 0 ELSE 1 END,last_seen DESC LIMIT 1`).get(property.id);
    if(listing){query.listingId=listing.id;query.askingPrice=listing.asking_price;query.rooms=query.rooms??numberOrNull(listing.rooms);query.areaSqm=query.areaSqm??numberOrNull(listing.area_sqm);query.floor=query.floor??numberOrNull(listing.floor);query.source=listing.source;query.sourceUrl=listing.source_url}
  }
  return query;
}

function comparableScope(target,candidate){
  const sameStreet=clean(target.street)===clean(candidate.street),sameHouse=target.houseNumber&&sameStreet&&clean(target.houseNumber)===clean(candidate.house_number);
  if(sameHouse)return {scope:'building',scopeLabel:'אותו בניין',base:45};
  if(sameStreet)return {scope:'street',scopeLabel:'אותו רחוב',base:35};
  if(target.neighborhood&&candidate.neighborhood&&clean(target.neighborhood)===clean(candidate.neighborhood))return {scope:'neighborhood',scopeLabel:'אותה שכונה',base:25};
  const distance=distanceMeters(target,candidate);
  if(distance!=null&&distance<=1000)return {scope:'nearby',scopeLabel:`${Math.round(distance)} מטר`,base:20,distance};
  return null;
}

function scoreComparable(target,candidate,scope){
  let score=scope.base;const reasons=[scope.scopeLabel];
  const ageYears=Math.max(0,(Date.now()-Date.parse(candidate.transaction_date))/31557600000);
  if(ageYears<=1){score+=15;reasons.push('עסקה מהשנה האחרונה')}else if(ageYears<=2){score+=11;reasons.push('עסקה עד שנתיים')}else if(ageYears<=3){score+=6}
  if(target.rooms!=null&&candidate.rooms!=null){const difference=Math.abs(target.rooms-candidate.rooms);if(difference===0){score+=15;reasons.push('אותו מספר חדרים')}else if(difference<=.5){score+=10}else if(difference<=1){score+=4}}
  if(target.areaSqm&&candidate.area_sqm){const difference=Math.abs(target.areaSqm-candidate.area_sqm)/target.areaSqm;if(difference<=.1){score+=20;reasons.push('שטח דומה מאוד')}else if(difference<=.2){score+=12;reasons.push('שטח דומה')}else if(difference<=.3){score+=5}}
  if(target.floor!=null&&candidate.floor!=null){const difference=Math.abs(target.floor-candidate.floor);if(difference<=1){score+=5;reasons.push('קומה דומה')}else if(difference<=3){score+=3}}
  return {score:Math.min(100,score),reasons};
}

export function analyzeAddress(input,{limit=12}={}){
  const query=resolveTarget(input),rows=db.prepare(`SELECT t.id,t.source,t.source_transaction_id,t.transaction_date,t.price,t.area_sqm,t.rooms,t.floor,t.build_year,t.source_url,p.city,p.neighborhood,p.street,p.house_number,p.latitude,p.longitude FROM transactions t JOIN properties p ON p.id=t.property_id WHERE p.city=? AND t.transaction_date>=date('now','-5 years') AND t.price>0 AND t.area_sqm>0`).all(query.city);
  const allScoped=rows.map((row)=>{const scope=comparableScope(query,row);if(!scope)return null;const scored=scoreComparable(query,row,scope);return {...row,scope:scope.scope,scope_label:scope.scopeLabel,distance_m:scope.distance??null,match_score:scored.score,match_reasons:scored.reasons,price_per_sqm:Math.round(row.price/row.area_sqm)}}).filter(Boolean);
  const comparables=allScoped.sort((a,b)=>b.match_score-a.match_score||String(b.transaction_date).localeCompare(String(a.transaction_date))).slice(0,limit);
  const weighted=comparables.map((item)=>({value:item.price_per_sqm,weight:Math.max(1,item.match_score)}));
  const lowPsm=weightedQuantile(weighted,.25),medianPsm=weightedQuantile(weighted,.5),highPsm=weightedQuantile(weighted,.75);
  const scopeCounts={building:0,street:0,neighborhood:0,nearby:0};for(const item of allScoped)scopeCounts[item.scope]+=1;
  const strongest=comparables[0]?.scope||null,localCount=scopeCounts.building+scopeCounts.street,confidence=!comparables.length?'none':comparables.length>=3&&localCount?'high':comparables.length>=3?'medium':'low';
  const valuation=query.areaSqm&&medianPsm?{
    low:Math.round(lowPsm*query.areaSqm/10000)*10000,midpoint:Math.round(medianPsm*query.areaSqm/10000)*10000,high:Math.round(highPsm*query.areaSqm/10000)*10000,
    lowPricePerSqm:lowPsm,medianPricePerSqm:medianPsm,highPricePerSqm:highPsm,
    askingVsMidpointPct:query.askingPrice?+((query.askingPrice/(medianPsm*query.areaSqm)-1)*100).toFixed(2):null
  }:null;
  return {
    query:{address:[query.street,query.houseNumber,query.city].filter(Boolean).join(' '),city:query.city,street:query.street,houseNumber:query.houseNumber,neighborhood:query.neighborhood,rooms:query.rooms,areaSqm:query.areaSqm,floor:query.floor},
    matchedListing:query.listingId?{id:query.listingId,source:query.source,askingPrice:query.askingPrice,sourceUrl:query.sourceUrl}:null,
    evidence:{confidence,strongestScope:strongest,selectedComparables:comparables.length,availableInCity:rows.length,scopeCounts,cityFallbackUsed:false},
    valuation,comparables,
    message:comparables.length?'הערכת השווי מבוססת רק על עסקאות מאותו בניין, רחוב, שכונה או עד קילומטר מהכתובת.':'לא נמצאו עסקאות מקומיות מתאימות. עסקאות עירוניות לא הוכנסו לחישוב.'
  };
}

export function suggestAddresses({q='',city='',limit=12}={}){
  const query=clean(q),rows=db.prepare(`SELECT p.city,p.neighborhood,p.street,p.house_number,COUNT(DISTINCT t.id) AS transactions,COUNT(DISTINCT l.id) AS listings FROM properties p LEFT JOIN transactions t ON t.property_id=p.id LEFT JOIN listings l ON l.property_id=p.id AND l.active=1 WHERE (?='' OR p.city=?) AND p.street IS NOT NULL GROUP BY p.id ORDER BY transactions DESC,listings DESC,p.street,p.house_number LIMIT 300`).all(city,city);
  return rows.filter((row)=>!query||clean([row.street,row.house_number,row.city].filter(Boolean).join(' ')).includes(query)).slice(0,limit).map((row)=>({...row,address:[row.street,row.house_number,row.city].filter(Boolean).join(' ')}));
}
