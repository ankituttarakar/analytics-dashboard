import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { neon } from '@neondatabase/serverless'

const localSnapshotAvailable = process.env.NODE_ENV !== 'production' && existsSync(resolve('data/dashboard.json.gz'))
if (!process.env.DATABASE_URL && !localSnapshotAvailable) {
  throw new Error('DATABASE_URL is missing. Copy .env.example to .env and add your Neon connection string.')
}

export const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

export async function initDb() {
  if (!sql) throw new Error('DATABASE_URL is required to initialize Neon.')
  await sql`CREATE TABLE IF NOT EXISTS dashboard_meta (
    id smallint PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now()
  )`
  await sql`CREATE TABLE IF NOT EXISTS line_cube (
    day date NOT NULL, outlet text NOT NULL, category text NOT NULL, item text NOT NULL,
    order_type text NOT NULL, settlement text NOT NULL, revenue numeric NOT NULL,
    quantity bigint NOT NULL, line_items bigint NOT NULL,
    PRIMARY KEY (day, outlet, category, item, order_type, settlement)
  )`
  await sql`CREATE TABLE IF NOT EXISTS order_cube (
    day date NOT NULL, outlet text NOT NULL, order_type text NOT NULL, settlement text NOT NULL,
    group_mask numeric(20,0) NOT NULL, item_mask numeric(20,0) NOT NULL, orders bigint NOT NULL,
    revenue numeric NOT NULL, quantity bigint NOT NULL, line_items bigint NOT NULL,
    PRIMARY KEY (day, outlet, order_type, settlement, group_mask, item_mask)
  )`
  await sql`CREATE INDEX IF NOT EXISTS line_cube_day_idx ON line_cube(day)`
  await sql`CREATE INDEX IF NOT EXISTS line_cube_outlet_idx ON line_cube(outlet, day)`
  await sql`CREATE INDEX IF NOT EXISTS line_cube_category_idx ON line_cube(category, item, day)`
  await sql`CREATE INDEX IF NOT EXISTS order_cube_day_idx ON order_cube(day)`
}
