import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  const byAgent = await db.message.groupBy({
    by: ['agentId'],
    where: { costUsd: { not: null } },
    _sum: { costUsd: true },
  })

  const total = byAgent.reduce((sum, a) => sum + (a._sum.costUsd || 0), 0)

  return NextResponse.json({
    total,
    byAgent: Object.fromEntries(byAgent.map(a => [a.agentId, a._sum.costUsd || 0])),
  })
}
