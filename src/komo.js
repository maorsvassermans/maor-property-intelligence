import { config } from './config.js';
import { normalizeApifyListing } from './normalize.js';
import { upsertNormalizedWithChanges } from './repository.js';
import { evaluateListingChange } from './alerts.js';

const decodeHtml=(value)=>String(value||'')
  .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)))
  .replace(/&nbsp;|&#160;/gi,' ').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text=(value)=>decodeHtml(String(value||'').replace(/<br\s*\/?>/gi,' | ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const numeric=(value)=>Number(String(value||'').replace(/[^0-9.]/g,''))||null;

export function parseKomoHtml(html, {city, listingType}) {
  const linkPattern=/<a[^>]+href=["'][^"']*\/code\/nadlan\/details\/?\?modaaNum=(\d+)[^"']*["'][^>]*>/gi;
  const links=[...String(html).matchAll(linkPattern)],rows=[],seen=new Set();
  for(let index=0;index<links.length;index++){
    const sourceId=links[index][1]; if(seen.has(sourceId))continue; seen.add(sourceId);
    const chunk=String(html).slice(links[index].index,links[index+1]?.index??links[index].index+7000);
    const title=text(chunk.match(/<h2[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
    const price=numeric(text(chunk.match(/<div[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]));
    const description=text(chunk.match(/<div[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)(?:<div[^>]*class=["'][^"']*mFooterAction|<span[^>]*id=["']modaaComment|<\/div>)/i)?.[1]);
    if(!title||!price)continue;
    const parts=title.split(',').map((part)=>part.trim()),neighbourhood=parts[1]&&!/לא צוין/.test(parts[1])?parts[1]:null;
    const address=parts.slice(2).join(', ').trim(),addressMatch=!/לא צוין/.test(address)&&address.match(/^(.*?)\s+(\d+[א-ת]?)$/);
    const street=addressMatch?.[1]||(!address||/לא צוין/.test(address)?null:address),streetNumber=addressMatch?.[2]||null;
    const floorMatch=description.match(/קומה:\s*([^|]+?)(?:\s+מתוך\s+([0-9.]+)|\s*\||$)/i);
    rows.push({
      listingId:sourceId,url:`https://www.komo.co.il/code/nadlan/details/?modaaNum=${sourceId}`,
      cityHebrew:city,neighbourhood,streetName:street,streetNumber,price,
      rooms:numeric(description.match(/([0-9.]+)\s*חדרים?/i)?.[1]),
      areaSqm:numeric(description.match(/\(([0-9.]+)\s*מ["״']?ר\)/i)?.[1]),
      floor:numeric(floorMatch?.[1]),totalFloors:numeric(floorMatch?.[2]),
      propertyType:text(description.split(/\d+(?:\.\d+)?\s*חדרים?/)[0])||'דירה',
      dealType:listingType==='rent'?'rent':'buy',scrapedAt:new Date().toISOString()
    });
  }
  return rows;
}

export async function fetchKomo(listingType,{maxItems=50,fetchImpl=fetch}={}){
  const cities=config.scanCities.split(',').map((city)=>city.trim()).filter(Boolean),rows=[];
  for(const city of cities){
    if(rows.length>=maxItems)break;
    const page=listingType==='rent'?'apartments-for-rent.asp':'apartments-for-sale.asp';
    const url=`https://www.komo.co.il/code/nadlan/${page}?nehes=1&cityName=${encodeURIComponent(city)}`;
    const response=await fetchImpl(url,{headers:{'user-agent':config.komoUserAgent,'accept-language':'he-IL,he;q=0.9'}});
    if(!response.ok)throw new Error(`Komo returned ${response.status}`);
    rows.push(...parseKomoHtml(await response.text(),{city,listingType}).slice(0,maxItems-rows.length));
  }
  const observedAt=new Date().toISOString();
  const changes=rows.map((row)=>upsertNormalizedWithChanges(normalizeApifyListing(row,listingType,'komo'),observedAt));
  const alertIds=changes.flatMap((change)=>evaluateListingChange(change));
  return {fetched:rows.length,saved:changes.length,listingIds:changes.map((item)=>item.id),alertsCreated:alertIds.length};
}
