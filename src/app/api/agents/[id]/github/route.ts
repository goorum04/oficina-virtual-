import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { repo } = await req.json()

  if (repo !== null && (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo))) {
    return NextResponse.json({ error: 'repo must be "owner/repo" or null' }, { status: 400 })
  }

  const agent = await db.agent.update({
    where: { id },
    data: { githubRepo: repo },
  })

  return NextResponse.json(agent)
}
