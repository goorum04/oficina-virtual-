'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square } from 'lucide-react'

// Dictado por voz con el reconocimiento del navegador (gratis, sin IA de
// pago). Mientras hablas va escribiendo; al callar, envía el mensaje.

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void; stop: () => void
}

const noop = () => () => {}

function hasRecognition(): boolean {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
}

function getRecognition(): Recognition | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

export default function MicButton({ onText, onFinal, disabled }: { onText: (t: string) => void; onFinal: (t: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false)
  // En el servidor no hay micrófono: el botón aparece al hidratar.
  const supported = useSyncExternalStore(noop, hasRecognition, () => false)
  const rec = useRef<Recognition | null>(null)
  const text = useRef('')

  useEffect(() => () => rec.current?.stop(), [])

  if (!supported) return null

  const start = () => {
    const r = getRecognition()
    if (!r) return
    r.lang = 'es-ES'
    r.interimResults = true
    r.continuous = false
    text.current = ''
    r.onresult = (e) => {
      text.current = Array.from(e.results).map((res) => res[0].transcript).join(' ').trim()
      onText(text.current)
    }
    r.onerror = () => setListening(false)
    r.onend = () => {
      setListening(false)
      if (text.current) onFinal(text.current)
    }
    rec.current = r
    setListening(true)
    r.start()
  }

  return (
    <button
      onClick={() => (listening ? rec.current?.stop() : start())}
      disabled={disabled}
      title={listening ? 'Parar' : 'Hablar'}
      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40 ${listening ? 'animate-pulse bg-red-500 text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
    >
      {listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
    </button>
  )
}
