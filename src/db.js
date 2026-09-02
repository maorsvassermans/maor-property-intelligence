import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = new DatabaseSync(config.databasePath);
db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

export function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export function parseJson(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); }
  catch { return fallback; }
}
