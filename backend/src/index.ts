import express from 'express'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pipewireAvailable, listSinks, listSources, listSinkInputs, listSourceOutputs,
  setVolume, setMute, moveStream, setDefault, createCombinedSink, createVirtualMic,
  unloadModule, listModules,
} from './pipewire.js'
import { loadProfile, saveProfile, applyProfile, type Profile } from './profile.js'

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

// Serve the production frontend if present.
const here = dirname(fileURLToPath(import.meta.url))
const frontendDist = join(here, '..', '..', 'frontend', 'dist')
app.use(express.static(frontendDist))
app.get('*', (_req, res) => res.sendFile(join(frontendDist, 'index.html')))

const PORT = parseInt(process.env.PORT || '4190', 10)
app.listen(PORT, () => console.log(`PipeDeck on http://localhost:${PORT}`))
