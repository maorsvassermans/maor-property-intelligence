import { config } from './config.js';
import { normalizeApifyListing } from './normalize.js';
import { upsertNormalizedWithChanges } from './repository.js';
import { evaluateListingChange } from './alerts.js';

const cityRoutes={
  'קריית אונו':{sale:'sp3=235',rent:'sp275=17559&sp276=17560'},
  'גני תקווה':{sale:'sp3=190',rent:'sp275=17559&sp276=17765'},
  'אור יהודה':{sale:'sp3=65',rent:'sp275=17559&sp276=17710'},
  'יהוד מונוסון':{sale:'sp3=222',rent:'sp275=17559&sp276=17750'}
};
const decode=(value)=>String(value||'').replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"');
const text=(value)=>decode(String(value||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const numeric=(value)=>{const cleaned=String(value??'').replace(/[^0-9.]/g,'');return cleaned?Number(cleaned):null};

export function parseAdHtml(html,{city,listingType}){
  const blocks=String(html).split(/<div class="card-block"/).slice(1),rows=[];
  for(const block of blocks){
    const sourceId=block.match(/data-id="(\d+)"/)?.[1];
    const sourceUrlId=block.match(/href="\/ad\/(\d+)"/)?.[1];
    if(!sourceId||sourceUrlId!==sourceId)continue;
    const card=block;
    const heading=text(card.match(/<h2[^>]*class="[^"]*card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
    const address=text(card.match(/<p[^>]*class="[^"]*card-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const price=numeric(text(card.match(/<div[^>]*class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]));
    if(!price||!address)continue;
    const image=card.match(/<img[^>]+src="([^"]+)"/i)?.[1]||null;
    const area=numeric(card.match(/fa-expand-arrows-alt[\s\S]{0,300}?<span[^>]*>([0-9.]+)/i)?.[1]);
    const rooms=numeric(card.match(/fa-bed[\s\S]{0,300}?<span[^>]*>([0-9.]+)/i)?.[1]);
    const neighborhood=heading.replace(/^קרי[ית]+ אונו\s*/,'').replace(new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*`),'').trim()||null;
    const match=address.match(/^(.*?)\s+(\d+[א-ת]?)$/),streetName=match?.[1]||address,streetNumber=match?.[2]||null;
    const validPrice=listingType==='rent'?price>=2000&&price<=30000:price>=500000&&price<=30000000;
    if(!validPrice||(area!=null&&(area<20||area>500))||(rooms!=null&&(rooms<1||rooms>10)))continue;
    rows.push({listingId:sourceId,url:`https://www.ad.co.il/ad/${sourceId}`,cityHebrew:city,neighbourhood:neighborhood,
      streetName,streetNumber,price,rooms,areaSqm:area,coverImage:image?.startsWith('//')?`https:${image}`:image,
      dealType:listingType==='rent'?'rent':'buy',propertyType:'דירה',aggregator:true,scrapedAt:new Date().toISOString()});
  }
  return rows;
}

export async function fetchAd(listingType,{maxItems=50,fetchImpl=fetch}={}){
  const configured=config.scanCities.split(',').map((value)=>value.trim()).filter((city)=>cityRoutes[city]);
  const perCity=Math.max(1,Math.ceil(maxItems/Math.max(configured.length,1))),rows=[];
  for(const city of configured){
    const section=listingType==='rent'?'nadlanrent':'nadlansale',query=cityRoutes[city][listingType];
    const response=await fetchImpl(`https://www.ad.co.il/${section}?${query}`,{headers:{'user-agent':config.adUserAgent,'accept-language':'he-IL,he;q=0.9'}});
    if(!response.ok)throw new Error(`ad.co.il returned ${response.status}`);
    rows.push(...parseAdHtml(await response.text(),{city,listingType}).slice(0,perCity));
  }
  const selected=rows.slice(0,maxItems),observedAt=new Date().toISOString();
  const changes=selected.map((row)=>upsertNormalizedWithChanges(normalizeApifyListing(row,listingType,'ad'),observedAt));
  const alertIds=changes.flatMap((change)=>evaluateListingChange(change));
  return {fetched:selected.length,saved:changes.length,listingIds:changes.map((item)=>item.id),alertsCreated:alertIds.length};
}
