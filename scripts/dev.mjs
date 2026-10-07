import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const children = []
let stopping = false

function stop(code = 0) {
  stopping = true
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  process.exit(code)
}

function track(child) {
  children.push(child)
  child.on('exit', (code) => { if (!stopping && code !== 0) stop(code || 1) })
  return child
}

async function apiIsReady() {
  try {
    const response = await fetch('http://localhost:3001/api/health', { signal: AbortSignal.timeout(1000) })
    return response.ok
  } catch { return false }
}

function portIsOccupied() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3001 })
    const finish = (occupied) => { socket.destroy(); resolve(occupied) }
    socket.setTimeout(750, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function start() {
  const reuseApi = await apiIsReady()
  if (!reuseApi && await portIsOccupied()) {
    console.error('Port 3001 is already in use, but its API health check failed. Stop the process using port 3001, then run npm run dev again.')
    stop(1)
    return
  }
  if (!reuseApi) track(spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', env: process.env }))
  const deadline = Date.now() + 30_000
  while (!stopping && Date.now() < deadline) {
    if (await apiIsReady()) {
      if (reuseApi) console.info('Using the analytics API already running at http://localhost:3001.')
      track(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit', env: process.env }))
      return
    }
    await delay(250)
  }
  if (!stopping) {
    console.error('The analytics API did not become ready within 30 seconds.')
    stop(1)
  }
}

start().catch((error) => { console.error('Could not start the development servers:', error); stop(1) })
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
