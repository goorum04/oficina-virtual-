'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, FileText, Loader2, Mail, Pencil, Send, Trash2, UserPlus, UserRound, X, ListChecks, Sun } from 'lucide-react'
import Markdown from '@/components/office/Markdown'

// Panel "Para revisar": lo que preparan los agentes, para aprobar con un clic.

export type ReviewItem = {
  id: string
  title: string
  agent: string | null
  createdAt: string
  kind: 'mail' | 'document' | 'client' | 'step' | 'newclient'
  status: 'pending' | 'sent' | 'done' | 'discarded'
  cliente?: string
  detalle?: string
  texto?: string
  para?: string
  asunto?: string
  resultado?: string
}

type ReviewData = { pending: ReviewItem[]; recent: ReviewItem[]; digest: { createdAt: string; text: string } | null }

const KIND = {
  mail: { icon: Mail, label: 'Correo', color: 'text-sky-600 bg-sky-50' },
  document: { icon: FileText, label: 'Documento', color: 'text-violet-600 bg-violet-50' },
  client: { icon: UserRound, label: 'Ficha', color: 'text-emerald-600 bg-emerald-50' },
  step: { icon: ListChecks, label: 'Paso', color: 'text-amber-600 bg-amber-50' },
  newclient: { icon: UserPlus, label: 'Cliente nuevo', color: 'text-rose-600 bg-rose-50' },
} as const

const STATUS_LABEL: Record<string, string> = { sent: 'Enviado', done: 'Visto', discarded: 'Descartado' }

function when(iso: string): string {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 60) return `hace ${Math.max(mins, 1)} min`
  if (mins < 24 * 60) return `hace ${Math.round(mins / 60)} h`
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export function useReviewCount(): [number, () => void] {
  const [count, setCount] = useState(0)
  const refresh = useCallback(() => {
    fetch('/api/review').then((r) => (r.ok ? r.json() : null)).then((d: ReviewData | null) => d && setCount(d.pending.length)).catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])
  return [count, refresh]
}

export default function ReviewPanel({ onClose, onChange }: { onClose: () => void; onChange?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      className="absolute top-3 right-3 bottom-3 z-40 w-[calc(100vw-1.5rem)] sm:w-[560px]"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.35)]">
        <ReviewContent
          onChange={onChange}
          action={(
            <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          )}
        />
      </div>
    </motion.div>
  )
}

// Contenido del panel: lo usan el panel de la oficina y la página /revisar
// del móvil.
export function ReviewContent({ onChange, action }: { onChange?: () => void; action?: React.ReactNode }) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [tab, setTab] = useState<'pending' | 'digest'>('pending')

  const load = useCallback(() => {
    fetch('/api/review').then((r) => r.json()).then(setData).catch(() => setData({ pending: [], recent: [], digest: null }))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const resolved = () => { load(); onChange?.() }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-slate-900">Para revisar</h3>
          <p className="text-[13px] text-slate-500">Lo que ha preparado el equipo. Nada se envía sin tu visto bueno.</p>
        </div>
        {action}
      </div>

      <div className="flex gap-1 border-b border-slate-100 px-4 pt-2">
        {([['pending', `Pendiente${data ? ` (${data.pending.length})` : ''}`], ['digest', 'Resumen del día']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-t-lg px-3 py-2 text-[13px] font-medium ${tab === k ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50/60 px-4 py-4">
        {!data ? (
          <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : tab === 'digest' ? (
          <div className="space-y-3">
            <BudgetBar />
            {data.digest ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-[14px]">
                <Markdown text={data.digest.text} />
              </div>
            ) : (
              <Empty icon={Sun} text="El resumen se escribe cada mañana a las 8:00." />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {data.pending.length === 0 && <Empty icon={Check} text="Todo revisado. Cuando el equipo prepare algo, aparecerá aquí." />}
            {data.pending.map((item) => <Card key={item.id} item={item} onResolved={resolved} />)}
            {data.recent.length > 0 && (
              <>
                <p className="pt-3 text-[12px] font-medium uppercase tracking-wide text-slate-400">Resuelto hace poco</p>
                {data.recent.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-slate-500">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{STATUS_LABEL[item.status] ?? item.status}</span>
                    <span className="truncate">{item.title}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// Gasto del mes frente al tope que fija el humano.
function BudgetBar() {
  const [b, setB] = useState<{ spentEur: number; limitEur: number } | null>(null)
  const [edit, setEdit] = useState('')
  useEffect(() => { fetch('/api/settings/budget').then((r) => r.json()).then(setB).catch(() => {}) }, [])
  if (!b) return null
  const pct = Math.min(100, Math.round((b.spentEur / b.limitEur) * 100))
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
  const save = async () => {
    const res = await fetch('/api/settings/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limitEur: Number(edit) }) })
    if (res.ok) { setB(await res.json()); setEdit('') }
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-900">Gasto de IA este mes</span>
        <span className="text-slate-600">{b.spentEur.toFixed(2).replace('.', ',')} € de {b.limitEur} €</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-slate-500">
        {pct >= 100 ? 'Tope alcanzado: el equipo no trabaja solo hasta el mes que viene (el chat sigue funcionando).' : 'Al 80 % te aviso; al 100 % el equipo deja de trabajar solo.'}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={edit}
          onChange={(e) => setEdit(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Nuevo tope (€)"
          inputMode="numeric"
          className="w-32 rounded-lg border border-slate-200 px-2 py-1 outline-none focus:border-slate-400"
        />
        <button onClick={save} disabled={!edit} className="rounded-lg bg-slate-900 px-3 py-1 font-medium text-white disabled:opacity-40">Guardar</button>
      </div>
    </div>
  )
}

function Empty({ icon: Icon, text }: { icon: typeof Check; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-[14px] text-slate-500">
      <Icon className="h-6 w-6 text-slate-300" />
      {text}
    </div>
  )
}

function Card({ item, onResolved }: { item: ReviewItem; onResolved: () => void }) {
  const k = KIND[item.kind] ?? KIND.step
  const [open, setOpen] = useState(item.kind === 'mail')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.texto ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const act = async (action: 'send' | 'done' | 'discard' | 'create') => {
    if (action === 'send' && !confirm(`¿Enviar este correo${item.cliente ? ` a ${item.cliente}` : ''}?`)) return
    setBusy(action)
    setError('')
    try {
      const res = await fetch(`/api/review/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, texto: editing ? text : undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`)
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${k.color}`}><k.icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium leading-snug text-slate-900">{item.title}</span>
          <span className="mt-0.5 block text-[12px] text-slate-500">
            {k.label}{item.cliente ? ` · ${item.cliente}` : ''}{item.agent ? ` · ${item.agent}` : ''} · {when(item.createdAt)}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {item.kind === 'mail' && (
            editing ? (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                className="w-full resize-y rounded-lg border border-slate-200 p-3 text-[14px] leading-relaxed outline-none focus:border-slate-400"
              />
            ) : (
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">{item.texto}</p>
            )
          )}
          {item.kind === 'document' && item.texto && (
            <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-slate-50 p-3 text-[13px]"><Markdown text={item.texto} /></div>
          )}
          {item.detalle && <p className="whitespace-pre-wrap text-[13px] text-slate-600">{item.detalle}</p>}
          {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.kind === 'mail' ? (
              <>
                <Btn primary onClick={() => act('send')} busy={busy === 'send'} icon={Send}>Enviar</Btn>
                <Btn onClick={() => setEditing(!editing)} icon={Pencil}>{editing ? 'Ver' : 'Editar'}</Btn>
              </>
            ) : item.kind === 'newclient' ? (
              <Btn primary onClick={() => act('create')} busy={busy === 'create'} icon={UserPlus}>Crear ficha</Btn>
            ) : (
              <Btn primary onClick={() => act('done')} busy={busy === 'done'} icon={Check}>{item.kind === 'document' ? 'Aprobar' : 'Visto'}</Btn>
            )}
            {(item.kind === 'mail' || item.kind === 'document') && (
              <Btn onClick={() => confirm('¿Descartar? Se borrará.') && act('discard')} busy={busy === 'discard'} icon={Trash2} danger>Descartar</Btn>
            )}
            {item.kind === 'newclient' && (
              <Btn onClick={() => act('discard')} busy={busy === 'discard'} icon={X} danger>No es cliente</Btn>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Btn({ children, onClick, busy, icon: Icon, primary, danger }: {
  children: React.ReactNode; onClick: () => void; busy?: boolean; icon: typeof Check; primary?: boolean; danger?: boolean
}) {
  const style = primary
    ? 'bg-slate-900 text-white hover:bg-slate-700'
    : danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100 border border-slate-200'
  return (
    <button onClick={onClick} disabled={busy} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium disabled:opacity-60 ${style}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  )
}
