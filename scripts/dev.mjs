import { spawn } from 'node:child_process'
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

async function start() {
  track(spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', env: process.env }))
  const deadline = Date.now() + 30_000
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch('http://localhost:3001/api/health')
      if (response.ok) {
        track(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit', env: process.env }))
        return
      }
    } catch { /* API is still starting. */ }
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
