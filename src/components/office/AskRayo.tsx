'use client'

import { useState } from 'react'
import { Loader2, Send, Volume2, VolumeX, X, Zap } from 'lucide-react'
import MicButton from '@/components/office/MicButton'
import Markdown from '@/components/office/Markdown'

// Preguntar a Rayo (agente de llamadas) desde el móvil, hablando o
// escribiendo: "¿cómo va Hassa?". La respuesta sale en pantalla y, si se
// quiere, en voz alta.

const RAYO_ID = 't-call'
const SPEAK_KEY = 'rayo-voz'

export default function AskRayo() {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [speak, setSpeak] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem(SPEAK_KEY) === '1' } catch { return false }
  })

  const toggleSpeak = () => {
    const next = !speak
    setSpeak(next)
    try { localStorage.setItem(SPEAK_KEY, next ? '1' : '0') } catch { /* sin almacenamiento */ }
    if (!next) window.speechSynthesis?.cancel()
  }

  const say = (text: string) => {
    if (!speak || !('speechSynthesis' in window)) return
    const plain = text.replace(/[*#_`>|]/g, '').replace(/\n+/g, '. ')
    const u = new SpeechSynthesisUtterance(plain)
    u.lang = 'es-ES'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }

  const ask = async (text?: string) => {
    const q = (text ?? question).trim()
    if (!q || loading) return
    setAsked(q)
    setQuestion('')
    setAnswer('')
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/agents/${RAYO_ID}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      })
      const d = await res.json().catch(() => ({}))
      const content = String(d?.agentMessage?.content || '')
      if (!res.ok && !content) throw new Error(d?.error || `Error ${res.status}`)
      setAnswer(content)
      say(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo preguntar')
    } finally {
      setLoading(false)
    }
  }

  const open = loading || answer || error

  return (
    <>
      <div className="border-t border-slate-200 bg-white px-4 pb-3 pt-3">
        {open && (
          <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700">{asked}</p>
              <button onClick={() => { setAnswer(''); setError(''); window.speechSynthesis?.cancel() }} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[50dvh] overflow-y-auto px-3 py-3 text-[15px] leading-relaxed">
              {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Rayo está mirando el expediente…</div>}
              {error && <p className="text-red-600">{error}</p>}
              {answer && <Markdown text={answer} />}
            </div>
          </div>
        )}
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900"><Zap className="h-3.5 w-3.5 text-amber-500" />Preguntar a Rayo</span>
          <button onClick={toggleSpeak} className="flex items-center gap-1 text-[12px] text-slate-500" title="Leer la respuesta en voz alta">
            {speak ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {speak ? 'En voz alta' : 'Sin voz'}
          </button>
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
          <MicButton disabled={loading} onText={setQuestion} onFinal={(t) => ask(t)} />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask() }}
            placeholder="¿Cómo va Hassa?"
            enterKeyHint="send"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[16px] outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => ask()}
            disabled={loading || !question.trim()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white disabled:opacity-30"
            aria-label="Preguntar"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </>
  )
}
