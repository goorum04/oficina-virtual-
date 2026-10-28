import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

// Panel "Para revisar": lo pendiente de aprobar, lo último resuelto y el
// resumen de la mañana.
export async function GET() {
  const [pending, recent, digest] = await Promise.all([
    db.activityLog.findMany({
      where: { type: 'review', metadata: { contains: '"status":"pending"' } },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.activityLog.findMany({
      where: { type: 'review', NOT: { metadata: { contains: '"status":"pending"' } } },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    db.activityLog.findFirst({ where: { type: 'daily_digest' }, orderBy: { createdAt: 'desc' } }),
  ])
  const shape = (r: (typeof pending)[number]) => ({
    id: r.id, title: r.message, agent: r.agent?.name ?? null, createdAt: r.createdAt, ...JSON.parse(r.metadata || '{}'),
  })
  return NextResponse.json({
    pending: pending.map(shape),
    recent: recent.map(shape),
    digest: digest?.metadata ? { createdAt: digest.createdAt, text: JSON.parse(digest.metadata).text } : null,
  })
}
