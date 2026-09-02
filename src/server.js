import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, json } from './db.js';
import { fetchSource } from './apify.js';
import { ingestMarketplaceItem, listMarketplaceInbox } from './marketplace.js';
import { analyzeListing } from './analytics.js';
import { getListing, getListingChartData, listListings, getSourceCoverage, getCrossSourceCandidates, getEvidenceAssumptions } from './repository.js';
import { listAlerts, markAlertRead } from './alerts.js';
import { runScan } from './scanner.js';
import { listSources, getSource } from './sources.js';
import { parseMarketplaceOcrText } from './ocr.js';
import { importTaxTransactions, addGovMapEvidence, govMapLink } from './evidence.js';

const send = (res, status, body) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body, null, 2)); };
const readBody = async (req, maxBytes=3_000_000) => { const chunks=[];let size=0;for await (const c of req){size+=c.length;if(size>maxBytes)throw new Error('request_body_too_large');chunks.push(c)}return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; };
const publicDir = path.resolve(new URL('../public', import.meta.url).pathname);
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
};
const analyzeWithEvidence=(listing,overrides={})=>{const evidence=getEvidenceAssumptions(listing);return {...analyzeListing(listing,{...evidence.overrides,...overrides}),evidence:evidence.evidence};};

export function createServer() { return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && staticFiles[url.pathname]) {
      const [fileName, contentType] = staticFiles[url.pathname];
      res.writeHead(200, {'content-type': contentType, 'cache-control':'no-store'});
      return res.end(fs.readFileSync(path.join(publicDir, fileName)));
    }
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status:'ok', service:'maor-property-intelligence' });
    if (req.method === 'GET' && url.pathname === '/api/v1/listings') return send(res, 200, { data:listListings(url.searchParams.get('type'), Number(url.searchParams.get('limit') || 100),url.searchParams.get('source')) });
    if (req.method === 'GET' && url.pathname === '/api/v1/sources') return send(res,200,{data:{sources:listSources(),coverage:getSourceCoverage()}});
    if(req.method==='GET'&&url.pathname==='/api/v1/marketplace-inbox')return send(res,200,{data:listMarketplaceInbox(Number(url.searchParams.get('limit')||50))});
    if(req.method==='POST'&&url.pathname==='/api/v1/marketplace-inbox'){
      try{return send(res,201,{data:ingestMarketplaceItem(await readBody(req))})}
      catch(error){return send(res,400,{error:'invalid_marketplace_item',message:error.message})}
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/marketplace-ocr/parse'){
      const body=await readBody(req);return send(res,200,{data:parseMarketplaceOcrText(body.text)});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/transactions/import'){
      if(config.scanApiKey&&req.headers['x-scan-api-key']!==config.scanApiKey)return send(res,401,{error:'unauthorized'});
      try{const body=await readBody(req);return send(res,201,{data:importTaxTransactions(body.transactions,{source:body.source||'tax-authority-import'})})}
      catch(error){return send(res,400,{error:'invalid_transactions',message:error.message})}
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/govmap/evidence'){
      if(config.scanApiKey&&req.headers['x-scan-api-key']!==config.scanApiKey)return send(res,401,{error:'unauthorized'});
      try{return send(res,201,{data:addGovMapEvidence(await readBody(req))})}
      catch(error){return send(res,400,{error:'invalid_govmap_evidence',message:error.message})}
    }
    const govMapLinkMatch=url.pathname.match(/^\/api\/v1\/listings\/(\d+)\/govmap-link$/);
    if(req.method==='GET'&&govMapLinkMatch){const listing=getListing(Number(govMapLinkMatch[1]));return listing?send(res,200,{data:{url:govMapLink(listing)}}):send(res,404,{error:'listing_not_found'})}
    if(req.method==='GET'&&url.pathname==='/api/v1/alerts')return send(res,200,{data:listAlerts({unreadOnly:url.searchParams.get('unread')==='true',limit:Number(url.searchParams.get('limit')||100)})});
    const alertReadMatch=url.pathname.match(/^\/api\/v1\/alerts\/(\d+)\/read$/);
    if(req.method==='POST'&&alertReadMatch)return markAlertRead(Number(alertReadMatch[1]))?send(res,200,{status:'read'}):send(res,404,{error:'alert_not_found'});
    if(req.method==='POST'&&url.pathname==='/api/v1/jobs/scan'){
      if(config.scanApiKey&&req.headers['x-scan-api-key']!==config.scanApiKey)return send(res,401,{error:'unauthorized'});
      const body=await readBody(req);
      return send(res,201,{data:await runScan({maxItems:Number(body.maxItems||200),deliver:body.deliver!==false})});
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/dashboard') {
      const allListings=listListings(null,500,null,{deduplicate:true});
      const sales=allListings.filter((item)=>item.listing_type==='sale').map((listing)=>({ ...listing, analysis:analyzeWithEvidence(listing) }));
      const rents=allListings.filter((item)=>item.listing_type==='rent');
      const priceDrops=sales.filter((item)=>item.analysis.assumptions.priceReduction>0).length;
      const averageDealScore=sales.length ? Math.round(sales.reduce((sum,item)=>sum+item.analysis.scores.deal,0)/sales.length) : 0;
      const sources=listSources(),coverage=getSourceCoverage();
      return send(res,200,{data:{summary:{properties:allListings.length,sales:sales.length,rentals:rents.length,priceDrops,averageDealScore,activeSources:sources.filter((item)=>item.enabled).length},sources,coverage,listings:sales}});
    }
    const analysisMatch = url.pathname.match(/^\/api\/v1\/listings\/(\d+)\/analysis$/);
    const chartsMatch = url.pathname.match(/^\/api\/v1\/listings\/(\d+)\/charts$/);
    const candidatesMatch = url.pathname.match(/^\/api\/v1\/listings\/(\d+)\/cross-source-candidates$/);
    if(req.method==='GET'&&candidatesMatch)return send(res,200,{data:getCrossSourceCandidates(Number(candidatesMatch[1]))});
    if(req.method==='GET'&&chartsMatch){
      const chartData=getListingChartData(Number(chartsMatch[1]));
      if(!chartData)return send(res,404,{error:'listing_not_found'});
      const analysis=analyzeWithEvidence(chartData.listing);
      return send(res,200,{data:{priceHistory:chartData.priceHistory,rentalComps:chartData.rentalComps,transactionComps:chartData.transactionComps,yields:[{label:'ברוטו',value:analysis.grossYieldPct},{label:'נטו',value:analysis.netYieldPct}]}});
    }
    if (req.method === 'GET' && analysisMatch) {
      const listing = getListing(Number(analysisMatch[1]));
      if (!listing) return send(res,404,{error:'listing_not_found'});
      return send(res,200,{ data:analyzeWithEvidence(listing) });
    }
    if (req.method === 'POST' && analysisMatch) {
      const listing=getListing(Number(analysisMatch[1])); if(!listing) return send(res,404,{error:'listing_not_found'});
      const assumptions=await readBody(req); const result=analyzeWithEvidence(listing,assumptions); const calculatedAt=new Date().toISOString();
      db.prepare('INSERT INTO analyses(listing_id,calculated_at,assumptions_json,result_json) VALUES(?,?,?,?)').run(listing.id,calculatedAt,json(assumptions),json(result));
      return send(res,201,{data:result});
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/ingest/apify') {
      const body=await readBody(req),type=body.type==='rent'?'rent':'sale',source=String(body.source||'yad2');
      if(!getSource(source)||getSource(source).status!=='ready')return send(res,400,{error:'source_not_ready'});
      return send(res,201,{data:await fetchSource(source,type,{monitorMode:Boolean(body.monitorMode),maxItems:Number(body.maxItems||50)})});
    }
    send(res,404,{error:'not_found'});
  } catch (error) { send(res,500,{error:'internal_error',message:error.message}); }
}); }

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createServer().listen(config.port,()=>console.log(`MAOR Property Intelligence listening on http://localhost:${config.port}`));
}
