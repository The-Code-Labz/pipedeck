// Thin typed wrapper around `pactl`. PipeWire's pulse-compatible CLI
// is the most stable surface — no native deps, works on any PipeWire box.
import { execFile } from 'node:child_process'

export interface Device {
  id: number
  name: string
  description: string
  state: string
  volume: number // 0-100
  mute: boolean
  isDefault: boolean
  virtual: boolean
}

export interface Stream {
  id: number
  app: string
  media: string
  target: string // current sink/source name
  volume: number
  mute: boolean
}

export interface LoadedModule {
  index: number
  name: string
  args: string
  ours: boolean // created by PipeDeck
}

const VIRTUAL_MARKERS = ['module-null-sink', 'module-combine-sink', 'module-loopback', 'Combined', 'VirtualMic', 'pipedeck']

export function pactl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('pactl', args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`pactl ${args.join(' ')}: ${stderr || err.message}`))
      else resolve(stdout)
    })
  })
}

function parsePct(out: string): number {
  const m = out.match(/(\d+)%/)
  return m ? parseInt(m[1], 10) : 0
}

function parseMute(out: string): boolean {
  return /Mute:\s*yes/i.test(out)
}

function blockParse(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^([^:]+):\s*(.*)$/)
    if (m) map.set(m[1].trim(), m[2].trim())
  }
  return map
}

async function listDevices(kind: 'sinks' | 'sources'): Promise<Device[]> {
  const short = await pactl(['list', kind, 'short'])
  const defaultsRaw = await pactl(['get-default-' + (kind === 'sinks' ? 'sink' : 'source')]).catch(() => '')
  const def = defaultsRaw.trim()
  const devices: Device[] = []
  for (const line of short.split('\n').filter(Boolean)) {
    const [idStr, name, , , stateRaw] = line.split('\t')
    const id = parseInt(idStr, 10)
    const volume = parsePct(await pactl(['get-' + kind.slice(0, -1) + '-volume', name]).catch(() => ''))
    const mute = parseMute(await pactl(['get-' + kind.slice(0, -1) + '-mute', name]).catch(() => ''))
    devices.push({
      id, name,
      description: name,
      state: stateRaw || 'RUNNING',
      volume, mute,
      isDefault: name === def,
      virtual: VIRTUAL_MARKERS.some(m => name.includes(m)),
    })
  }
  return devices
}

export async function listSinks(): Promise<Device[]> { return listDevices('sinks') }
export async function listSources(): Promise<Device[]> { return listDevices('sources') }

export async function listSinkInputs(): Promise<Stream[]> {
  const out = await pactl(['list', 'sink-inputs'])
  const blocks = out.split(/Sink Input #(\d+)/).slice(1)
  const streams: Stream[] = []
  for (let i = 0; i < blocks.length; i += 2) {
    const id = parseInt(blocks[i], 10)
    const f = blockParse(blocks[i + 1])
    streams.push({
      id,
      app: f.get('application.name') || f.get('media.name') || 'Unknown',
      media: f.get('media.name') || '',
      target: (f.get('Sink') || '').replace(/<|>/g, ''),
      volume: parsePct(f.get('Volume') || ''),
      mute: /yes/i.test(f.get('Mute') || ''),
    })
  }
  return streams
}

export async function listSourceOutputs(): Promise<Stream[]> {
  const out = await pactl(['list', 'source-outputs'])
  const blocks = out.split(/Source Output #(\d+)/).slice(1)
  const streams: Stream[] = []
  for (let i = 0; i < blocks.length; i += 2) {
    const id = parseInt(blocks[i], 10)
    const f = blockParse(blocks[i + 1])
    streams.push({
      id,
      app: f.get('application.name') || f.get('media.name') || 'Unknown',
      media: f.get('media.name') || '',
      target: (f.get('Source') || '').replace(/<|>/g, ''),
      volume: parsePct(f.get('Volume') || ''),
      mute: /yes/i.test(f.get('Mute') || ''),
    })
  }
  return streams
}

export async function setVolume(kind: string, id: string, volume: number): Promise<void> {
  const noun = { sink: 'sink-volume', source: 'source-volume', 'sink-input': 'sink-input-volume', 'source-output': 'source-output-volume' }[kind]
  if (!noun) throw new Error(`unknown volume kind: ${kind}`)
  await pactl(['set-' + noun, id, `${Math.max(0, Math.min(150, volume))}%`])
}

export async function setMute(kind: string, id: string, mute: boolean): Promise<void> {
  const noun = { sink: 'sink-mute', source: 'source-mute', 'sink-input': 'sink-input-mute', 'source-output': 'source-output-mute' }[kind]
  if (!noun) throw new Error(`unknown mute kind: ${kind}`)
  await pactl(['set-' + noun, id, mute ? '1' : '0'])
}

export async function moveStream(kind: 'sink-input' | 'source-output', id: string, target: string): Promise<void> {
  await pactl([`move-${kind}`, id, target])
}

export async function setDefault(kind: 'sink' | 'source', name: string): Promise<void> {
  await pactl(['set-default-' + kind, name])
}

// A1/A2/A3 — Voicemeeter hardware bus equivalent: one sink, N slaves playing simultaneously.
export async function createCombinedSink(name: string, slaves: string[]): Promise<number> {
  if (slaves.length < 2) throw new Error('combined output needs at least 2 slave devices')
  const out = await pactl([
    'load-module', 'module-combine-sink',
    `sink_name=${name}`,
    `slaves=${slaves.join(',')}`,
    `sink_properties=device.description=${name}`,
  ])
  return parseInt(out.trim(), 10)
}

// B1/B2 — virtual microphone: null sink shown as a source, fed by loopbacks from N physical mics.
export async function createVirtualMic(name: string, mics: string[]): Promise<number[]> {
  if (mics.length < 1) throw new Error('virtual mic needs at least 1 source mic')
  const indexes: number[] = []
  const out = await pactl([
    'load-module', 'module-null-sink',
    `sink_name=${name}`,
    `sink_properties=device.description=${name}`,
    'media.class=Audio/Source/Virtual',
  ])
  indexes.push(parseInt(out.trim(), 10))
  for (const mic of mics) {
    const lb = await pactl(['load-module', 'module-loopback', `source=${mic}`, `sink=${name}`, 'latency_msec=1'])
    indexes.push(parseInt(lb.trim(), 10))
  }
  return indexes
}

export async function unloadModule(index: number): Promise<void> {
  await pactl(['unload-module', String(index)])
}

export async function listModules(): Promise<LoadedModule[]> {
  const out = await pactl(['list', 'modules', 'short'])
  return out.split('\n').filter(Boolean).map(line => {
    const [idx, name, args = ''] = line.split('\t')
    return {
      index: parseInt(idx, 10),
      name,
      args,
      ours: name === 'module-combine-sink' || name === 'module-null-sink' || name === 'module-loopback',
    }
  }).filter(m => m.ours)
}

export async function pipewireAvailable(): Promise<boolean> {
  try { await pactl(['info']); return true } catch { return false }
}
