import express from 'express'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pipewireAvailable, listSinks, listSources, listSinkInputs, listSourceOutputs,
  setVolume, setMute, moveStream, setDefault, createCombinedSink, createVirtualMic,
  unloadModule, listModules,
} from './pipewire.js'
import { loadProfile, saveProfile, applyProfile, type Profile } from './profile.js'
import {
  vbanAvailable, listVbanStreams, startVbanStream, removeVbanStream, getVbanStream,
  type VbanStreamSpec, type VbanKind,
} from './vban.js'

const app = express()
app.use(express.json({ limit: '1mb' }))

const asyncH = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) => { void fn(req, res).catch(e => res.status(500).json({ error: String(e?.message || e) })) }

app.get('/api/health', asyncH(async (_req, res) => {
  res.json({ status: 'ok', pipewire: await pipewireAvailable() })
}))

app.get('/api/state', asyncH(async (_req, res) => {
  if (!(await pipewireAvailable())) return res.status(503).json({ error: 'PipeWire/pactl not available on this machine' })
  res.json({
    sinks: await listSinks(),
    sources: await listSources(),
    sinkInputs: await listSinkInputs(),
    sourceOutputs: await listSourceOutputs(),
    modules: await listModules(),
    profile: await loadProfile(),
    vban: { available: await vbanAvailable(), streams: listVbanStreams() },
  })
}))

app.post('/api/volume', asyncH(async (req, res) => {
  const { kind, id, volume } = req.body
  await setVolume(kind, String(id), Number(volume))
  res.json({ ok: true })
}))

app.post('/api/mute', asyncH(async (req, res) => {
  const { kind, id, mute } = req.body
  await setMute(kind, String(id), Boolean(mute))
  res.json({ ok: true })
}))

app.post('/api/move', asyncH(async (req, res) => {
  const { kind, id, target } = req.body
  await moveStream(kind as 'sink-input' | 'source-output', String(id), String(target))
  res.json({ ok: true })
}))

app.post('/api/default', asyncH(async (req, res) => {
  const { kind, name } = req.body
  await setDefault(kind as 'sink' | 'source', String(name))
  res.json({ ok: true })
}))

app.post('/api/combined-sink', asyncH(async (req, res) => {
  const { name, slaves } = req.body as { name: string; slaves: string[] }
  const index = await createCombinedSink(name, slaves)
  const profile = await loadProfile()
  profile.combinedSinks = [...profile.combinedSinks.filter(c => c.name !== name), { name, slaves }]
  await saveProfile(profile)
  res.json({ ok: true, moduleIndex: index })
}))

app.post('/api/virtual-mic', asyncH(async (req, res) => {
  const { name, mics } = req.body as { name: string; mics: string[] }
  const indexes = await createVirtualMic(name, mics)
  const profile = await loadProfile()
  profile.virtualMics = [...profile.virtualMics.filter(v => v.name !== name), { name, mics }]
  await saveProfile(profile)
  res.json({ ok: true, moduleIndexes: indexes })
}))

app.delete('/api/module/:index', asyncH(async (req, res) => {
  await unloadModule(parseInt(req.params.index, 10))
  res.json({ ok: true })
}))

app.post('/api/profile/apply', asyncH(async (_req, res) => {
  const profile = await loadProfile()
  res.json({ ok: true, actions: await applyProfile(profile) })
}))

app.post('/api/profile/save', asyncH(async (req, res) => {
  const profile = req.body as Profile
  await saveProfile(profile)
  res.json({ ok: true })
}))

// --- VBAN (Voicemeeter Potato-style network audio: mic <-> separate PC) ---

app.get('/api/vban', asyncH(async (_req, res) => {
  res.json({ available: await vbanAvailable(), streams: listVbanStreams() })
}))

async function createVban(kind: VbanKind, req: express.Request, res: express.Response) {
  const { name, ip, port, streamName, device, rate, channels, quality } = req.body as Partial<VbanStreamSpec>
  if (!name || !ip || !port || !device) return res.status(400).json({ error: 'name, ip, port, device are required' })
  const spec: VbanStreamSpec = {
    id: randomUUID(), kind, name: String(name), ip: String(ip), port: Number(port),
    streamName: String(streamName || name).replace(/\s+/g, '_'), device: String(device),
    ...(rate ? { rate: Number(rate) } : {}),
    ...(channels ? { channels: Number(channels) } : {}),
    ...(quality !== undefined ? { quality: Number(quality) } : {}),
  }
  const status = await startVbanStream(spec)
  const profile = await loadProfile()
  profile.vbanStreams = [...profile.vbanStreams.filter(s => s.name !== spec.name), spec]
  await saveProfile(profile)
  res.json(status)
}

app.post('/api/vban/emitter', asyncH((req, res) => createVban('emitter', req, res)))
app.post('/api/vban/receptor', asyncH((req, res) => createVban('receptor', req, res)))

app.post('/api/vban/:id/restart', asyncH(async (req, res) => {
  const spec = getVbanStream(req.params.id)
  if (!spec) return res.status(404).json({ error: 'unknown vban stream id' })
  res.json(await startVbanStream(spec))
}))

app.delete('/api/vban/:id', asyncH(async (req, res) => {
  removeVbanStream(req.params.id)
  const profile = await loadProfile()
  profile.vbanStreams = profile.vbanStreams.filter(s => s.id !== req.params.id)
  await saveProfile(profile)
  res.json({ ok: true })
}))

// Serve the production frontend if present.
const here = dirname(fileURLToPath(import.meta.url))
const frontendDist = join(here, '..', '..', 'frontend', 'dist')
app.use(express.static(frontendDist))
app.get('*', (_req, res) => res.sendFile(join(frontendDist, 'index.html')))

const PORT = parseInt(process.env.PORT || '4190', 10)
app.listen(PORT, () => {
  console.log(`PipeDeck on http://localhost:${PORT}`)
  // Recreate saved combined sinks / virtual mics / VBAN streams on boot,
  // so a systemd restart doesn't silently drop network audio routes.
  void (async () => {
    try {
      if (!(await pipewireAvailable())) return
      const actions = await applyProfile(await loadProfile())
      if (actions.length) console.log('profile applied:', actions.join('; '))
    } catch (err) {
      console.error('profile auto-apply failed:', err)
    }
  })()
})
