import { db } from '@/lib/db'
import { bridgeAuthorized } from '@/lib/pc'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return NextResponse.json({ error: 'Token no válido' }, { status: 401 })
  const { id, ok, result } = await req.json()
  if (typeof id !== 'string') return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const updated = await db.pcCommand.updateMany({
    where: { id, status: 'running' },
    data: { status: ok ? 'done' : 'error', result: JSON.stringify(result ?? null), completedAt: new Date() },
  })
  return NextResponse.json({ updated: updated.count })
}
