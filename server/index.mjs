import 'dotenv/config'
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { sql, initDb } from './db.mjs'
import { authenticate, bootstrapAdmin, clearSessionCookie, createSession, getSession, hashPassword, sessionCookie } from './security.mjs'

const port = Number(process.env.PORT || 3001)
const maxBodyBytes = 64 * 1024
const rateLimits = new Map()
let dashboardCache
const insightCache = new Map()
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.gz': 'application/gzip', '.woff2': 'font/woff2' }

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

function secureHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
}

function rateLimit(request, response, bucket, max = 12, windowMs = 60_000) {
  const key = `${bucket}:${request.socket.remoteAddress || 'unknown'}`
  const now = Date.now()
  const current = rateLimits.get(key)
  if (!current || current.resetAt <= now) rateLimits.set(key, { count: 1, resetAt: now + windowMs })
  else current.count += 1
  const state = rateLimits.get(key)
  if (state.count <= max) return false
  sendJson(response, 429, { error: 'Too many requests. Wait a minute and try again.' }, { 'Retry-After': String(Math.ceil((state.resetAt - now) / 1000)) })
  return true
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('Send a valid JSON request.'), { status: 400 }) }
}

function checkSameOrigin(request, response) {
  const origin = request.headers.origin
  if (!origin) return false
  try {
    if (new URL(origin).host === request.headers.host) return false
  } catch { /* rejected below */ }
  sendJson(response, 403, { error: 'Cross-origin request rejected.' })
  return true
}

async function requireUser(request, response) {
  const session = await getSession(request)
  if (!session) {
    sendJson(response, 401, { error: 'Sign in to continue.' })
    return null
  }
  return session
}

async function getPackedDashboard() {
  if (dashboardCache && dashboardCache.expiresAt > Date.now()) return dashboardCache
  const [metaRow] = await sql`SELECT payload FROM dashboard_meta WHERE id = 1`
  if (!metaRow) throw Object.assign(new Error('Dashboard data has not been loaded into Neon yet. Run npm run db:seed.'), { status: 503 })
  const meta = typeof metaRow.payload === 'string' ? JSON.parse(metaRow.payload) : metaRow.payload
  const [lineRows, orderRows] = await Promise.all([
    sql`SELECT day::text AS day, outlet, category, item, order_type AS "orderType", settlement,
      revenue::float8 AS revenue, quantity::int AS quantity, line_items::int AS "lineItems"
      FROM line_cube ORDER BY day, outlet, category, item, order_type, settlement`,
    sql`SELECT day::text AS day, outlet, order_type AS "orderType", settlement,
      group_mask::text AS "groupMask", item_mask::text AS "itemMask", orders::int AS orders,
      revenue::float8 AS revenue, quantity::int AS quantity, line_items::int AS "lineItems"
      FROM order_cube ORDER BY day, outlet, order_type, settlement`
  ])
  const days = [...new Set(lineRows.map((r) => r.day))].sort()
  const dayIndex = new Map(days.map((value, index) => [value, index]))
  const outletIndex = new Map(meta.outlets.map((value, index) => [value, index]))
  const groupIndex = new Map(meta.groups.map((value, index) => [value, index]))
  const itemIndex = new Map(meta.items.map((value, index) => [value, index]))
  const orderTypeIndex = new Map(meta.orderTypes.map((value, index) => [value, index]))
  const settlementIndex = new Map(meta.settlements.map((value, index) => [value, index]))
  const lines = lineRows.map((r) => [dayIndex.get(r.day), outletIndex.get(r.outlet), groupIndex.get(r.category), itemIndex.get(r.item), orderTypeIndex.get(r.orderType), settlementIndex.get(r.settlement), Number(r.revenue), Number(r.quantity), Number(r.lineItems)])
  const orders = orderRows.map((r) => [dayIndex.get(r.day), outletIndex.get(r.outlet), orderTypeIndex.get(r.orderType), settlementIndex.get(r.settlement), Number(r.groupMask), Number(r.itemMask), Number(r.orders), Number(r.revenue), Number(r.quantity), Number(r.lineItems)])
  const body = JSON.stringify({ meta, days, lines, orders })
  dashboardCache = { body, compressed: gzipSync(body), expiresAt: Date.now() + 5 * 60_000 }
  return dashboardCache
}

function rulesBasedInsights(metrics) {
  const result = []
  const topOutlet = metrics.outlets?.[0]
  const topCategory = metrics.categories?.[0]
  const topItem = metrics.items?.[0]
  if (topOutlet) result.push(`${topOutlet.name} leads the selected outlets with ${Math.round(topOutlet.share)}% of revenue.`)
  if (topCategory) result.push(`${topCategory.name} is the strongest category, contributing ${Math.round(topCategory.share)}% of sales.`)
  if (topItem) result.push(`${topItem.name} is the top item in this selection at ₹${Math.round(topItem.revenue).toLocaleString('en-IN')}.`)
  if (metrics.dailyChange != null) result.push(`The latest day is ${Math.abs(metrics.dailyChange).toFixed(1)}% ${metrics.dailyChange >= 0 ? 'above' : 'below'} the earlier daily average.`)
  if (!result.length) result.push('There is not enough activity in this filter selection to highlight a trend yet.')
  return result
}

function sanitizeMetrics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid insight metrics.'), { status: 400 })
  const amount = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(Number(value), 1_000_000_000_000)) : 0
  const entities = (values, includeShare = false) => Array.isArray(values) ? values.slice(0, 3).flatMap((entry) => {
    if (!entry || typeof entry.name !== 'string') return []
    const item = { name: entry.name.trim().slice(0, 80), revenue: amount(entry.revenue) }
    if (includeShare) item.share = Math.max(0, Math.min(amount(entry.share), 100))
    return item.name ? [item] : []
  }) : []
  const dailyChange = input.dailyChange == null || !Number.isFinite(Number(input.dailyChange)) ? null : Math.max(-1000, Math.min(Number(input.dailyChange), 1000))
  return { revenue: amount(input.revenue), orders: amount(input.orders), quantity: amount(input.quantity), dailyChange, outlets: entities(input.outlets, true), categories: entities(input.categories, true), items: entities(input.items) }
}

async function generateInsights(metrics) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { insights: rulesBasedInsights(metrics), source: 'metrics' }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', store: false, instructions: 'Write 3 short, factual business insights from the supplied aggregate sales metrics. Do not invent causes, forecasts, or facts. Use INR for money. Return a JSON object with an insights array of strings.', input: JSON.stringify(metrics), text: { format: { type: 'json_object' } }, max_output_tokens: 300 })
  })
  if (!response.ok) throw new Error('AI insights service is unavailable. Check the server AI configuration.')
  const result = await response.json()
  const text = result.output_text ?? result.output?.flatMap((entry) => entry.type === 'message' ? entry.content?.filter((part) => part.type === 'output_text').map((part) => part.text) : []).join('')
  if (!text) throw new Error('AI service returned an empty response.')
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('AI service returned invalid insight data.') }
  const insights = Array.isArray(parsed) ? parsed : parsed.insights
  if (!Array.isArray(insights) || !insights.length || insights.some((x) => typeof x !== 'string')) throw new Error('AI service returned invalid insight data.')
  return { insights: insights.slice(0, 4).map((text) => text.slice(0, 240)), source: 'ai' }
}

async function api(request, response, url) {
  const secure = process.env.NODE_ENV === 'production'
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, database: 'connected' })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/config') {
    sendJson(response, 200, { registrationEnabled: process.env.ALLOW_REGISTRATION === 'true' })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await getSession(request)
    if (!user) sendJson(response, 401, { error: 'Sign in to continue.' })
    else sendJson(response, 200, { user: { email: user.email, displayName: user.displayName } })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    if (rateLimit(request, response, 'login', 8)) return
    if (checkSameOrigin(request, response)) return
    const body = await readJson(request)
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.password.length > 256) return sendJson(response, 400, { error: 'Enter a valid email and password.' })
    const user = await authenticate(body.email, body.password)
    if (!user) return sendJson(response, 401, { error: 'Email or password is incorrect.' })
    const sessionId = await createSession(user.id)
    sendJson(response, 200, { user: { email: user.email, displayName: user.displayName } }, { 'Set-Cookie': sessionCookie(sessionId, secure) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    if (rateLimit(request, response, 'register', 5)) return
    if (checkSameOrigin(request, response)) return
    if (process.env.ALLOW_REGISTRATION !== 'true') return sendJson(response, 403, { error: 'Account registration is disabled. Ask the dashboard administrator for an account.' })
    const body = await readJson(request)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256) return sendJson(response, 400, { error: 'Use a valid email and a password with at least 12 characters.' })
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : email.split('@')[0]
    const id = randomUUID()
    try { await sql`INSERT INTO app_users (id, email, password_hash, display_name) VALUES (${id}, ${email}, ${hashPassword(password)}, ${name})` }
    catch (error) { if (error?.code === '23505') return sendJson(response, 409, { error: 'An account with this email already exists.' }); throw error }
    const sessionId = await createSession(id)
    sendJson(response, 201, { user: { email, displayName: name } }, { 'Set-Cookie': sessionCookie(sessionId, secure) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (checkSameOrigin(request, response)) return
    const user = await getSession(request)
    if (user) await sql`DELETE FROM app_sessions WHERE id = ${user.sessionId}`
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(secure) })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/dashboard') {
    if (!await requireUser(request, response)) return
    const snapshot = await getPackedDashboard()
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(request.headers['accept-encoding']?.includes('gzip') ? { 'Content-Encoding': 'gzip' } : {}) })
    response.end(request.headers['accept-encoding']?.includes('gzip') ? snapshot.compressed : snapshot.body)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/insights') {
    if (!await requireUser(request, response)) return
    if (rateLimit(request, response, 'insights', 20)) return
    if (checkSameOrigin(request, response)) return
    const metrics = sanitizeMetrics(await readJson(request))
    const serialized = JSON.stringify(metrics)
    if (serialized.length > 20_000) return sendJson(response, 413, { error: 'Insight request is too large.' })
    const cacheKey = serialized
    const cached = insightCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return sendJson(response, 200, cached.value)
    const value = await generateInsights(metrics)
    insightCache.set(cacheKey, { value, expiresAt: Date.now() + 5 * 60_000 })
    sendJson(response, 200, value)
    return
  }
  sendJson(response, 404, { error: 'API endpoint not found.' })
}

async function serveStatic(request, response, url) {
  const dist = resolve('dist')
  const decoded = decodeURIComponent(url.pathname)
  const requested = decoded === '/' ? '/index.html' : decoded
  const file = resolve(dist, `.${requested}`)
  if (!file.startsWith(`${dist}${sep}`) && file !== resolve(dist, 'index.html')) return sendJson(response, 400, { error: 'Invalid path.' })
  const target = existsSync(file) ? file : resolve(dist, 'index.html')
  if (!existsSync(target)) return sendJson(response, 503, { error: 'Frontend build missing. Run npm run build.' })
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream', 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' })
  createReadStream(target).pipe(response)
}

await initDb()
await bootstrapAdmin()
await sql`DELETE FROM app_sessions WHERE expires_at < now()`
const server = createServer(async (request, response) => {
  secureHeaders(response)
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (url.pathname.startsWith('/api/')) await api(request, response, url)
    else if (request.method === 'GET' || request.method === 'HEAD') await serveStatic(request, response, url)
    else sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' })
  } catch (error) {
    const status = error.status || 500
    if (status >= 500) console.error('Request failed:', error)
    if (!response.headersSent) sendJson(response, status, { error: status < 500 ? error.message : 'The server could not complete the request.' })
    else response.destroy()
  }
})

server.listen(port, '0.0.0.0', () => console.info(`Analytics API ready at http://localhost:${port}`))
const cleanup = setInterval(() => { sql`DELETE FROM app_sessions WHERE expires_at < now()`.catch((error) => console.error('Session cleanup failed:', error)) }, 60 * 60_000)
cleanup.unref()
