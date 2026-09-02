import { config } from './config.js';

const sourceDefinitions = {
  yad2: {
    id: 'yad2', label: 'יד2', status: 'ready', reliability: 0.86, collector: 'apify',
    actor: () => config.apifyActor,
    input: (listingType, maxItems, monitorMode) => ({
      startUrls: [{ url: listingType === 'sale' ? config.saleUrl : config.rentUrl }],
      maxItems, includeDetails: true, monitorMode, maxConcurrency: 2,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'IL' }
    })
  },
  madlan: {
    id: 'madlan', label: 'מדלן', status: 'ready', reliability: 0.9, collector: 'apify',
    actor: () => config.madlanActor,
    input: (listingType, maxItems) => ({
      city: config.scanCities, dealType: listingType === 'rent' ? 'rent' : 'buy',
      maxItems, enrichInsights: false
    })
  },
  homeless: {
    id: 'homeless', label: 'הומלס', status: 'ready', reliability: 0.72, collector: 'apify',
    actor: () => config.homelessActor,
    input: (listingType, maxItems) => ({
      city: config.scanCities, dealType: listingType === 'rent' ? 'rent' : 'buy',
      maxItems, enrichListings: true
    })
  },
  komo: { id: 'komo', label: 'Komo', status: 'ready', reliability: 0.68, collector: 'direct-html', actor: () => null },
  ad: { id: 'ad', label: 'ad.co.il', status: 'ready', reliability: 0.65, collector: 'direct-ad', aggregator: true, actor: () => null },
  facebook_marketplace_manual: { id: 'facebook_marketplace_manual', label: 'Facebook Marketplace', status: 'manual', reliability: 0.55, collector: 'manual-inbox', actor: () => null },
  tax_authority: { id: 'tax_authority', label: 'רשות המסים', status: 'manual', reliability: 0.96, collector: 'evidence-import', actor: () => null },
  govmap: { id: 'govmap', label: 'GovMap', status: 'manual', reliability: 0.95, collector: 'geo-evidence', actor: () => null },
  onmap: { id: 'onmap', label: 'OnMap', status: 'planned', reliability: null, collector: null, actor: () => null }
};

export function getSource(id) {
  return sourceDefinitions[id] || null;
}

export function listSources() {
  return Object.values(sourceDefinitions).map((source) => ({
    id: source.id, label: source.label, status: source.status,
    enabled: source.status === 'ready' && config.enabledSources.has(source.id),
    reliability: source.reliability, collector: source.collector, aggregator:Boolean(source.aggregator), actor: source.actor()
  }));
}

export function enabledSources() {
  return listSources().filter((source) => source.enabled).map((source) => sourceDefinitions[source.id]);
}
