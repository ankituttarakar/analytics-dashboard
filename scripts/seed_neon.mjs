import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { sql, initDb } from '../server/db.mjs'

const source = resolve(process.argv[2] || 'data/dashboard.json.gz')
const packed = JSON.parse(gunzipSync(await readFile(source)).toString('utf8'))
const { meta } = packed

await initDb()
await sql`INSERT INTO dashboard_meta (id, payload, loaded_at) VALUES (1, ${JSON.stringify(meta)}::jsonb, now())
  ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, loaded_at = now()`

const insertBatches = async (rows, kind) => {
  const batchSize = 500
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    if (kind === 'lines') {
      await sql`INSERT INTO line_cube (day, outlet, category, item, order_type, settlement, revenue, quantity, line_items)
        SELECT r.day::date, r.outlet, r.category, r.item, r.order_type, r.settlement, r.revenue, r.quantity, r.line_items
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(day text, outlet text, category text, item text, order_type text, settlement text, revenue numeric, quantity bigint, line_items bigint)
        ON CONFLICT DO NOTHING`
    } else {
      await sql`INSERT INTO order_cube (day, outlet, order_type, settlement, group_mask, item_mask, orders, revenue, quantity, line_items)
        SELECT r.day::date, r.outlet, r.order_type, r.settlement, r.group_mask::numeric, r.item_mask::numeric, r.orders, r.revenue, r.quantity, r.line_items
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(day text, outlet text, order_type text, settlement text, group_mask text, item_mask text, orders bigint, revenue numeric, quantity bigint, line_items bigint)
        ON CONFLICT DO NOTHING`
    }
    const done = Math.min(offset + batch.length, rows.length)
    if (done === rows.length || done % 10_000 < batchSize) console.info(`${kind}: ${done.toLocaleString('en-IN')} / ${rows.length.toLocaleString('en-IN')}`)
  }
}

const dim = (values) => values
const days = packed.days
const outlets = dim(meta.outlets)
const groups = dim(meta.groups)
const items = dim(meta.items)
const types = dim(meta.orderTypes)
const settlements = dim(meta.settlements)
const lines = packed.lines.map(([d, o, g, i, t, s, revenue, quantity, lineItems]) => ({ day: days[d], outlet: outlets[o], category: groups[g], item: items[i], order_type: types[t], settlement: settlements[s], revenue, quantity, line_items: lineItems }))
const orders = packed.orders.map(([d, o, t, s, groupMask, itemMask, count, revenue, quantity, lineItems]) => ({ day: days[d], outlet: outlets[o], order_type: types[t], settlement: settlements[s], group_mask: String(groupMask), item_mask: String(itemMask), orders: count, revenue, quantity, line_items: lineItems }))

console.info(`Importing aggregate cubes from ${source}; no BillNo/order identifiers are included.`)
await insertBatches(lines, 'lines')
await insertBatches(orders, 'orders')
console.info(`Neon seed complete: ${lines.length.toLocaleString('en-IN')} line aggregates and ${orders.length.toLocaleString('en-IN')} order aggregates.`)
