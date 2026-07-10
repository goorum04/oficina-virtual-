import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const tasks = await db.task.findMany({
    where: { projectId: id },
    include: {
      agent: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(tasks)
}