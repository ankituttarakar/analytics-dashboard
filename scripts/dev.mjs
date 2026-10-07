import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const children = []
let stopping = false
const preferredPort = Number(process.env.PORT || 3001)
const apiPortLimit = preferredPort + 10

function stop(code = 0) {
  stopping = true
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  process.exit(code)
}

function track(child, tolerateFailure = false) {
  children.push(child)
  child.on('exit', (code) => { if (!stopping && code !== 0 && !tolerateFailure) stop(code || 1) })
  return child
}

async function apiIsReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return false
    const status = await response.json()
    return status.authentication === 'browser-local'
  } catch { return false }
}

function portIsOccupied(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', error => resolve(error.code === 'EADDRINUSE'))
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(false)))
  })
}

function waitForApi(child, port) {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const finish = (ready) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ready)
    }
    const timer = setTimeout(() => finish(false), 30_000)
    const forward = (stream) => stream?.on('data', (chunk) => {
      const text = chunk.toString()
      output = (output + text).slice(-2000)
      process.stdout.write(text)
      if (output.includes(`Analytics API ready at http://localhost:${port}`)) finish(true)
      else if (output.includes('EADDRINUSE')) finish(false)
    })
    forward(child.stdout)
    forward(child.stderr)
    child.once('error', () => finish(false))
    child.once('exit', () => finish(false))
  })
}

async function start() {
  for (let port = preferredPort; port <= apiPortLimit && !stopping; port++) {
    if (await apiIsReady(port)) {
      console.info(`Using the analytics API already running at http://localhost:${port}.`)
      track(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], {
        stdio: 'inherit', env: { ...process.env, VITE_API_TARGET: `http://localhost:${port}` },
      }))
      return
    }
    if (await portIsOccupied(port)) {
      console.warn(`Port ${port} is occupied by another service; checking the next port.`)
      continue
    }
    const child = track(spawn(process.execPath, ['--watch', 'server/index.mjs'], {
      stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port) },
    }), true)
    if (await waitForApi(child, port)) {
      track(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], {
        stdio: 'inherit', env: { ...process.env, VITE_API_TARGET: `http://localhost:${port}` },
      }))
      return
    }
    if (!stopping && child.exitCode === null) child.kill('SIGTERM')
    if (!stopping) console.warn(`Could not start the analytics API on port ${port}; checking the next port.`)
  }
  if (!stopping) {
    console.error(`No working analytics API port was found between ${preferredPort} and ${apiPortLimit}.`)
    stop(1)
  }
}

start().catch((error) => { console.error('Could not start the development servers:', error); stop(1) })
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
