import { useCallback, useEffect, useState } from 'react'
import { Volume2, Mic, AudioLines, Radio, Layers, RefreshCw, Trash2, Star, Plus, Network, RotateCw, GitBranch, Download } from 'lucide-react'
import * as api from './api'

const statusColor: Record<api.VbanStream['status'], string> = {
  running: 'bg-emerald-500/20 text-emerald-300',
  starting: 'bg-yellow-500/20 text-yellow-300',
  stopped: 'bg-zinc-700 text-zinc-400',
  error: 'bg-red-500/20 text-red-300',
}

function VbanForm({ kind, sinks, sources, onCreate }: {
  kind: 'emitter' | 'receptor'; sinks: api.Device[]; sources: api.Device[]
  onCreate: (input: api.VbanCreateInput) => void
}) {
  const [name, setName] = useState(kind === 'emitter' ? 'MicToWin' : 'GameToStream')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(kind === 'emitter' ? 6980 : 6981)
  const [device, setDevice] = useState('')
  const deviceOptions = kind === 'emitter' ? sources : sinks
  const defaultMonitor = kind === 'emitter' ? sources.find(d => d.monitor && sinks.some(s => s.isDefault && d.name === `${s.name}.monitor`)) : undefined
  const defaultMic = kind === 'emitter' ? sources.find(d => d.isDefault && !d.monitor) : undefined

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        {kind === 'emitter'
          ? 'Capture a local mic (or desktop/system audio) and send it over VBAN to another PC (e.g. a Windows VM / Voicemeeter).'
          : 'Receive a VBAN stream from another PC and play it into a local sink.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm" placeholder={kind === 'emitter' ? 'Destination IP' : 'Sender IP'} value={ip} onChange={e => setIp(e.target.value)} />
        <input type="number" className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm" placeholder="Port" value={port} onChange={e => setPort(Number(e.target.value))} />
        <select className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm" value={device} onChange={e => setDevice(e.target.value)}>
          <option value="">{kind === 'emitter' ? 'Source: mic or desktop audio (monitor)' : 'Sink to play into'}</option>
          {deviceOptions.map(d => <option key={d.name} value={d.name}>{d.monitor ? `🖥 Desktop Audio (${d.name})` : d.name}</option>)}
        </select>
      </div>
      {kind === 'emitter' && (
        <div className="flex gap-2">
          {defaultMic && <button type="button" className="btn text-xs" onClick={() => setDevice(defaultMic.name)}><Mic size={12} className="inline mr-1" />Use default mic</button>}
          {defaultMonitor && <button type="button" className="btn text-xs" onClick={() => setDevice(defaultMonitor.name)}><AudioLines size={12} className="inline mr-1" />Use desktop audio</button>}
        </div>
      )}
      <button
        className="btn-primary flex items-center gap-1"
        disabled={!name || !ip || !port || !device}
        onClick={() => onCreate({ name, ip, port, device })}
      ><Plus size={14} />Start {kind}</button>
    </div>
  )
}

function VbanRow({ s, onRestart, onRemove }: { s: api.VbanStream; onRestart: () => void; onRemove: () => void }) {
  return (
    <div className="py-2 border-b border-zinc-800/60 last:border-0 text-sm">
      <div className="flex items-center gap-3">
        <span className="badge bg-zinc-700 text-zinc-300">{s.kind}</span>
        <span className="font-medium truncate">{s.name}</span>
        <span className={`badge ${statusColor[s.status]}`}>{s.status}</span>
        <span className="flex-1 text-xs text-zinc-500 truncate">
          {s.kind === 'emitter' ? `${s.device} → ${s.ip}:${s.port}` : `${s.ip}:${s.port} → ${s.device}`} · stream "{s.streamName}"
        </span>
        <button className="btn" title="Restart" onClick={onRestart}><RotateCw size={14} /></button>
        <button className="btn text-red-400" title="Stop & remove" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
      {s.error && <div className="text-xs text-red-400 mt-1">{s.error}</div>}
    </div>
  )
}

function VolumeSlider({ kind, id, volume, mute, onChanged }: {
  kind: string; id: string | number; volume: number; mute: boolean; onChanged: () => void
}) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-[140px]">
      <input
        type="range" min={0} max={150} value={volume}
        className="slider"
        onChange={e => void api.setVolume(kind, id, Number(e.target.value)).then(onChanged)}
      />
      <span className="text-xs text-zinc-400 w-9 text-right">{mute ? 'MUT' : `${volume}%`}</span>
    </div>
  )
}

function DeviceRow({ d, kind, refresh, soloed, onToggleSolo }: {
  d: api.Device; kind: 'sink' | 'source'; refresh: () => void
  soloed: string | null; onToggleSolo: (name: string) => void
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-zinc-800/60 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{d.name}</span>
          {d.virtual && <span className="badge bg-purple-500/20 text-purple-300">virtual</span>}
          {d.monitor && <span className="badge bg-blue-500/20 text-blue-300">desktop audio</span>}
          {d.state !== 'RUNNING' && <span className="badge bg-zinc-700 text-zinc-400">{d.state.toLowerCase()}</span>}
        </div>
      </div>
      <VolumeSlider kind={kind} id={d.name} volume={d.volume} mute={d.mute} onChanged={refresh} />
      <button
        className={d.mute ? 'btn text-red-400' : 'btn'}
        onClick={() => void api.setMute(kind, d.name, !d.mute).then(refresh)}
      >Mute</button>
      <button
        className={soloed === d.name ? 'btn-primary' : 'btn'}
        title="Solo (mute all other strips of this kind)"
        onClick={() => onToggleSolo(d.name)}
      >Solo</button>
      <button
        className={d.isDefault ? 'btn-primary' : 'btn'}
        title="Set as default"
        onClick={() => void api.setDefault(kind, d.name).then(refresh)}
      ><Star size={14} /></button>
    </div>
  )
}

function RoutingMatrix({ sources, sinks, routes, onToggle }: {
  sources: api.Device[]; sinks: api.Device[]; routes: api.Route[]
  onToggle: (source: string, sink: string, enable: boolean) => void
}) {
  const has = (source: string, sink: string) => routes.some(r => r.source === source && r.sink === sink)
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-1 text-left sticky left-0 bg-zinc-900">Source ↓ / Output →</th>
            {sinks.map(s => (
              <th key={s.name} className="p-1 font-normal text-zinc-400 whitespace-nowrap max-w-[90px] truncate" title={s.name}>
                {s.monitor ? '🖥' : ''}{s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map(src => (
            <tr key={src.name} className="border-t border-zinc-800/60">
              <td className="p-1 pr-3 font-medium whitespace-nowrap sticky left-0 bg-zinc-900 max-w-[140px] truncate" title={src.name}>
                {src.monitor ? '🖥 ' : src.virtual ? '🔀 ' : '🎙 '}{src.name}
              </td>
              {sinks.map(snk => (
                <td key={snk.name} className="p-1 text-center">
                  <input
                    type="checkbox"
                    checked={has(src.name, snk.name)}
                    onChange={e => onToggle(src.name, snk.name, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UpdatePanel() {
  const [status, setStatus] = useState<api.UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const check = useCallback((fetchRemote: boolean) => {
    setChecking(true); setErr(null)
    api.getUpdateStatus(fetchRemote).then(setStatus).catch(e => setErr(String(e.message || e))).finally(() => setChecking(false))
  }, [])

  useEffect(() => { check(false) }, [check])

  const apply = () => {
    setApplying(true); setErr(null); setLog([])
    api.applyUpdate()
      .then(r => { setLog(r.log); setRestarting(r.restarting || true); return check(true) })
      .catch(e => setErr(String(e.message || e)))
      .finally(() => setApplying(false))
  }

  return (
    <section className="card">
      <h2 className="font-semibold mb-2 flex items-center gap-2"><GitBranch size={16} className="text-emerald-500" /> Updates <span className="text-xs font-normal text-zinc-500">(pull latest from git, rebuild, restart — no re-clone needed)</span></h2>
      {status && (
        <div className="text-sm text-zinc-400 mb-2 space-y-1">
          <div>branch <span className="text-zinc-200">{status.branch}</span> · current <span className="text-zinc-200 font-mono">{status.current?.short}</span> {status.current && <span className="text-zinc-500">— {status.current.message}</span>}</div>
          {status.latest && status.updateAvailable && (
            <div className="text-yellow-300">
              {status.behind} commit{status.behind === 1 ? '' : 's'} behind origin/{status.branch} · latest <span className="font-mono">{status.latest.short}</span> — {status.latest.message}
            </div>
          )}
          {status.latest && !status.updateAvailable && <div className="text-emerald-400">up to date</div>}
          {status.dirty && <div className="text-red-400">local changes detected — update is disabled until the repo is clean</div>}
          {status.offline && <div className="text-zinc-500">couldn't reach origin (offline?) — showing last known status</div>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button className="btn flex items-center gap-1" disabled={checking} onClick={() => check(true)}>
          <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />Check for updates
        </button>
        <button
          className="btn-primary flex items-center gap-1"
          disabled={applying || !status?.updateAvailable || status?.dirty}
          onClick={apply}
        ><Download size={14} />{applying ? 'Updating…' : 'Update now'}</button>
        {restarting && <span className="text-xs text-emerald-400">restarting — page will reconnect once the service is back up</span>}
      </div>
      {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
      {log.length > 0 && <pre className="mt-2 text-xs bg-zinc-950 border border-zinc-800 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">{log.join('\n')}</pre>}
    </section>
  )
}

export default function App() {
  const [state, setState] = useState<api.State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [combineName, setCombineName] = useState('CombinedOutput')
  const [combineSlaves, setCombineSlaves] = useState<Set<string>>(new Set())
  const [micName, setMicName] = useState('VirtualMic')
  const [micSources, setMicSources] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [soloSink, setSoloSink] = useState<string | null>(null)
  const [soloSource, setSoloSource] = useState<string | null>(null)
  const muteSnapshot = useState(() => new Map<string, boolean>())[0]

  const refresh = useCallback(() => {
    api.getState().then(setState).catch(e => setError(String(e.message || e)))
  }, [])

  function toggleSolo(kind: 'sink' | 'source', devices: api.Device[], soloed: string | null, setSoloed: (v: string | null) => void, name: string) {
    if (soloed === name) {
      for (const d of devices) {
        const prev = muteSnapshot.get(`${kind}:${d.name}`)
        if (prev !== undefined) void api.setMute(kind, d.name, prev)
      }
      setSoloed(null)
    } else {
      for (const d of devices) muteSnapshot.set(`${kind}:${d.name}`, d.mute)
      for (const d of devices) void api.setMute(kind, d.name, d.name !== name)
      setSoloed(name)
    }
    setTimeout(refresh, 150)
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t) } }, [notice])

  if (error) return <div className="p-8 max-w-2xl mx-auto"><div className="card text-red-400">{error}<p className="text-zinc-400 text-sm mt-2">PipeDeck must run on a machine with PipeWire (pactl) available.</p></div></div>
  if (!state) return <div className="p-8 text-center text-zinc-500">Loading…</div>

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, name: string) => {
    const next = new Set(set)
    next.has(name) ? next.delete(name) : next.add(name)
    setter(next)
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><AudioLines className="text-emerald-500" /> PipeDeck</h1>
          <p className="text-sm text-zinc-500">Voicemeeter-style routing for PipeWire · polls every 2s</p>
        </div>
        <div className="flex items-center gap-2">
          {notice && <span className="text-xs text-emerald-400">{notice}</span>}
          <button className="btn" onClick={() => void api.applyProfile().then(a => { setNotice(`Profile: ${a.actions.join('; ') || 'nothing to do'}`); refresh() })}>
            <Layers size={14} className="inline mr-1" />Apply Profile
          </button>
          <button className="btn" onClick={refresh}><RefreshCw size={14} /></button>
        </div>
      </header>

      <section className="card">
        <h2 className="font-semibold mb-2 flex items-center gap-2"><Volume2 size={16} className="text-emerald-500" /> Outputs <span className="text-zinc-500 text-xs font-normal">(A1/A2/A3 hardware bus equivalent — set multiple defaults via combined sink below)</span></h2>
        {state.sinks.map(d => <DeviceRow key={d.name} d={d} kind="sink" refresh={refresh} soloed={soloSink} onToggleSolo={name => toggleSolo('sink', state.sinks, soloSink, setSoloSink, name)} />)}
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2 flex items-center gap-2"><Mic size={16} className="text-emerald-500" /> Inputs / Mics <span className="text-zinc-500 text-xs font-normal">(includes 🖥 desktop-audio monitors)</span></h2>
        {state.sources.map(d => <DeviceRow key={d.name} d={d} kind="source" refresh={refresh} soloed={soloSource} onToggleSolo={name => toggleSolo('source', state.sources, soloSource, setSoloSource, name)} />)}
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2 flex items-center gap-2"><Layers size={16} className="text-emerald-500" /> Routing Matrix <span className="text-xs font-normal text-zinc-500">(Voicemeeter-style — patch any input to any output, any number at once)</span></h2>
        <RoutingMatrix
          sources={state.sources}
          sinks={state.sinks}
          routes={state.routes}
          onToggle={(source, sink, enable) => {
            const p = enable
              ? api.createRoute(source, sink)
              : (() => {
                  const existing = state.routes.find(route => route.source === source && route.sink === sink)
                  return existing ? api.removeRoute(existing.id) : Promise.resolve()
                })()
            void p.then(refresh).catch(e => setNotice(String(e.message || e)))
          }}
        />
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Radio size={16} className="text-emerald-500" /> Playing Apps → route to any output</h2>
        {state.sinkInputs.length === 0 && <p className="text-sm text-zinc-500">No playback streams right now.</p>}
        {state.sinkInputs.map(s => (
          <div key={s.id} className="flex items-center gap-3 py-2 border-b border-zinc-800/60 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{s.app}</div>
              <div className="text-xs text-zinc-500 truncate">{s.media}</div>
            </div>
            <VolumeSlider kind="sink-input" id={s.id} volume={s.volume} mute={s.mute} onChanged={refresh} />
            <select
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
              value={s.target}
              onChange={e => void api.moveStream('sink-input', s.id, e.target.value).then(refresh)}
            >
              {state.sinks.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Mic size={16} className="text-emerald-500" /> Recording Apps → route to any input</h2>
        {state.sourceOutputs.length === 0 && <p className="text-sm text-zinc-500">No recording streams right now.</p>}
        {state.sourceOutputs.map(s => (
          <div key={s.id} className="flex items-center gap-3 py-2 border-b border-zinc-800/60 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{s.app}</div>
              <div className="text-xs text-zinc-500 truncate">{s.media}</div>
            </div>
            <select
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
              value={s.target}
              onChange={e => void api.moveStream('source-output', s.id, e.target.value).then(refresh)}
            >
              {state.sources.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
        ))}
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="card">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><Volume2 size={16} className="text-purple-400" /> Combined Output <span className="text-xs font-normal text-zinc-500">(TV + headset simultaneously)</span></h2>
          <div className="space-y-2 mb-3">
            {state.sinks.filter(d => !d.virtual).map(d => (
              <label key={d.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={combineSlaves.has(d.name)} onChange={() => toggle(combineSlaves, setCombineSlaves, d.name)} />
                {d.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm flex-1" value={combineName} onChange={e => setCombineName(e.target.value)} />
            <button className="btn-primary flex items-center gap-1" disabled={combineSlaves.size < 2}
              onClick={() => void api.createCombinedSink(combineName, [...combineSlaves]).then(() => { setNotice(`Created ${combineName}`); refresh() })}>
              <Plus size={14} />Create
            </button>
          </div>
        </section>

        <section className="card">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><Mic size={16} className="text-purple-400" /> Virtual Mic <span className="text-xs font-normal text-zinc-500">(merge mics → RustDesk/Discord sees one)</span></h2>
          <div className="space-y-2 mb-3">
            {state.sources.filter(d => !d.virtual).map(d => (
              <label key={d.name} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={micSources.has(d.name)} onChange={() => toggle(micSources, setMicSources, d.name)} />
                {d.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm flex-1" value={micName} onChange={e => setMicName(e.target.value)} />
            <button className="btn-primary flex items-center gap-1" disabled={micSources.size < 1}
              onClick={() => void api.createVirtualMic(micName, [...micSources]).then(() => { setNotice(`Created ${micName}`); refresh() })}>
              <Plus size={14} />Create
            </button>
          </div>
        </section>
      </div>

      <section className="card">
        <h2 className="font-semibold mb-2 flex items-center gap-2"><Network size={16} className="text-purple-400" /> Network / VBAN <span className="text-xs font-normal text-zinc-500">(Voicemeeter Potato-style — stream mic/audio to a separate PC)</span></h2>
        {!(state.vban.available.emitter && state.vban.available.receptor) && (
          <div className="text-sm text-yellow-300 bg-yellow-500/10 rounded p-2 mb-3">
            vban_emitter/vban_receptor not found on PATH. Build from{' '}
            <a className="underline" href="https://github.com/quiniouben/vban" target="_blank" rel="noreferrer">quiniouben/vban</a>{' '}
            (re-run <code>install.sh</code> to do it automatically) — streams below will fail to start until then.
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-6 mb-3">
          <VbanForm kind="emitter" sinks={state.sinks} sources={state.sources}
            onCreate={input => void api.createVbanEmitter(input).then(() => { setNotice(`Started emitter ${input.name}`); refresh() })} />
          <VbanForm kind="receptor" sinks={state.sinks} sources={state.sources}
            onCreate={input => void api.createVbanReceptor(input).then(() => { setNotice(`Started receptor ${input.name}`); refresh() })} />
        </div>
        {state.vban.streams.length === 0 && <p className="text-sm text-zinc-500">No VBAN streams configured.</p>}
        {state.vban.streams.map(s => (
          <VbanRow key={s.id} s={s}
            onRestart={() => void api.restartVban(s.id).then(() => { setNotice(`Restarted ${s.name}`); refresh() })}
            onRemove={() => void api.removeVban(s.id).then(() => { setNotice(`Removed ${s.name}`); refresh() })} />
        ))}
      </section>

      <UpdatePanel />

      <section className="card">
        <h2 className="font-semibold mb-2 flex items-center gap-2"><Layers size={16} className="text-emerald-500" /> Loaded Virtual Devices</h2>
        {state.modules.length === 0 && <p className="text-sm text-zinc-500">None loaded.</p>}
        {state.modules.map(m => (
          <div key={m.index} className="flex items-center gap-3 py-1.5 border-b border-zinc-800/60 last:border-0 text-sm">
            <span className="text-zinc-500 w-10">#{m.index}</span>
            <span className="badge bg-zinc-700 text-zinc-300">{m.name.replace('module-', '')}</span>
            <span className="flex-1 truncate text-zinc-400 text-xs">{m.args}</span>
            <button className="btn text-red-400" onClick={() => void api.unloadModule(m.index).then(refresh)}><Trash2 size={14} /></button>
          </div>
        ))}
      </section>
    </div>
  )
}
