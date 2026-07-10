import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const project = await db.project.findUnique({
    where: { id },
    include: {
      agents: {
        include: {
          tasks: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      tasks: {
        include: {
          agent: { select: { id: true, name: true, avatar: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      logs: {
        include: {
          agent: { select: { id: true, name: true, avatar: true } },
          task: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  })

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  return NextResponse.json(project)
}