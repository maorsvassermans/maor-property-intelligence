const norm=(value)=>String(value||'').trim().toLowerCase().replace(/[\s"׳״'.,-]+/g,'');
const close=(a,b,tolerance)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=tolerance;
const relativeClose=(a,b,tolerance)=>Number(a)>0&&Number(b)>0&&Math.abs(Number(a)-Number(b))/Math.max(Number(a),Number(b))<=tolerance;
const rawValues=(row,keys)=>keys.map((key)=>row.raw?.[key]).filter(Boolean).map(norm);

export function scoreCrossSourceMatch(a,b){
  if(a.source===b.source||a.listing_type!==b.listing_type||norm(a.city)!==norm(b.city))return {score:0,status:'rejected',reasons:[]};
  let score=20; const reasons=['אותה עיר'];
  const sameStreet=a.street&&b.street&&norm(a.street)===norm(b.street);
  const sameHouse=a.house_number&&b.house_number&&norm(a.house_number)===norm(b.house_number);
  const conflictingHouse=a.house_number&&b.house_number&&!sameHouse;
  if(conflictingHouse)return {score:0,status:'rejected',reasons:['מספרי בית שונים']};
  if(sameStreet){score+=25;reasons.push('אותו רחוב')}
  if(sameHouse){score+=20;reasons.push('אותו מספר בית')}
  if(a.neighborhood&&b.neighborhood&&norm(a.neighborhood)===norm(b.neighborhood)){score+=10;reasons.push('אותה שכונה')}
  if(close(a.rooms,b.rooms,.5)){score+=12;reasons.push('מספר חדרים תואם')}
  if(relativeClose(a.area_sqm,b.area_sqm,.1)){score+=15;reasons.push('שטח בטווח 10%')}
  if(close(a.floor,b.floor,0)){score+=5;reasons.push('אותה קומה')}
  if(relativeClose(a.asking_price,b.asking_price,a.listing_type==='rent'?.12:.08)){score+=5;reasons.push('מחיר דומה')}
  const phonesA=rawValues(a,['contactPhone','phone','sellerPhone']),phonesB=rawValues(b,['contactPhone','phone','sellerPhone']);
  const samePhone=phonesA.some((value)=>phonesB.includes(value));
  if(samePhone){score+=25;reasons.push('אותו מספר קשר')}
  const imagesA=rawValues(a,['coverImage','mainImage']),imagesB=rawValues(b,['coverImage','mainImage']);
  const sameImage=imagesA.some((value)=>imagesB.includes(value));
  if(sameImage){score+=20;reasons.push('אותה תמונה ראשית')}
  score=Math.min(score,100);
  if(!sameHouse&&!samePhone&&!sameImage)score=Math.min(score,89);
  return {score,status:score>=90?'confirmed':score>=75?'probable':score>=60?'possible':'rejected',reasons};
}
