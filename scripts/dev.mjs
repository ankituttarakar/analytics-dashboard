import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { stdio: 'inherit', env: process.env }),
]

function stop(code = 0) {
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  process.exit(code)
}

for (const child of children) child.on('exit', (code) => { if (code && code !== 0) stop(code) })
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
