import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const logs = await db.activityLog.findMany({
    where: { projectId: id },
    include: {
      agent: { select: { id: true, name: true, avatar: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return NextResponse.json(logs)
}