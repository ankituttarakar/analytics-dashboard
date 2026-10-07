import 'dotenv/config'

function addSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
}

export default async function handler(request, response) {
  addSecurityHeaders(response)
  const pathname = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`).pathname

  // Login options are environment configuration, so let the page display them
  // even if Neon is temporarily unreachable.
  if (request.method === 'GET' && pathname === '/api/auth/config') {
    const demoUsername = process.env.DEMO_USERNAME?.trim().toLowerCase()
    const demoAccountEnabled = Boolean(demoUsername && process.env.DEMO_PASSWORD === demoUsername)
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify({ registrationEnabled: process.env.ALLOW_REGISTRATION === 'true', demoUsername: demoAccountEnabled ? demoUsername : null }))
    return
  }

  try {
    const { handleApiRequest } = await import('../server/index.mjs')
    await handleApiRequest(request, response)
  } catch {
    if (response.headersSent) return response.destroy()
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify({ error: 'The sign-in service is not configured. Check the deployment environment variables.' }))
  }
}

// Keep the existing request-size checks in server/index.mjs in control of JSON parsing.
export const config = { api: { bodyParser: false } }
