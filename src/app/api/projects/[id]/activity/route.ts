import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { HIDDEN_LOG_TYPES } from '@/lib/activity'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const logs = await db.activityLog.findMany({
    where: { projectId: id, type: { notIn: HIDDEN_LOG_TYPES } },
    include: {
      agent: { select: { id: true, name: true, avatar: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(logs)
}