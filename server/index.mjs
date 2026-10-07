import 'dotenv/config'
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { sql, initDb } from './db.mjs'
import { authenticate, bootstrapAdmin, bootstrapDemoAccount, clearSessionCookie, createSession, getSession, hashPassword, sessionCookie } from './security.mjs'

const port = Number(process.env.PORT || 3001)
const maxBodyBytes = 64 * 1024
const rateLimits = new Map()
let dashboardCache
let dashboardLoadPromise
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
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
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
    const originUrl = new URL(origin)
    if (originUrl.host === request.headers.host) return false
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1'])
    const apiUrl = new URL(`http://${request.headers.host || ''}`)
    const vitePort = Number(originUrl.port)
    const isViteDevProxy = process.env.NODE_ENV !== 'production'
      && loopbackHosts.has(originUrl.hostname)
      && vitePort >= 5173 && vitePort <= 5199
      && loopbackHosts.has(apiUrl.hostname)
      && apiUrl.port === String(port)
    if (isViteDevProxy) return false
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

async function loadPackedDashboard() {
  if (dashboardCache && dashboardCache.expiresAt > Date.now()) return dashboardCache
  // Local development already has the compact, privacy-safe seed artifact.
  // Reuse it rather than making hundreds of Neon HTTP reads on every restart.
  const localSnapshotPath = resolve('data/dashboard.json.gz')
  if (process.env.NODE_ENV !== 'production' && existsSync(localSnapshotPath)) {
    const compressed = readFileSync(localSnapshotPath)
    const body = gunzipSync(compressed).toString('utf8')
    dashboardCache = { body, compressed, expiresAt: Date.now() + 5 * 60_000 }
    return dashboardCache
  }
  const [metaRow] = await sql`SELECT payload FROM dashboard_meta WHERE id = 1`
  if (!metaRow) throw Object.assign(new Error('Dashboard data has not been loaded into Neon yet. Run npm run db:seed.'), { status: 503 })
  const meta = typeof metaRow.payload === 'string' ? JSON.parse(metaRow.payload) : metaRow.payload
  const lineRows = []
  const orderRows = []
  const start = Date.parse(`${meta.dateMin}T00:00:00.000Z`)
  const end = Date.parse(`${meta.dateMax}T00:00:00.000Z`) + 24 * 60 * 60 * 1000
  const chunkMs = 14 * 24 * 60 * 60 * 1000
  const ranges = []
  for (let cursor = start; cursor < end; cursor += chunkMs) {
    ranges.push({
      start: new Date(cursor).toISOString().slice(0, 10),
      end: new Date(Math.min(cursor + chunkMs, end)).toISOString().slice(0, 10)
    })
  }
  const fetchRange = async ({ start: chunkStart, end: chunkEnd }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await Promise.all([
          sql`SELECT day::text AS day, outlet, category, item, order_type AS "orderType", settlement,
            revenue::float8 AS revenue, quantity::int AS quantity, line_items::int AS "lineItems"
            FROM line_cube WHERE day >= ${chunkStart}::date AND day < ${chunkEnd}::date`,
          sql`SELECT day::text AS day, outlet, order_type AS "orderType", settlement,
            group_mask::text AS "groupMask", item_mask::text AS "itemMask", orders::int AS orders,
            revenue::float8 AS revenue, quantity::int AS quantity, line_items::int AS "lineItems"
            FROM order_cube WHERE day >= ${chunkStart}::date AND day < ${chunkEnd}::date`
        ])
      } catch (error) {
        const transient = error?.cause?.code === 'UND_ERR_SOCKET' || error?.code === 'UND_ERR_SOCKET'
          || (error instanceof TypeError && /terminated|fetch failed/i.test(error.message))
        if (!transient || attempt > 0) throw error
        await delay(250)
      }
    }
  }
  // Run more small, predictable queries at once to reduce round trips without
  // creating the oversized responses that caused transient Neon socket drops.
  for (let offset = 0; offset < ranges.length; offset += 8) {
    const batch = await Promise.all(ranges.slice(offset, offset + 8).map(fetchRange))
    for (const [lines, orders] of batch) {
      lineRows.push(...lines)
      orderRows.push(...orders)
    }
  }
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

async function getPackedDashboard() {
  if (dashboardCache && dashboardCache.expiresAt > Date.now()) return dashboardCache
  if (!dashboardLoadPromise) {
    dashboardLoadPromise = loadPackedDashboard().finally(() => { dashboardLoadPromise = undefined })
  }
  return dashboardLoadPromise
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
  if (metrics.orders > 0 && result.length < 4) {
    const averageOrderValue = Math.round(metrics.revenue / metrics.orders)
    result.push(`Average revenue per order in this selection is ₹${averageOrderValue.toLocaleString('en-IN')}.`)
  }
  if (!result.length) result.push('There is not enough activity in this filter selection to highlight a trend yet.')
  return result.slice(0, 4)
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

function generateInsights(metrics) {
  return { insights: rulesBasedInsights(metrics), source: 'metrics' }
}

async function api(request, response, url) {
  const secure = process.env.NODE_ENV === 'production'
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, database: 'connected' })
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/config') {
    const demoUsername = process.env.DEMO_USERNAME?.trim().toLowerCase()
    const demoAccountEnabled = Boolean(demoUsername && process.env.DEMO_PASSWORD === demoUsername)
    sendJson(response, 200, { registrationEnabled: process.env.ALLOW_REGISTRATION === 'true', demoUsername: demoAccountEnabled ? demoUsername : null })
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

let initialization
async function initializeBackend() {
  if (!initialization) {
    initialization = (async () => {
      await initDb()
      await bootstrapAdmin()
      await bootstrapDemoAccount()
      await sql`DELETE FROM app_sessions WHERE expires_at < now()`
    })().catch((error) => { initialization = undefined; throw error })
  }
  return initialization
}

async function handleRequest(request, response, serveFrontend) {
  secureHeaders(response)
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    // Auth configuration is safe to serve without a database connection; this
    // lets the login page show registration/demo options even during DB trouble.
    if (request.method === 'GET' && url.pathname === '/api/auth/config') {
      await api(request, response, url)
      return
    }
    await initializeBackend()
    if (url.pathname.startsWith('/api/')) await api(request, response, url)
    else if (serveFrontend && (request.method === 'GET' || request.method === 'HEAD')) await serveStatic(request, response, url)
    else sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' })
  } catch (error) {
    const status = error.status || 500
    if (status >= 500) console.error('Request failed:', error)
    if (!response.headersSent) sendJson(response, status, { error: status < 500 ? error.message : 'The server could not complete the request.' })
    else response.destroy()
  }
}

export async function handleApiRequest(request, response) {
  return handleRequest(request, response, false)
}

if (process.env.VERCEL !== '1') {
  await initializeBackend()
  const server = createServer((request, response) => handleRequest(request, response, true))
  server.listen(port, '0.0.0.0', () => console.info(`Analytics API ready at http://localhost:${port}`))
  const cleanup = setInterval(() => { sql`DELETE FROM app_sessions WHERE expires_at < now()`.catch((error) => console.error('Session cleanup failed:', error)) }, 60 * 60_000)
  cleanup.unref()
}
