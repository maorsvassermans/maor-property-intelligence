import crypto from 'node:crypto';

const pathValue = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);
const pick = (row, keys) => keys.map((key) => pathValue(row, key)).find((value) => value !== undefined && value !== null && value !== '');
const number = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const bool = (value) => {
  if (value == null) return null;
  if (typeof value === 'string' && ['false','0','no','לא'].includes(value.trim().toLowerCase())) return 0;
  return Number(Boolean(value));
};
const normalizeCityName = (value) => String(value || 'לא ידוע')
  .replace(/^Kiryat Ono$/i,'קריית אונו').replace(/^Ganei Tikva$/i,'גני תקווה')
  .replace(/^Or Yehuda$/i,'אור יהודה').replace(/^Yehud Monosson$/i,'יהוד מונוסון')
  .replace(/^קרית אונו$/,'קריית אונו');

const clean = (value) => String(value ?? '').trim().replace(/[\s"׳״'-]+/g, '').toLowerCase();

export function normalizeApifyListing(row, listingType, source = 'yad2') {
  const sourceId = String(pick(row, ['id', 'itemId', 'token', 'listingId', 'sourceId']) || crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex'));
  const city = normalizeCityName(pick(row, ['cityHebrew', 'city', 'cityText', 'location.city']));
  const neighborhood = pick(row, ['neighbourhood', 'neighborhood', 'neighborhoodText', 'location.neighborhood']);
  const street = pick(row, ['street', 'streetName', 'address']);
  const houseNumber = pick(row, ['streetNumber', 'houseNumber', 'house_number', 'number']);
  const latitude = number(pick(row, ['latitude', 'lat', 'coordinates.lat']));
  const longitude = number(pick(row, ['longitude', 'lon', 'lng', 'coordinates.lon', 'coordinates.lng']));
  const addressKey = houseNumber && street ? `address|${clean(city)}|${clean(street)}|${clean(houseNumber)}` : null;
  const geoKey = Number.isFinite(latitude) && Number.isFinite(longitude) ? `geo|${latitude.toFixed(5)}|${longitude.toFixed(5)}` : null;
  const canonicalKey = addressKey || geoKey || `unmatched|${source}|${sourceId}`;
  return {
    property: {
      canonicalKey, city, neighborhood: neighborhood || null, street: street || null,
      houseNumber: houseNumber ? String(houseNumber) : null, latitude, longitude,
      addressConfidence: houseNumber ? 0.9 : street ? 0.55 : 0.25
    },
    listing: {
      source, sourceId, listingType,
      sourceUrl: pick(row, ['url', 'link', 'itemUrl']) || null,
      propertyType: pick(row, ['propertyType', 'type', 'property_type']) || null,
      rooms: number(pick(row, ['rooms', 'roomCount'])),
      areaSqm: number(pick(row, ['areaSqm', 'area', 'squareMeter', 'squareMeters', 'sqm', 'size'])),
      floor: number(pick(row, ['floor', 'floorNumber'])),
      totalFloors: number(pick(row, ['totalFloors', 'floors'])),
      askingPrice: Math.round(number(pick(row, ['price', 'askingPrice', 'priceValue'])) || 0),
      sellerType: pick(row, ['sellerType', 'merchantType', 'contactType']) || (row.hasAgent === true ? 'agency' : row.hasAgent === false ? 'private' : row.isPrivate === true ? 'private' : row.isPrivate === false ? 'agency' : null),
      parking: bool(pick(row, ['parking', 'hasParking'])), elevator: bool(pick(row, ['elevator', 'hasElevator'])),
      balcony: bool(pick(row, ['balcony', 'hasBalcony'])), mamad: bool(pick(row, ['mamad', 'hasMamad', 'hasSecureRoom', 'secureRoom'])),
      storage: bool(pick(row, ['storage', 'hasStorage'])), description: pick(row, ['description', 'text']) || null,
      raw: row
    }
  };
}
