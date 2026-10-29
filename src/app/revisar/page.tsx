'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2, PhoneCall } from 'lucide-react'
import { ReviewContent } from '@/components/office/ReviewPanel'
import AskRayo from '@/components/office/AskRayo'
import CallMode from '@/components/office/CallMode'

// Versión para el móvil del panel "Para revisar": a pantalla completa, con
// avisos (Web Push). En iPhone hay que añadirla antes a la pantalla de
// inicio (Compartir → Añadir a pantalla de inicio).

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type PushState = 'unsupported' | 'off' | 'on' | 'working' | 'denied'

export default function RevisarPage() {
  const [push, setPush] = useState<PushState>('off')
  const [hint, setHint] = useState('')
  const [callOpen, setCallOpen] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPush('unsupported')
      return
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      if (Notification.permission === 'denied') setPush('denied')
      else if (await reg.pushManager.getSubscription()) setPush('on')
    }).catch(() => setPush('unsupported'))
  }, [])

  const enable = async () => {
    setPush('working')
    setHint('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPush('denied'); return }
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await fetch('/api/push').then((r) => r.json())
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) })
      if (!res.ok) throw new Error('No se pudo guardar')
      setPush('on')
    } catch (e) {
      setPush('off')
      setHint(e instanceof Error ? e.message : 'No se pudo activar')
    }
  }

  const pushButton = push === 'on' ? (
    <span className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-[12px] font-medium text-emerald-700"><Bell className="h-3.5 w-3.5" />Avisos</span>
  ) : push === 'unsupported' ? (
    <span className="max-w-[9rem] text-right text-[11px] leading-tight text-slate-400">Para avisos: Compartir → Añadir a pantalla de inicio</span>
  ) : push === 'denied' ? (
    <span className="flex items-center gap-1 text-[12px] text-slate-400"><BellOff className="h-3.5 w-3.5" />Avisos bloqueados</span>
  ) : (
    <button onClick={enable} disabled={push === 'working'} className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white">
      {push === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
      Activar avisos
    </button>
  )

  return (
    <div className="relative flex h-[100dvh] flex-col bg-white text-slate-800">
      <ReviewContent action={pushButton} />
      {hint && <p className="border-t border-slate-100 px-4 py-2 text-[12px] text-red-600">{hint}</p>}
      <div className="border-t border-slate-200 bg-white px-4 pt-3">
        <button onClick={() => setCallOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-[15px] font-semibold text-white">
          <PhoneCall className="h-4 w-4" />Escuchar una llamada
        </button>
      </div>
      <AskRayo />
      {callOpen && <CallMode onClose={() => setCallOpen(false)} />}
      <a href="/" className="border-t border-slate-100 bg-white py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-center text-[13px] text-slate-500">Ir a la oficina</a>
    </div>
  )
}
