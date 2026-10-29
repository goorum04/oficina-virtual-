import { NextResponse } from 'next/server'
import { analyzeLive, type CallState } from '@/lib/call-assist'

export const maxDuration = 60

// Actualización en vivo durante la llamada.
export async function POST(req: Request) {
  const { clientId, transcript, state } = await req.json().catch(() => ({}))
  if (typeof transcript !== 'string' || transcript.trim().length < 20) return NextResponse.json({ state: state ?? null, costUsd: 0 })
  try {
    return NextResponse.json(await analyzeLive({ clientId, transcript, state: state as CallState }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 502 })
  }
}
