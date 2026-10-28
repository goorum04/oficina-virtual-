import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { ACTIVITY_FRESH_MS } from '@/lib/activity'

// Estado en vivo de los agentes (la oficina lo pide cada pocos segundos):
// estado y, si están trabajando, qué están haciendo.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [agents, acts] = await Promise.all([
    db.agent.findMany({ where: { projectId: id }, select: { id: true, status: true } }),
    db.activityLog.findMany({ where: { projectId: id, type: 'agent_activity' }, select: { agentId: true, metadata: true } }),
  ])
  const now = Date.now()
  const activity = new Map<string, string>()
  for (const a of acts) {
    const m = JSON.parse(a.metadata || '{}') as { text?: string; at?: number }
    if (a.agentId && m.text && m.at && now - m.at < ACTIVITY_FRESH_MS) activity.set(a.agentId, m.text)
  }
  return NextResponse.json(agents.map((a) => ({
    id: a.id,
    // "Trabajando" sin nada reciente que contar es un estado que se quedó
    // colgado (p. ej. una petición cortada): se muestra en descanso.
    status: a.status === 'working' && !activity.has(a.id) ? 'idle' : a.status,
    activity: activity.get(a.id) ?? null,
  })))
}
