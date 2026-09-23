// VBAN (VB-Audio Network protocol) — the Voicemeeter Potato-style network
// audio bridge. We shell out to the `vban_emitter` / `vban_receptor` CLI
// tools (https://github.com/quiniouben/vban) and manage them as tracked
// child processes, rebinding their pulseaudio record/playback stream onto
// the PipeWire device the user picked (matched by stream name, since the
// pulseaudio backend of those tools has no CLI flag to pick a device
// directly — it just opens a stream and we move it with `pactl`).
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { listSinkInputs, listSourceOutputs, moveStream } from './pipewire.js'

export type VbanKind = 'emitter' | 'receptor'

export interface VbanStreamSpec {
  id: string
  kind: VbanKind
  name: string        // friendly label
  ip: string           // emitter: destination IP to send to. receptor: sender IP to accept from
  port: number
  streamName: string   // VBAN stream name (also used as the pulseaudio stream identifier)
  device: string       // emitter: PipeWire SOURCE to capture from. receptor: PipeWire SINK to play into
  rate?: number        // emitter only, default 48000
  channels?: number    // emitter only, default 2
  quality?: number      // receptor only, 0 (low latency) - 4, default 1
}

export interface VbanStreamStatus extends VbanStreamSpec {
  pid: number | null
  status: 'starting' | 'running' | 'stopped' | 'error'
  error?: string
  startedAt: number | null
  log: string[]
}

const procs = new Map<string, ChildProcess>()
const registry = new Map<string, VbanStreamStatus>()

function binName(kind: VbanKind): string { return kind === 'emitter' ? 'vban_emitter' : 'vban_receptor' }

function which(bin: string): Promise<boolean> {
  return new Promise(resolve => execFile('which', [bin], err => resolve(!err)))
}

export async function vbanAvailable(): Promise<{ emitter: boolean; receptor: boolean }> {
  const [emitter, receptor] = await Promise.all([which('vban_emitter'), which('vban_receptor')])
  return { emitter, receptor }
}

function buildArgs(spec: VbanStreamSpec): string[] {
  if (spec.kind === 'emitter') {
    return [
      '-i', spec.ip, '-p', String(spec.port), '-s', spec.streamName,
      '-b', 'pulseaudio', '-d', spec.streamName,
      '-r', String(spec.rate || 48000), '-n', String(spec.channels || 2),
    ]
  }
  return [
    '-i', spec.ip, '-p', String(spec.port), '-s', spec.streamName,
    '-b', 'pulseaudio', '-d', spec.streamName,
    '-q', String(spec.quality ?? 1),
  ]
}

// The CLI tool's pulseaudio backend opens a stream tagged with our
// streamName but doesn't let us pick the device up front — find it and
// move it onto the real PipeWire node the user chose.
async function bindPulseStream(spec: VbanStreamSpec, attempt = 0): Promise<void> {
  if (attempt > 20) return // ~5s — give up quietly; stream keeps running on the default device
  if (!procs.has(spec.id)) return // stopped/replaced while we were waiting
  const list = spec.kind === 'emitter' ? await listSourceOutputs() : await listSinkInputs()
  const match = list.find(s => s.app === spec.streamName || s.media === spec.streamName)
  if (!match) {
    await new Promise(r => setTimeout(r, 250))
    return bindPulseStream(spec, attempt + 1)
  }
  await moveStream(spec.kind === 'emitter' ? 'source-output' : 'sink-input', String(match.id), spec.device)
}

export function listVbanStreams(): VbanStreamStatus[] { return [...registry.values()] }
export function getVbanStream(id: string): VbanStreamStatus | undefined { return registry.get(id) }

export async function startVbanStream(spec: VbanStreamSpec): Promise<VbanStreamStatus> {
  stopVbanStream(spec.id) // idempotent — replace any prior run of this id

  const status: VbanStreamStatus = { ...spec, pid: null, status: 'starting', startedAt: Date.now(), log: [] }
  registry.set(spec.id, status)

  const child = spawn(binName(spec.kind), buildArgs(spec), { stdio: ['ignore', 'pipe', 'pipe'] })
  procs.set(spec.id, child)
  status.pid = child.pid ?? null

  const pushLog = (chunk: Buffer) => {
    status.log.push(...chunk.toString('utf8').split('\n').filter(Boolean))
    if (status.log.length > 50) status.log.splice(0, status.log.length - 50)
  }
  child.stdout?.on('data', pushLog)
  child.stderr?.on('data', pushLog)

  child.on('spawn', () => { status.status = 'running'; void bindPulseStream(spec) })
  child.on('error', err => { status.status = 'error'; status.error = err.message; procs.delete(spec.id) })
  child.on('exit', (code, signal) => {
    procs.delete(spec.id)
    if (registry.get(spec.id) !== status) return // already replaced
    status.pid = null
    if (signal || code === 0) { status.status = 'stopped' }
    else { status.status = 'error'; status.error = `exited with code ${code}` }
  })

  return status
}

export function stopVbanStream(id: string): boolean {
  const child = procs.get(id)
  if (child) { child.kill('SIGTERM'); procs.delete(id) }
  const status = registry.get(id)
  if (status) { status.status = 'stopped'; status.pid = null }
  return !!child
}

export function removeVbanStream(id: string): void {
  stopVbanStream(id)
  registry.delete(id)
}
