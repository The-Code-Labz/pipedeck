// Saved routing profile: virtual devices to recreate on boot.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createCombinedSink, createVirtualMic, listModules } from './pipewire.js'

export interface CombinedSinkSpec { name: string; slaves: string[] }
export interface VirtualMicSpec { name: string; mics: string[] }
export interface Profile {
  combinedSinks: CombinedSinkSpec[]
  virtualMics: VirtualMicSpec[]
}

const DATA_DIR = process.env.PIPEDECK_DATA_DIR || join(process.cwd(), '..', 'data')
const PROFILE_PATH = join(DATA_DIR, 'profile.json')

export const emptyProfile = (): Profile => ({ combinedSinks: [], virtualMics: [] })

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
  return actions
}
