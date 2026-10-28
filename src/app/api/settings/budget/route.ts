import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { budgetStatus, setMonthlyLimitEur } from '@/lib/budget'

export async function GET() {
  return NextResponse.json(await budgetStatus())
}

export async function POST(req: Request) {
  const { limitEur } = await req.json().catch(() => ({}))
  const eur = Number(limitEur)
  if (!Number.isFinite(eur) || eur < 1 || eur > 10_000) return NextResponse.json({ error: 'Tope no válido' }, { status: 400 })
  const lead = await db.agent.findUnique({ where: { id: 't-pm' }, select: { projectId: true } })
  if (!lead) return NextResponse.json({ error: 'No existe el equipo' }, { status: 404 })
  await setMonthlyLimitEur(Math.round(eur), lead.projectId)
  return NextResponse.json(await budgetStatus())
}
