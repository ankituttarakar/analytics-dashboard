import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { sql } from './db.mjs'

const secret = process.env.SESSION_SECRET
if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set to a random value at least 32 characters long.')

const cookieName = 'analytics_session'
const maxAgeSeconds = 60 * 60 * 24 * 7
const digest = (value) => createHmac('sha256', secret).update(value).digest('base64url')
const encodePassword = (password) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':')
  if (!salt || !expectedHex) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = scryptSync(password, salt, 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  if (password.length < 12 || password.length > 256 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (process.env.ALLOW_REGISTRATION === 'true') {
      console.warn('Skipping initial admin account because its credentials are invalid; public account registration is enabled.')
      return
    }
    throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must be 12 to 256 characters.')
  }
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM app_users`
  if (Number(count) === 0) {
    await sql`INSERT INTO app_users (id, email, password_hash, display_name)
      VALUES (${randomUUID()}, ${email}, ${encodePassword(password)}, 'Analytics Admin')
      ON CONFLICT (email) DO NOTHING`
    console.info(`Created initial dashboard account for ${email}`)
  }
}

export function sessionCookie(sessionId, secure) {
  const value = `${sessionId}.${digest(sessionId)}`
  return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie(secure) {
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`
}

function cookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()]
  }).filter(([key]) => key))
}

export async function getSession(request) {
  const token = cookies(request.headers.cookie)[cookieName]
  const [id, signature] = token?.split('.') ?? []
  if (!id || !signature) return null
  const expected = Buffer.from(digest(id))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  const [session] = await sql`
    SELECT u.id, u.email, u.display_name AS "displayName", s.id AS "sessionId"
    FROM app_sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.id = ${id} AND s.expires_at > now() LIMIT 1`
  return session ?? null
}

export async function createSession(userId) {
  const id = randomBytes(32).toString('base64url')
  await sql`INSERT INTO app_sessions (id, user_id, expires_at)
    VALUES (${id}, ${userId}, now() + interval '7 days')`
  return id
}

export async function authenticate(email, password) {
  const [user] = await sql`SELECT id, email, display_name AS "displayName", password_hash
    FROM app_users WHERE email = ${email.trim().toLowerCase()} LIMIT 1`
  if (!user || !verifyPassword(password, user.password_hash)) return null
  return { id: user.id, email: user.email, displayName: user.displayName }
}

export function hashPassword(password) { return encodePassword(password) }

export { cookieName }
