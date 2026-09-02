import { db } from './db.js';
import { upsertNormalized } from './repository.js';

const observedAt = '2026-09-01T12:00:00.000Z';
const baseProperty = { city: 'קריית אונו', neighborhood: 'רימון', street: 'המעגל', houseNumber: null, latitude: 32.0486091, longitude: 34.8650959, addressConfidence: 0.55 };
const rows = [
  { id:'yad2-hamaagal-2480', type:'sale', price:2480000, rooms:4, area:103, floor:6, description:'ירידת מחיר של 160,000 ₪; מספר הבית אינו מוצג במקור הציבורי' },
  { id:'rent-hamaagal-6500-a', type:'rent', price:6500, rooms:4, area:null, floor:3 },
  { id:'rent-hamaagal-7000', type:'rent', price:7000, rooms:4.5, area:105, floor:8 },
  { id:'rent-hamaagal-6500-b', type:'rent', price:6500, rooms:4.5, area:110, floor:1 }
];
for (const row of rows) {
  const listingId=upsertNormalized({ property:{...baseProperty, canonicalKey:`seed|${row.id}`}, listing:{source:row.id.startsWith('yad2')?'yad2':'public-comparable',sourceId:row.id,listingType:row.type,sourceUrl:null,propertyType:'apartment',rooms:row.rooms,areaSqm:row.area,floor:row.floor,totalFloors:null,askingPrice:row.price,sellerType:null,parking:null,elevator:null,balcony:null,mamad:null,storage:null,description:row.description||null,raw:{seed:true}}}, observedAt);
  if(row.id==='yad2-hamaagal-2480') db.prepare('INSERT OR IGNORE INTO listing_price_history(listing_id,observed_at,price) VALUES(?,?,?)').run(listingId,'2026-08-01T12:00:00.000Z',2640000);
}
console.log(`Seeded ${rows.length} listings into ${db.prepare('PRAGMA database_list').all()[0].file}`);
