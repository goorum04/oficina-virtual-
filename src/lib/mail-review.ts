import { db } from '@/lib/db'
import { officeProtected } from '@/lib/access'
import { pcConfigured, runPcCommand } from '@/lib/pc'
import { mailToolsFor } from '@/lib/mail-tools'
import { MAIL_AGENT_ID, gestoriaToolsFor } from '@/lib/gestoria-tools'
import { runAgentTurn, systemPromptFor } from '@/lib/agent-turn'
import { MODELS } from '@/lib/model-router'
import { calcCostUsd } from '@/lib/pricing'

// Revisión automática del correo: cada REVIEW_EVERY_MS, mientras el puente
// del PC esté conectado (la dispara /api/pc/poll), la agente de correo lee
// lo nuevo de Outlook, lo clasifica y avisa de lo importante. Sin nadie
// delante solo tiene herramientas de correo y de crear alertas/tareas: nada
// de archivos, comandos ni borrados.

const REVIEW_EVERY_MS = 20 * 60_000
const FIRST_LOOKBACK_MS = 24 * 3600_000
const MAX_MAILS_PER_REVIEW = 15

const AUTO_GESTORIA_TOOLS = [
  'gestoria_buscar_clientes', 'gestoria_listar_procesos', 'gestoria_crear_alerta',
  'gestoria_listar_alertas', 'gestoria_crear_tarea', 'gestoria_listar_tareas',
]
const AUTO_MAIL_TOOLS = ['correo_leer', 'correo_clasificar']

type Mail = { id: string; de?: string; email?: string; asunto?: string; recibido?: string; categorias?: string; extracto?: string }

export async function maybeReviewMail(): Promise<void> {
  if (!pcConfigured() || !officeProtected() || !process.env.ANTHROPIC_API_KEY) return
  const agent = await db.agent.findUnique({ where: { id: MAIL_AGENT_ID } })
  if (!agent) return

  const last = await db.activityLog.findFirst({
    where: { type: 'mail_review', agentId: agent.id },
    orderBy: { createdAt: 'desc' },
  })
  if (last && Date.now() - last.createdAt.getTime() < REVIEW_EVERY_MS) return

  // "Desde cuándo" se arrastra de la última revisión que leyó bien el correo.
  const prevMeta = last?.metadata ? (JSON.parse(last.metadata) as { since?: string; nextSince?: string }) : {}
  const since = prevMeta.nextSince || prevMeta.since || new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString()
  const startedAt = new Date()

  // Se anota antes de empezar: así la siguiente consulta del puente no lanza
  // otra revisión mientras esta sigue en marcha.
  const log = await db.activityLog.create({
    data: {
      type: 'mail_review',
      message: `${agent.name} está revisando el correo`,
      metadata: JSON.stringify({ since }),
      agentId: agent.id,
      projectId: agent.projectId,
    },
  })
  const finish = (message: string, nextSince?: string) =>
    db.activityLog.update({ where: { id: log.id }, data: { message, metadata: JSON.stringify({ since, nextSince: nextSince ?? since }) } })

  const list = await runPcCommand('mail_list', { desde: since, max: 40 }, agent.id, 90_000)
  if (!list.ok) {
    await finish(`${agent.name} no pudo leer el correo: ${String(list.data).slice(0, 200)}`)
    return
  }
  // Un minuto de solape por si llega algo mientras se lista; lo ya
  // clasificado se descarta igualmente.
  const nextSince = new Date(startedAt.getTime() - 60_000).toISOString()
  const pending = ((Array.isArray(list.data) ? list.data : []) as Mail[])
    .filter((m) => !String(m.categorias || '').includes('Gestoría: '))
    .slice(0, MAX_MAILS_PER_REVIEW)
  if (!pending.length) {
    await finish(`${agent.name} revisó el correo: nada nuevo`, nextSince)
    return
  }

  const tools = [
    ...gestoriaToolsFor(agent).filter((t) => AUTO_GESTORIA_TOOLS.includes(t.name)),
    ...mailToolsFor(agent).filter((t) => AUTO_MAIL_TOOLS.includes(t.name)),
  ]
  const request = `Revisión automática del correo (no hay nadie delante; nadie puede confirmarte nada).
Estos son los ${pending.length} correos nuevos sin clasificar:
${JSON.stringify(pending)}
Para cada uno: clasifícalo con correo_clasificar (lee el completo con correo_leer solo si el extracto no basta para decidir). Crea alertas o tareas en GestoriaAD solo para lo que requiera una acción de la gestoría, sin duplicar lo que ya exista. No muevas correos de carpeta.
Termina con un resumen para el humano: primero lo urgente, una línea por correo importante (remitente, asunto, qué hay que hacer) y al final cuántos eran informativos o publicidad.`

  await db.agent.update({ where: { id: agent.id }, data: { status: 'working' } })
  try {
    const { text, inputTokens, outputTokens } = await runAgentTurn({
      model: MODELS.sonnet,
      system: systemPromptFor(agent, [], true, false, true),
      history: [{ role: 'user', content: request }],
      tools,
      agentId: agent.id,
    })
    await db.message.create({
      data: { role: 'user', content: `🔁 Revisión automática: ${pending.length} correo(s) nuevo(s)`, agentId: agent.id },
    })
    await db.message.create({
      data: {
        role: 'agent', content: text, model: 'sonnet', inputTokens, outputTokens,
        costUsd: calcCostUsd('sonnet', inputTokens, outputTokens), agentId: agent.id,
      },
    })
    const firstLine = text.split('\n').find((l) => l.trim())?.replace(/[*#]/g, '').trim() || ''
    await finish(`${agent.name} revisó ${pending.length} correo(s): ${firstLine.slice(0, 160)}`, nextSince)
    await db.agent.update({ where: { id: agent.id }, data: { status: 'idle' } })
  } catch (err) {
    await db.agent.update({ where: { id: agent.id }, data: { status: 'error' } })
    await finish(`${agent.name} falló al revisar el correo: ${err instanceof Error ? err.message : 'desconocido'}`)
  }
}
