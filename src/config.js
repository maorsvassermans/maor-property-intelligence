import path from 'node:path';
import './load-env.js';

export const config = {
  port: Number(process.env.PORT || 3000),
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/maor-property.db'),
  apifyToken: process.env.APIFY_TOKEN || '',
  apifyActor: process.env.APIFY_ACTOR || 'crawloop~yad2-scraper',
  madlanActor: process.env.MADLAN_APIFY_ACTOR || 'swerve~madlan-scraper',
  homelessActor: process.env.HOMELESS_APIFY_ACTOR || 'swerve~homeless-scraper',
  scanCities: process.env.SCAN_CITIES || 'קריית אונו,גני תקווה,אור יהודה,יהוד מונוסון',
  enabledSources: new Set((process.env.ENABLED_SOURCES || 'yad2,madlan,homeless,komo,ad').split(',').map((value) => value.trim()).filter(Boolean)),
  komoUserAgent: process.env.KOMO_USER_AGENT || 'MAOR-Property-Intelligence/0.2 (+property-research)',
  adUserAgent: process.env.AD_USER_AGENT || 'MAOR-Property-Intelligence/0.2 (+property-research)',
  dealScoreAlertThreshold: Number(process.env.DEAL_SCORE_ALERT_THRESHOLD || 85),
  priceDropAlertPercent: Number(process.env.PRICE_DROP_ALERT_PERCENT || 3),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  scanApiKey: process.env.SCAN_API_KEY || '',
  scanMaxItemsPerSource: Number(process.env.SCAN_MAX_ITEMS_PER_SOURCE || 50),
  saleUrl: process.env.YAD2_SALE_URL || 'https://www.yad2.co.il/realestate/forsale/center-and-sharon?area=10&city=2620&maxRooms=4&minRooms=4&property=1',
  rentUrl: process.env.YAD2_RENT_URL || 'https://www.yad2.co.il/realestate/rent/center-and-sharon?area=10&city=2620&maxRooms=4.5&minRooms=4&property=1'
};
