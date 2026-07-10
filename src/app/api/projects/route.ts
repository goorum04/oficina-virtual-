import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET() {
  const projects = await db.project.findMany({
    include: {
      _count: { select: { agents: true, tasks: true, logs: true } },
      agents: {
        select: { id: true, name: true, status: true, avatar: true, role: true, brain: true },
      },
      tasks: {
        where: { status: 'in_progress' },
        select: { id: true, title: true, progress: true, priority: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(projects)
}