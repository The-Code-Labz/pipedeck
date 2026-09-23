export interface Device {
  id: number; name: string; description: string; state: string
  volume: number; mute: boolean; isDefault: boolean; virtual: boolean
}
export interface Stream {
  id: number; app: string; media: string; target: string; volume: number; mute: boolean
}
export interface LoadedModule { index: number; name: string; args: string; ours: boolean }
export interface VbanStreamSpec {
  id: string; kind: 'emitter' | 'receptor'; name: string; ip: string; port: number
  streamName: string; device: string; rate?: number; channels?: number; quality?: number
}
export interface VbanStream extends VbanStreamSpec {
  pid: number | null; status: 'starting' | 'running' | 'stopped' | 'error'; error?: string
  startedAt: number | null; log: string[]
}
export interface VbanInfo { available: { emitter: boolean; receptor: boolean }; streams: VbanStream[] }
export interface Profile {
  combinedSinks: { name: string; slaves: string[] }[]
  virtualMics: { name: string; mics: string[] }[]
  vbanStreams: VbanStreamSpec[]
}
export interface State {
  sinks: Device[]; sources: Device[]
  sinkInputs: Stream[]; sourceOutputs: Stream[]
  modules: LoadedModule[]; profile: Profile; vban: VbanInfo
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || r.statusText)
  return r.json() as Promise<T>
}

export const getState = () => req<State>('/api/state')
export const setVolume = (kind: string, id: string | number, volume: number) =>
  req('/api/volume', { method: 'POST', body: JSON.stringify({ kind, id, volume }) })
export const setMute = (kind: string, id: string | number, mute: boolean) =>
  req('/api/mute', { method: 'POST', body: JSON.stringify({ kind, id, mute }) })
export const moveStream = (kind: 'sink-input' | 'source-output', id: number, target: string) =>
  req('/api/move', { method: 'POST', body: JSON.stringify({ kind, id, target }) })
export const setDefault = (kind: 'sink' | 'source', name: string) =>
  req('/api/default', { method: 'POST', body: JSON.stringify({ kind, name }) })
export const createCombinedSink = (name: string, slaves: string[]) =>
  req<{ moduleIndex: number }>('/api/combined-sink', { method: 'POST', body: JSON.stringify({ name, slaves }) })
export const createVirtualMic = (name: string, mics: string[]) =>
  req<{ moduleIndexes: number[] }>('/api/virtual-mic', { method: 'POST', body: JSON.stringify({ name, mics }) })
export const unloadModule = (index: number) =>
  req(`/api/module/${index}`, { method: 'DELETE' })
export const applyProfile = () =>
  req<{ actions: string[] }>('/api/profile/apply', { method: 'POST' })

export interface VbanCreateInput {
  name: string; ip: string; port: number; device: string
  streamName?: string; rate?: number; channels?: number; quality?: number
}
export const createVbanEmitter = (input: VbanCreateInput) =>
  req<VbanStream>('/api/vban/emitter', { method: 'POST', body: JSON.stringify(input) })
export const createVbanReceptor = (input: VbanCreateInput) =>
  req<VbanStream>('/api/vban/receptor', { method: 'POST', body: JSON.stringify(input) })
export const restartVban = (id: string) =>
  req<VbanStream>(`/api/vban/${id}/restart`, { method: 'POST' })
export const removeVban = (id: string) =>
  req(`/api/vban/${id}`, { method: 'DELETE' })
