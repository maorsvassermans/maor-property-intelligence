PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  neighborhood TEXT,
  street TEXT,
  house_number TEXT,
  latitude REAL,
  longitude REAL,
  block TEXT,
  parcel TEXT,
  address_confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  listing_type TEXT NOT NULL CHECK(listing_type IN ('sale','rent')),
  source_url TEXT,
  property_type TEXT,
  rooms REAL,
  area_sqm REAL,
  floor INTEGER,
  total_floors INTEGER,
  asking_price INTEGER NOT NULL,
  seller_type TEXT,
  parking INTEGER,
  elevator INTEGER,
  balcony INTEGER,
  mamad INTEGER,
  storage INTEGER,
  description TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  raw_json TEXT,
  UNIQUE(source, source_listing_id)
);

CREATE TABLE IF NOT EXISTS listing_price_history (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  observed_at TEXT NOT NULL,
  price INTEGER NOT NULL,
  UNIQUE(listing_id, observed_at, price)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id),
  source TEXT NOT NULL,
  source_transaction_id TEXT,
  transaction_date TEXT NOT NULL,
  price INTEGER NOT NULL,
  area_sqm REAL,
  rooms REAL,
  floor INTEGER,
  build_year INTEGER,
  distance_m REAL,
  source_url TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  calculated_at TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('new_listing','price_drop','high_score')),
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','high')),
  dedupe_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  sale_items INTEGER NOT NULL DEFAULT 0,
  rent_items INTEGER NOT NULL DEFAULT 0,
  alerts_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS source_scan_runs (
  id INTEGER PRIMARY KEY,
  scan_run_id INTEGER NOT NULL REFERENCES scan_runs(id),
  source TEXT NOT NULL,
  listing_type TEXT NOT NULL CHECK(listing_type IN ('sale','rent')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  items INTEGER NOT NULL DEFAULT 0,
  alerts_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS listing_match_candidates (
  id INTEGER PRIMARY KEY,
  listing_id_a INTEGER NOT NULL REFERENCES listings(id),
  listing_id_b INTEGER NOT NULL REFERENCES listings(id),
  score INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('possible','probable','confirmed')),
  evidence_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(listing_id_a < listing_id_b),
  UNIQUE(listing_id_a,listing_id_b)
);

CREATE TABLE IF NOT EXISTS marketplace_inbox_items (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id),
  marketplace_url TEXT,
  screenshot_data_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS property_geo_evidence (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  source TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  block TEXT,
  parcel TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  source_url TEXT,
  observed_at TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE(property_id,source,observed_at)
);

CREATE INDEX IF NOT EXISTS idx_listings_type_active ON listings(listing_type, active);
CREATE INDEX IF NOT EXISTS idx_listings_property ON listings(property_id);
CREATE INDEX IF NOT EXISTS idx_transactions_property_date ON transactions(property_id, transaction_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_source_unique ON transactions(source,source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_geo_evidence_property ON property_geo_evidence(property_id,observed_at);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(read_at,created_at);
CREATE INDEX IF NOT EXISTS idx_source_scan_runs_source ON source_scan_runs(source,started_at);
CREATE INDEX IF NOT EXISTS idx_listing_match_candidates_score ON listing_match_candidates(score,status);
