import { NextResponse } from 'next/server'
import { finishCall, type CallState } from '@/lib/call-assist'

export const maxDuration = 120

// Al colgar: resumen, guardado en la ficha y tareas.
export async function POST(req: Request) {
  const { clientId, cliente, transcript, state, durationSec, liveCostUsd } = await req.json().catch(() => ({}))
  if (typeof transcript !== 'string' || !transcript.trim()) return NextResponse.json({ error: 'La llamada no tiene texto' }, { status: 400 })
  try {
    return NextResponse.json(await finishCall({ clientId, cliente, transcript, state: state as CallState, durationSec: Number(durationSec) || undefined, liveCostUsd: Number(liveCostUsd) || 0 }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 502 })
  }
}
