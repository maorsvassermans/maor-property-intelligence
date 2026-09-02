import { config } from './config.js';
import { normalizeApifyListing } from './normalize.js';
import { upsertNormalizedWithChanges } from './repository.js';
import { evaluateListingChange } from './alerts.js';
import { getSource } from './sources.js';
import { fetchKomo } from './komo.js';
import { fetchAd } from './ad.js';

export async function fetchSource(sourceId, listingType, { monitorMode = false, maxItems = 50, fetchImpl = fetch } = {}) {
  const source = getSource(sourceId);
  if (!source || source.status !== 'ready') throw new Error(`Source ${sourceId} is not ready`);
  if(source.collector==='direct-ad')return fetchAd(listingType,{maxItems,fetchImpl});
  if(source.collector==='direct-html')return fetchKomo(listingType,{maxItems,fetchImpl});
  if (!config.apifyToken) throw new Error('APIFY_TOKEN is missing');
  if(!source.actor())throw new Error(`Source ${sourceId} has no Apify actor`);
  const endpoint = `https://api.apify.com/v2/acts/${encodeURIComponent(source.actor())}/run-sync-get-dataset-items?token=${encodeURIComponent(config.apifyToken)}`;
  const response = await fetchImpl(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(source.input(listingType, maxItems, monitorMode))
  });
  if (!response.ok) throw new Error(`Apify returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const rows = await response.json();
  const observedAt = new Date().toISOString();
  const changes=rows.map((row)=>upsertNormalizedWithChanges(normalizeApifyListing(row,listingType,sourceId),observedAt));
  const alertIds=changes.flatMap((change)=>evaluateListingChange(change));
  return { fetched:rows.length,saved:changes.length,listingIds:changes.map((item)=>item.id),alertsCreated:alertIds.length };
}

export function fetchYad2(listingType, options) {
  return fetchSource('yad2', listingType, options);
}
