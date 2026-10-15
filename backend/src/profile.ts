// Saved routing profile: virtual devices to recreate on boot.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createCombinedSink, createVirtualMic, createRoute, listModules, type Route } from './pipewire.js'
import { startVbanStream, listVbanStreams, type VbanStreamSpec } from './vban.js'

export interface CombinedSinkSpec { name: string; slaves: string[] }
export interface VirtualMicSpec { name: string; mics: string[] }
export interface RouteSpec { source: string; sink: string }
export interface Profile {
  combinedSinks: CombinedSinkSpec[]
  virtualMics: VirtualMicSpec[]
  vbanStreams: VbanStreamSpec[]
  routes: RouteSpec[]
}

const DATA_DIR = process.env.PIPEDECK_DATA_DIR || join(process.cwd(), '..', 'data')
const PROFILE_PATH = join(DATA_DIR, 'profile.json')

export const emptyProfile = (): Profile => ({ combinedSinks: [], virtualMics: [], vbanStreams: [], routes: [] })

export async function loadProfile(): Promise<Profile> {
  try {
    return { ...emptyProfile(), ...JSON.parse(await readFile(PROFILE_PATH, 'utf8')) }
  } catch {
    return emptyProfile()
  }
}

export async function saveProfile(p: Profile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(PROFILE_PATH, JSON.stringify(p, null, 2))
}

// Re-apply: only create devices that aren't already loaded (match by sink_name= in module args).
export async function applyProfile(p: Profile): Promise<string[]> {
  const loaded = await listModules()
  const loadedArgs = loaded.map(m => m.args).join('\n')
  const actions: string[] = []
  for (const cs of p.combinedSinks) {
    if (loadedArgs.includes(`sink_name=${cs.name}`)) { actions.push(`skip ${cs.name} (already loaded)`); continue }
    await createCombinedSink(cs.name, cs.slaves)
    actions.push(`created combined sink ${cs.name}`)
  }
  for (const vm of p.virtualMics) {
    if (loadedArgs.includes(`sink_name=${vm.name}`)) { actions.push(`skip ${vm.name} (already loaded)`); continue }
    await createVirtualMic(vm.name, vm.mics)
    actions.push(`created virtual mic ${vm.name}`)
  }
  const runningVban = new Set(listVbanStreams().filter(s => s.status === 'running' || s.status === 'starting').map(s => s.id))
  for (const vs of p.vbanStreams) {
    if (runningVban.has(vs.id)) { actions.push(`skip ${vs.name} (already running)`); continue }
    await startVbanStream(vs)
    actions.push(`started vban ${vs.kind} ${vs.name}`)
  }
  const existingRoutes: Route[] = loaded
    .filter(m => m.name === 'module-loopback')
    .map(m => ({
      id: m.index,
      source: m.args.match(/source=(\S+)/)?.[1] || '',
      sink: m.args.match(/sink=(\S+)/)?.[1] || '',
    }))
  for (const r of p.routes || []) {
    if (existingRoutes.some(e => e.source === r.source && e.sink === r.sink)) {
      actions.push(`skip route ${r.source} -> ${r.sink} (already loaded)`); continue
    }
    await createRoute(r.source, r.sink)
    actions.push(`routed ${r.source} -> ${r.sink}`)
  }
  return actions
}
