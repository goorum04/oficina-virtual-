'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Lightbulb, ListChecks, Loader2, Mic, PhoneOff, Square, X } from 'lucide-react'
import Markdown from '@/components/office/Markdown'

// Modo llamada: el móvil (o el ordenador) escucha la conversación con el
// cliente, el navegador la transcribe (gratis, en el idioma elegido) y Rayo
// va sacando lo importante, avisos y qué responder. Al terminar se resume y
// se guarda en la ficha del cliente.

type CallState = { puntos: string[]; datos: Array<{ campo: string; valor: string }>; alertas: string[]; sugerencias: string[] }
type Client = { id: string; name: string }
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void; stop: () => void
}

const LANGS = [['fr-FR', 'Francés'], ['es-ES', 'Español'], ['en-GB', 'Inglés'], ['ca-ES', 'Catalán']] as const
const ANALYZE_EVERY_MS = 30_000
const MIN_NEW_CHARS = 150

function newRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function CallMode({ onClose }: { onClose: () => void }) {
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const [client, setClient] = useState<Client | null>(null)
  const [lang, setLang] = useState<string>('fr-FR')
  const [phase, setPhase] = useState<'setup' | 'live' | 'saving' | 'done'>('setup')
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [state, setState] = useState<CallState | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [showText, setShowText] = useState(false)
  const [result, setResult] = useState<{ final: { titulo: string; resumen: string; acuerdos: string[]; tareas: Array<{ titulo: string }> }; savedInGestoria: boolean; tareas: number } | null>(null)

  const rec = useRef<Recognition | null>(null)
  const live = useRef(false)
  const textRef = useRef('')
  const stateRef = useRef<CallState | null>(null)
  const analyzedLen = useRef(0)
  const costRef = useRef(0)
  const startedAt = useRef(0)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)

  useEffect(() => {
    fetch('/api/calls/clients').then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const analyze = useCallback(async (force = false) => {
    const text = textRef.current
    if (!force && text.length - analyzedLen.current < MIN_NEW_CHARS) return
    analyzedLen.current = text.length
    setAnalyzing(true)
    try {
      const res = await fetch('/api/calls/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client?.id ?? null, transcript: text, state: stateRef.current }),
      })
      const d = await res.json()
      if (d.state) { stateRef.current = d.state; setState(d.state) }
      costRef.current += Number(d.costUsd) || 0
    } catch { /* el siguiente intento lo recoge */ }
    setAnalyzing(false)
  }, [client])

  // Reloj y análisis periódico mientras dura la llamada.
  useEffect(() => {
    if (phase !== 'live') return
    const tick = setInterval(() => setSeconds(Math.round((Date.now() - startedAt.current) / 1000)), 1000)
    const every = setInterval(() => { analyze() }, ANALYZE_EVERY_MS)
    return () => { clearInterval(tick); clearInterval(every) }
  }, [phase, analyze])

  const listen = () => {
    const r = newRecognition()
    if (!r) { setError('Este navegador no transcribe voz. Usa Chrome o Safari actualizados.'); return }
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let partial = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) {
          textRef.current = `${textRef.current} ${res[0].transcript}`.trim()
          setFinalText(textRef.current)
        } else partial += res[0].transcript
      }
      setInterim(partial)
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        live.current = false
        setError('No hay permiso para el micrófono (o el teléfono lo está usando para la llamada).')
      }
    }
    // El reconocimiento se corta solo tras un silencio: mientras dure la llamada, se reanuda.
    r.onend = () => { if (live.current) { try { r.start() } catch { setTimeout(() => live.current && listen(), 500) } } }
    rec.current = r
    r.start()
  }

  const start = async () => {
    setError('')
    textRef.current = ''
    analyzedLen.current = 0
    costRef.current = 0
    stateRef.current = null
    setFinalText(''); setInterim(''); setState(null)
    startedAt.current = Date.now()
    setSeconds(0)
    live.current = true
    setPhase('live')
    try { wakeLock.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* sin bloqueo de pantalla */ }
    listen()
  }

  const stop = async () => {
    live.current = false
    rec.current?.stop()
    wakeLock.current?.release().catch(() => {})
    const text = textRef.current.trim()
    if (!text) { setPhase('setup'); setError('No se ha captado nada de la conversación.'); return }
    setPhase('saving')
    try {
      const res = await fetch('/api/calls/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client?.id ?? null, cliente: client?.name ?? null, transcript: text, state: stateRef.current,
          durationSec: Math.round((Date.now() - startedAt.current) / 1000), liveCostUsd: costRef.current,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`)
      setResult(d)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
      setPhase('live') // el texto sigue ahí para reintentar
      live.current = false
    }
  }

  useEffect(() => () => { live.current = false; rec.current?.stop() }, [])

  const matches = query.trim().length >= 2
    ? clients.filter((c) => c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))).slice(0, 6)
    : []

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-slate-800">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-slate-900">Escuchar llamada</h3>
          <p className="truncate text-[12px] text-slate-500">{client ? client.name : 'Sin cliente elegido'}{phase === 'live' ? ` · ${mmss(seconds)}` : ''}</p>
        </div>
        {phase !== 'live' && phase !== 'saving' && (
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {phase === 'setup' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-[13px] font-semibold">Cliente</label>
              {client ? (
                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="text-[15px]">{client.name}</span>
                  <button onClick={() => setClient(null)} className="text-[13px] text-slate-500">Cambiar</button>
                </div>
              ) : (
                <>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Escribe su nombre (o déjalo vacío si es nuevo)" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[16px] outline-none focus:border-slate-400" />
                  {matches.map((c) => (
                    <button key={c.id} onClick={() => { setClient(c); setQuery('') }} className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-[15px] hover:bg-slate-100">{c.name}</button>
                  ))}
                </>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-semibold">Idioma de la llamada</label>
              <div className="flex flex-wrap gap-2">
                {LANGS.map(([code, label]) => (
                  <button key={code} onClick={() => setLang(code)} className={`rounded-lg border px-3 py-1.5 text-[14px] ${lang === code ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900">
              <b>Para que oiga a los dos:</b> pon la llamada en <b>altavoz</b> y deja este dispositivo cerca. Si llamas desde este mismo móvil, el teléfono no deja usar el micrófono durante la llamada: abre esta página en el ordenador o en otro móvil.<br />
              Avisa al cliente de que tomas notas de la llamada.
            </div>
            {error && <p className="text-[14px] text-red-600">{error}</p>}
          </div>
        )}

        {(phase === 'live' || phase === 'saving') && (
          <div className="space-y-4">
            {error && <p className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700">{error}</p>}
            <Section icon={Lightbulb} color="text-amber-600" title="Qué decir / soluciones" items={state?.sugerencias} empty={analyzing ? 'Pensando…' : 'Aparecerán mientras habláis.'} big />
            {!!state?.alertas.length && <Section icon={AlertTriangle} color="text-red-600" title="Ojo" items={state.alertas} />}
            <Section icon={ListChecks} color="text-sky-600" title="Lo importante" items={state?.puntos} empty="—" />
            {!!state?.datos.length && (
              <div>
                <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Datos</p>
                <div className="grid grid-cols-1 gap-1">
                  {state.datos.map((d, i) => <p key={i} className="text-[14px]"><span className="text-slate-500">{d.campo}:</span> {d.valor}</p>)}
                </div>
              </div>
            )}
            <button onClick={() => setShowText(!showText)} className="flex items-center gap-1 text-[13px] text-slate-500">
              <ChevronDown className={`h-4 w-4 transition-transform ${showText ? 'rotate-180' : ''}`} />Transcripción ({finalText.split(/\s+/).filter(Boolean).length} palabras)
            </button>
            {showText && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">{finalText} <span className="text-slate-400">{interim}</span></p>}
          </div>
        )}

        {phase === 'done' && result && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-emerald-700"><Check className="h-5 w-5" />Llamada guardada</p>
            <p className="text-[13px] text-slate-500">
              {result.savedInGestoria ? 'En la ficha del cliente (Transcripciones) y en el chat de Rayo.' : 'En el chat de Rayo (el cliente no tiene ficha en GestoriaAD).'}
              {result.tareas ? ` ${result.tareas} tarea(s) creada(s) en GestoriaAD.` : ''}
            </p>
            <div className="rounded-xl border border-slate-200 p-3 text-[14px]">
              <p className="mb-2 font-semibold">{result.final.titulo}</p>
              <Markdown text={`${result.final.resumen}${result.final.acuerdos.length ? `\n\n**Acuerdos**\n${result.final.acuerdos.map((a) => `- ${a}`).join('\n')}` : ''}${result.final.tareas.length ? `\n\n**Tareas**\n${result.final.tareas.map((t) => `- ${t.titulo}`).join('\n')}` : ''}`} />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {phase === 'setup' && (
          <button onClick={start} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[16px] font-semibold text-white"><Mic className="h-5 w-5" />Empezar a escuchar</button>
        )}
        {phase === 'live' && (
          <div className="flex gap-2">
            <button onClick={() => analyze(true)} disabled={analyzing} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-3.5 text-[15px] font-medium disabled:opacity-50">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}Analizar ya
            </button>
            <button onClick={stop} className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-red-600 py-3.5 text-[15px] font-semibold text-white"><PhoneOff className="h-5 w-5" />Terminar y guardar</button>
          </div>
        )}
        {phase === 'saving' && (
          <div className="flex items-center justify-center gap-2 py-3.5 text-[15px] text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />Resumiendo y guardando…</div>
        )}
        {phase === 'done' && (
          <button onClick={onClose} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3.5 text-[16px] font-semibold text-white"><Square className="h-4 w-4" />Cerrar</button>
        )}
      </div>
    </div>
  )
}

function Section({ icon: Icon, color, title, items, empty, big }: {
  icon: typeof Lightbulb; color: string; title: string; items?: string[]; empty?: string; big?: boolean
}) {
  return (
    <div>
      <p className={`mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide ${color}`}><Icon className="h-3.5 w-3.5" />{title}</p>
      {items?.length ? (
        <ul className="space-y-1.5">
          {items.map((t, i) => <li key={i} className={big ? 'rounded-lg bg-amber-50 px-3 py-2 text-[15px] font-medium text-slate-900' : 'text-[14px] leading-snug'}>{big ? t : `• ${t}`}</li>)}
        </ul>
      ) : <p className="text-[13px] text-slate-400">{empty}</p>}
    </div>
  )
}
