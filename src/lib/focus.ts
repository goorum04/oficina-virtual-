import { db } from '@/lib/db'
import { anthropic } from '@/lib/anthropic'
import { officeProtected } from '@/lib/access'
import { gestoriaConfigured, gestoriaFetch } from '@/lib/gestoria'
import { clientBriefing } from '@/lib/client-briefing'
import { MODELS } from '@/lib/model-router'
import { calcCostUsd } from '@/lib/pricing'

// Clientes prioritarios: cada FOCUS_EVERY_MS (disparado por las consultas
// del puente del PC, o a mano con POST /api/focus/run) se repasan en
// GestoriaAD y cada agente recibe tareas reales de su área en la oficina
// (las que salen de los datos, sin IA). Hugo además trae de HubSpot los
// documentos nuevos de estos clientes. Nova redacta el plan de todos en
// una sola consulta al modelo rápido.

export const FOCUS_CLIENTS: Array<{ name: string; clientId: string | null }> = [
  { name: 'Zekiye Coskun', clientId: 'cmtvn2bot00ldl504ls27v5t6' },
  { name: 'William Belmonte', clientId: 'cmuh1be1f0000jq04tc2fzs1q' },
  { name: 'Seghir Bencheikh', clientId: 'cmtvn2bkj00eol504yniu8szy' },
  { name: 'Nicolas Hassa', clientId: 'cmtvn2bjm00dgl504vt6e8h9l' },
  // No tiene ficha en GestoriaAD (solo carpeta en OneDrive y correos).
  { name: 'Nicolas Bordeau', clientId: null },
  { name: 'Christopher Gonzalez', clientId: 'cmtvn2bmx00icl504ys8pxcfh' },
  { name: 'David Douard', clientId: 'cmtvn2bhy00b0l504en2eb1x2' },
]

const FOCUS_EVERY_MS = 4 * 3600_000
// Las tareas de foco llevan este prefijo: se sustituyen en cada ronda.
const TASK_PREFIX = '★ '
const CLOSED = ['completado', 'cancelado', 'rechazado']

const AGENT = { lead: 't-pm', clients: 't-cli', processes: 't-pro', alerts: 't-ale', docs: 't-doc', hubspot: 't-hs', mail: 't-mail' }

type Briefing = {
  cliente: { nombre: string; riesgo?: string; pep?: string }
  procesos: Array<{
    titulo: string; estado: string; pasosHechos: string; siguientePaso: string | null
    pasosBloqueados: string[]; alertasPendientes: Array<{ titulo: string; cuantas: number; vence: string | null; prioridad: string }>
  }>
  ultimosCorreos: Array<{ fecha: string; sentido: string; asunto: string }>
  faltaDocumentacion: string[] | string
}

type NewTask = { agentId: string; title: string; description: string; priority: string; progress: number }

function surname(name: string): string {
  return name.split(' ').slice(-1)[0].toUpperCase()
}

function tasksFor(name: string, b: Briefing): NewTask[] {
  const who = surname(name)
  const out: NewTask[] = []
  const active = b.procesos.filter((p) => !CLOSED.includes(p.estado))

  for (const p of active) {
    const [done, total] = p.pasosHechos.split('/').map(Number)
    out.push({
      agentId: AGENT.processes,
      title: `${TASK_PREFIX}${who}: ${p.siguientePaso || 'revisar el proceso'}`,
      description: `${p.titulo} · pasos ${p.pasosHechos}${p.pasosBloqueados.length ? ` · bloqueado: ${p.pasosBloqueados.join(', ')}` : ''}`,
      priority: p.pasosBloqueados.length ? 'high' : 'medium',
      progress: total ? Math.round((done / total) * 100) : 0,
    })
  }

  const alerts = active.flatMap((p) => p.alertasPendientes)
  if (alerts.length) {
    out.push({
      agentId: AGENT.alerts,
      title: `${TASK_PREFIX}${who}: ${alerts.reduce((n, a) => n + a.cuantas, 0)} alerta(s) pendiente(s)`,
      description: alerts.map((a) => `${a.titulo}${a.cuantas > 1 ? ` (×${a.cuantas})` : ''}${a.vence ? ` — ${a.vence}` : ''}`).join('\n'),
      priority: alerts.some((a) => a.prioridad === 'urgente') ? 'critical' : 'high',
      progress: 0,
    })
  }

  const missing = Array.isArray(b.faltaDocumentacion) ? b.faltaDocumentacion : []
  if (missing.length) {
    out.push({
      agentId: AGENT.docs,
      title: `${TASK_PREFIX}${who}: pedir ${missing.length} documento(s)`,
      description: missing.join('\n'),
      priority: 'high',
      progress: 0,
    })
  }

  const lastMail = b.ultimosCorreos[0]
  if (lastMail && lastMail.sentido === 'recibido') {
    out.push({
      agentId: AGENT.mail,
      title: `${TASK_PREFIX}${who}: contestar "${String(lastMail.asunto || '').slice(0, 60)}"`,
      description: `Último correo recibido el ${lastMail.fecha} y aún sin respuesta de la gestoría.`,
      priority: 'medium',
      progress: 0,
    })
  }

  if (b.cliente.riesgo === 'alto' || (b.cliente.pep && b.cliente.pep !== 'no')) {
    out.push({
      agentId: AGENT.clients,
      title: `${TASK_PREFIX}${who}: revisar KYC (riesgo ${b.cliente.riesgo}${b.cliente.pep !== 'no' ? ', PEP' : ''})`,
      description: 'Cliente de riesgo alto o PEP: comprobar origen de fondos y documentación UIFAND.',
      priority: 'high',
      progress: 0,
    })
  }
  return out
}

export async function maybeRunFocus(): Promise<void> {
  const last = await db.activityLog.findFirst({ where: { type: 'focus_review' }, orderBy: { createdAt: 'desc' } })
  if (last && Date.now() - last.createdAt.getTime() < FOCUS_EVERY_MS) return
  await runFocusReview()
}

export async function runFocusReview(): Promise<{ ok: boolean; message: string }> {
  if (!gestoriaConfigured() || !officeProtected()) return { ok: false, message: 'GestoriaAD no está conectada' }
  const lead = await db.agent.findUnique({ where: { id: AGENT.lead } })
  if (!lead) return { ok: false, message: 'No existe el equipo de la gestoría' }
  const projectId = lead.projectId

  const log = await db.activityLog.create({
    data: { type: 'focus_review', message: `${lead.name} repasa los clientes prioritarios`, agentId: lead.id, projectId },
  })
  await db.agent.updateMany({ where: { projectId, id: { in: Object.values(AGENT) } }, data: { status: 'working' } })

  try {
    // Hugo: traer de HubSpot los documentos nuevos (solo añade, nunca borra).
    // En paralelo: cada sincronización puede tardar hasta un minuto.
    const synced = await Promise.all(FOCUS_CLIENTS.filter((c) => c.clientId).map((c) =>
      gestoriaFetch('POST', `/api/clients/${c.clientId}/sync-hubspot-documents`).catch(() => null)))
    const hubspotNew = synced.reduce((n, res) => n + (res?.ok ? Number((res.data as { newDocuments?: number })?.newDocuments) || 0 : 0), 0)

    const briefings = await Promise.all(FOCUS_CLIENTS.map(async (c) => ({
      name: c.name,
      briefing: c.clientId ? ((await clientBriefing(c.name, c.clientId)) as Briefing) : null,
    })))

    // Tareas de la oficina: se sustituyen las de la ronda anterior.
    await db.task.deleteMany({ where: { projectId, title: { startsWith: TASK_PREFIX } } })
    const tasks = briefings.flatMap(({ name, briefing }) => (briefing ? tasksFor(name, briefing) : []))
    tasks.push({
      agentId: AGENT.hubspot,
      title: `${TASK_PREFIX}HubSpot: documentos de los clientes prioritarios`,
      description: `Sincronizados ${FOCUS_CLIENTS.filter((c) => c.clientId).length} clientes; ${hubspotNew} documento(s) nuevo(s).`,
      priority: 'low',
      progress: 100,
    })
    for (const { name } of briefings) {
      tasks.push({ agentId: AGENT.lead, title: `${TASK_PREFIX}${surname(name)}: plan de acción`, description: 'Ver el informe de Nova en su chat.', priority: 'medium', progress: 0 })
    }
    await db.task.createMany({
      data: tasks.map((t) => ({ ...t, status: t.progress >= 100 ? 'completed' : 'in_progress', projectId })),
    })

    // Nova: un solo informe con el plan de cada cliente.
    const compact = briefings.map(({ name, briefing }) => briefing
      ? {
          cliente: name,
          procesos: briefing.procesos.filter((p) => !CLOSED.includes(p.estado)).map((p) => ({ proceso: p.titulo, pasos: p.pasosHechos, siguiente: p.siguientePaso, bloqueado: p.pasosBloqueados, alertas: p.alertasPendientes })),
          falta: briefing.faltaDocumentacion,
          ultimoCorreo: briefing.ultimosCorreos[0] ?? null,
        }
      : { cliente: name, nota: 'Sin ficha en GestoriaAD' })
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: `Eres Nova, coordinadora de una gestoría en Andorra. Hoy es ${new Date().toISOString().slice(0, 10)}. Estos son los clientes prioritarios con sus datos de GestoriaAD:
${JSON.stringify(compact)}
Escribe para el humano un plan breve: por cada cliente, 2-3 líneas (estado, lo más urgente y el siguiente paso concreto, y qué compañero lo lleva: Pau procesos, Vera alertas, Dora documentación, Olga correo, Clara KYC). Empieza por el cliente más urgente. Si un cliente no tiene ficha, dilo y sugiere darlo de alta. Sin introducciones.`,
      }],
    })
    const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n')
    const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage
    await db.message.create({ data: { role: 'user', content: '★ Repaso de clientes prioritarios', agentId: lead.id } })
    await db.message.create({
      data: { role: 'agent', content: text, model: 'haiku', inputTokens, outputTokens, costUsd: calcCostUsd('haiku', inputTokens, outputTokens), agentId: lead.id },
    })

    const message = `${lead.name} repasó ${FOCUS_CLIENTS.length} clientes prioritarios: ${tasks.length} tareas repartidas al equipo`
    await db.activityLog.update({ where: { id: log.id }, data: { message } })
    return { ok: true, message }
  } catch (err) {
    const message = `${lead.name} no pudo repasar los clientes prioritarios: ${err instanceof Error ? err.message : 'error'}`
    await db.activityLog.update({ where: { id: log.id }, data: { message } })
    return { ok: false, message }
  } finally {
    await db.agent.updateMany({ where: { projectId, id: { in: Object.values(AGENT) } }, data: { status: 'idle' } })
  }
}
