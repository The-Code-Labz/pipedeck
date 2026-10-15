import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execCb)
const here = dirname(fileURLToPath(import.meta.url))
// backend/dist/update.js -> repo root
export const REPO_ROOT = join(here, '..', '..')

async function run(cmd: string, cwd: string = REPO_ROOT): Promise<string> {
  const { stdout, stderr } = await exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 })
  return (stdout + stderr).trim()
}

export interface CommitInfo { hash: string; short: string; author: string; date: string; message: string }

function parseLog(raw: string): CommitInfo[] {
  return raw.split('\n').filter(Boolean).map(line => {
    const [hash, short, author, date, ...rest] = line.split('\x1f')
    return { hash, short, author, date, message: rest.join('\x1f') }
  })
}

const LOG_FMT = "--date=iso-strict --pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s"

export async function getBranch(): Promise<string> {
  return run('git rev-parse --abbrev-ref HEAD')
}

export async function isDirty(): Promise<boolean> {
  return (await run('git status --porcelain')).length > 0
}

export interface UpdateStatus {
  branch: string
  current: CommitInfo | null
  latest: CommitInfo | null
  behind: number
  ahead: number
  updateAvailable: boolean
  dirty: boolean
  lastChecked: string
  offline: boolean
}

export async function getStatus(doFetch: boolean): Promise<UpdateStatus> {
  let offline = false
  if (doFetch) {
    try { await run('git fetch --prune origin') } catch { offline = true }
  }
  const branch = await getBranch()
  const current = parseLog(await run(`git log -1 ${LOG_FMT}`))[0] ?? null
  let latest: CommitInfo | null = null
  let behind = 0, ahead = 0
  try {
    latest = parseLog(await run(`git log -1 ${LOG_FMT} origin/${branch}`))[0] ?? null
    const counts = await run(`git rev-list --left-right --count HEAD...origin/${branch}`)
    const [a, b] = counts.split(/\s+/).map(n => parseInt(n, 10))
    ahead = a || 0; behind = b || 0
  } catch { /* no upstream configured — report current only */ }
  return {
    branch, current, latest, behind, ahead,
    updateAvailable: behind > 0,
    dirty: await isDirty(),
    lastChecked: new Date().toISOString(),
    offline,
  }
}

export interface ApplyResult { ok: boolean; log: string[]; restarting: boolean }

async function step(log: string[], label: string, cmd: string, cwd?: string): Promise<void> {
  log.push(`$ ${label}`)
  const out = await run(cmd, cwd)
  if (out) log.push(out)
}

export async function applyUpdate(): Promise<ApplyResult> {
  if (await isDirty()) {
    throw new Error('local changes detected in the PipeDeck repo — refusing to overwrite. Commit or discard them first.')
  }
  const log: string[] = []
  const branch = await getBranch()

  await step(log, 'git fetch', 'git fetch --prune origin')
  await step(log, 'git merge --ff-only', `git merge --ff-only origin/${branch}`)

  await step(log, 'npm install (root)', 'npm install')
  await step(log, 'npm install (backend)', 'npm install', join(REPO_ROOT, 'backend'))
  await step(log, 'npm install (frontend)', 'npm install', join(REPO_ROOT, 'frontend'))
  await step(log, 'build backend', 'npm run build', join(REPO_ROOT, 'backend'))
  await step(log, 'build frontend', 'npm run build', join(REPO_ROOT, 'frontend'))

  const restarting = scheduleRestart(log)
  return { ok: true, log, restarting }
}

// Restart so the newly built backend/frontend actually take effect.
// Under the systemd user service we ask systemd to restart us; standalone,
// we just exit and rely on the caller (npm start / a process manager) to relaunch.
function scheduleRestart(log: string[]): boolean {
  const underSystemd = !!process.env.INVOCATION_ID
  setTimeout(() => {
    if (underSystemd) {
      log.push('restarting via: systemctl --user restart pipedeck')
      execCb('systemctl --user restart pipedeck')
    } else {
      log.push('update applied — exiting so the process can be relaunched (not running under systemd)')
      process.exit(0)
    }
  }, 300)
  return underSystemd
}
