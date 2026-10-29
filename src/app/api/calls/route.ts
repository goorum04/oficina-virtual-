import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

// Llamadas guardadas (lo más reciente primero), sin la transcripción entera.
export async function GET() {
  const rows = await db.activityLog.findMany({ where: { type: 'call' }, orderBy: { createdAt: 'desc' }, take: 30 })
  return NextResponse.json(rows.map((r) => {
    const m = JSON.parse(r.metadata || '{}')
    return { id: r.id, titulo: r.message, createdAt: r.createdAt, cliente: m.cliente, durationSec: m.durationSec, final: m.final, savedInGestoria: !!m.gestoriaId }
  }))
}
