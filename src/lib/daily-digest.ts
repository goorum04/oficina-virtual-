import { db } from '@/lib/db'
import { gestoriaConfigured, gestoriaFetch } from '@/lib/gestoria'
import { officeProtected } from '@/lib/access'

// Resumen de la mañana (sin IA, coste cero): lo que hizo el equipo desde el
// último resumen, lo que espera aprobación en "Para revisar" y lo urgente
// de GestoriaAD. Se escribe una vez al día, con la primera consulta del
// puente en horario de oficina, en el chat de Nova y arriba del panel.

const LEAD_ID = 't-pm'
const URGENT_DAYS = 3
const RECENT_OVERDUE_DAYS = 14

function andorraDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Andorra' }).format(d)
}

export async function maybeDailyDigest(): Promise<void> {
  const last = await db.activityLog.findFirst({ where: { type: 'daily_digest' }, orderBy: { createdAt: 'desc' } })
  if (last && andorraDate(last.createdAt) === andorraDate()) return
  const lead = await db.agent.findUnique({ where: { id: LEAD_ID } })
  if (!lead) return
  // Se anota antes de escribirlo: así otra consulta del puente no lo repite.
  const log = await db.activityLog.create({ data: { type: 'daily_digest', message: 'Resumen del día', agentId: lead.id, projectId: lead.projectId } })
  const text = await buildDigest(last?.createdAt ?? new Date(Date.now() - 86_400_000))
  await db.activityLog.update({ where: { id: log.id }, data: { metadata: JSON.stringify({ text }) } })
  await db.message.create({ data: { role: 'user', content: '☀️ Resumen del día', agentId: lead.id } })
  await db.message.create({ data: { role: 'agent', content: text, model: 'none', costUsd: 0, agentId: lead.id } })
}

export async function buildDigest(since: Date): Promise<string> {
  const [cases, replies, reviews, spend] = await Promise.all([
    db.activityLog.findMany({ where: { type: 'case_run', createdAt: { gte: since }, metadata: { contains: '"running":false' } }, orderBy: { createdAt: 'asc' } }),
    db.activityLog.findMany({ where: { type: 'auto_reply', createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } }),
    db.activityLog.findMany({ where: { type: 'review', metadata: { contains: '"status":"pending"' } } }),
    db.message.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: since } } }),
  ])
  const caseCost = cases.reduce((n, c) => n + (Number(JSON.parse(c.metadata || '{}').costUsd) || 0), 0)

  const out: string[] = [`## ☀️ Resumen del ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Andorra', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}`]

  const kinds = { mail: 'correos para enviar', document: 'documentos redactados', client: 'fichas actualizadas', step: 'pasos marcados' } as Record<string, string>
  const count: Record<string, number> = {}
  for (const r of reviews) { const k = JSON.parse(r.metadata || '{}').kind; count[k] = (count[k] || 0) + 1 }
  out.push('### Para revisar')
  out.push(reviews.length
    ? Object.entries(count).map(([k, n]) => `- **${n}** ${kinds[k] ?? k}`).join('\n') + '\n\nÁbrelo con el botón **Para revisar** de arriba.'
    : 'Nada pendiente.')

  if (gestoriaConfigured() && officeProtected()) {
    const res = await gestoriaFetch('GET', '/api/alerts').catch(() => null)
    const alerts = (res?.ok && Array.isArray(res.data) ? res.data : []) as Array<{ title: string; isRead: boolean; dueDate?: string | null; priority?: string }>
    // Lo que vence en los próximos días o venció hace poco; lo vencido hace
    // tiempo es un atraso conocido: solo se cuenta.
    const now = Date.now()
    const due = (a: { dueDate?: string | null }) => (a.dueDate ? new Date(a.dueDate).getTime() : null)
    const pending = alerts.filter((a) => !a.isRead)
    const urgent = pending
      .filter((a) => { const d = due(a); return d != null ? d < now + URGENT_DAYS * 86_400_000 && d > now - RECENT_OVERDUE_DAYS * 86_400_000 : a.priority === 'urgente' })
      .sort((a, b) => (due(a) ?? 0) - (due(b) ?? 0))
    const old = pending.filter((a) => { const d = due(a); return d != null && d <= now - RECENT_OVERDUE_DAYS * 86_400_000 }).length
    const seen = new Set<string>()
    const lines = urgent.filter((a) => !seen.has(a.title) && seen.add(a.title)).slice(0, 10).map((a) => {
      const d = due(a)
      if (d == null) return `- ${a.title}`
      const days = Math.round((d - now) / 86_400_000)
      return `- ${a.title} — ${days < 0 ? `**vencida hace ${-days} día(s)**` : days === 0 ? '**hoy**' : `en ${days} día(s)`}`
    })
    if (old) lines.push(`- Además, ${old} alerta(s) vencida(s) hace más de ${RECENT_OVERDUE_DAYS} días sin revisar en GestoriaAD.`)
    out.push('### Urgente')
    out.push(lines.length ? lines.join('\n') : 'Nada urgente en los próximos días.')
  }

  out.push('### Lo que hizo el equipo')
  const done: string[] = []
  for (const c of cases) done.push(`- ${c.message}`)
  if (replies.length) done.push(`- Olga contestó ${replies.length} correo(s) sencillo(s): ${replies.map((r) => r.message.replace(/^.*respondió a /, '')).join('; ')}`)
  out.push(done.length ? done.join('\n') : 'Sin trabajo automático desde el último resumen.')

  const usd = Number(spend._sum.costUsd || 0)
  out.push(`### Gasto\n${(usd * 0.92).toFixed(2).replace('.', ',')} € de IA desde el último resumen${caseCost ? ` (de ellos ${(caseCost * 0.92).toFixed(2).replace('.', ',')} € en expedientes)` : ''}.`)
  return out.join('\n\n')
}
