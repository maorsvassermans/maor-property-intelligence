const number=(value)=>{const cleaned=String(value||'').replace(/[,\s]/g,'').replace(/[^0-9.]/g,'');return cleaned?Number(cleaned):null};

export function parseMarketplaceOcrText(rawText){
  const text=String(rawText||'').replace(/\r/g,'\n').replace(/[|]/g,' ').replace(/[ \t]+/g,' ').trim();
  const cities=['קריית אונו','קרית אונו','גני תקווה','אור יהודה','יהוד מונוסון','יהוד-מונוסון'];
  const foundCity=cities.find((city)=>text.includes(city));
  const normalizedCity=foundCity==='קרית אונו'?'קריית אונו':foundCity==='יהוד-מונוסון'?'יהוד מונוסון':foundCity||null;
  const priceMatches=[...text.matchAll(/(?:₪|ש[״"]?ח)?\s*([0-9][0-9,\.]{3,})\s*(?:₪|ש[״"]?ח)?/g)].map((match)=>number(match[1])).filter((value)=>value>=2000&&value<=30000000);
  const askingPrice=priceMatches.sort((a,b)=>b-a)[0]||null;
  const rooms=number(text.match(/([1-9](?:[\.,]5)?)\s*(?:חדרים|חד[׳']?)/)?.[1]?.replace(',','.'));
  const areaSqm=number(text.match(/([0-9]{2,3}(?:[\.,][0-9])?)\s*(?:מ[״"]?ר|מטר)/)?.[1]?.replace(',','.'));
  const floor=number(text.match(/קומה\s*([0-9]{1,2}|קרקע)/)?.[1]?.replace('קרקע','0'));
  const addressLine=text.split('\n').map((line)=>line.trim()).find((line)=>/(?:רחוב\s+)?[א-ת][א-ת "׳'-]{2,}\s+\d{1,3}[א-ת]?/.test(line));
  const address=addressLine?.match(/(?:רחוב\s+)?([א-ת][א-ת "׳'-]{2,}?)\s+(\d{1,3}[א-ת]?)(?:\s|$)/);
  return {text,city:normalizedCity,price:askingPrice,rooms,areaSqm,floor,street:address?.[1]?.trim()||null,houseNumber:address?.[2]||null,
    confidence:{city:normalizedCity?.length?0.9:0,price:askingPrice?0.75:0,rooms:rooms?0.8:0,areaSqm:areaSqm?0.8:0,address:address?0.6:0}};
}
