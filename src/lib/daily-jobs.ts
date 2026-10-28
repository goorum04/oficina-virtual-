import { db } from '@/lib/db'
import { anthropic } from '@/lib/anthropic'
import { gestoriaConfigured, gestoriaFetch } from '@/lib/gestoria'
import { officeProtected } from '@/lib/access'
import { pcConfigured, runPcCommand } from '@/lib/pc'
import { OUTLOOK_ACCOUNT, saveDraft } from '@/lib/mail-tools'
import { clientBriefing } from '@/lib/client-briefing'
import { MODELS } from '@/lib/model-router'
import { calcCostUsd } from '@/lib/pricing'
import { andorraHour } from '@/lib/work-hours'
import { clientFolders, clientsWithoutOdm, findOdmDate } from '@/lib/odm-dates'

// Trabajos de una vez al día (a partir de las 9:00, con las consultas del
// puente del PC). Todo lo que escribe a clientes queda en "Para revisar":
// - Recordatorios de documentación (Dora): sin IA, con el texto de GestoriaAD.
// - Estado del trámite (Nova, los lunes): un correo breve a quien lleva
//   tiempo sin noticias.
// - Agenda: fechas de GestoriaAD → calendario de Outlook, aviso el día antes.

const DOC_AGENT = 't-doc'
const LEAD_ID = 't-pm'
const CLOSED = ['completado', 'cancelado', 'rechazado']
const START_HOUR = 9

const CHASE_AFTER_DAYS = 7
const MAX_CHASERS = 2 // por cliente: suave y luego más directo
const MAX_CHASERS_PER_DAY = 5
const STATUS_SILENCE_DAYS = 21
const MAX_STATUS_PER_WEEK = 5
const CALENDAR_DAYS = 60

type Client = { id: string; firstName: string; lastName: string; email?: string | null; nationality?: string | null }
type Mail = { carpeta?: string; fecha?: string; asunto?: string; extracto?: string }

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Andorra' }).format(new Date())
}

// Estado de cada trabajo del día (una fila por tipo y día). Una petición a
// Vercel dura como mucho 5 minutos y buscar los correos de un cliente tarda
// unos segundos, así que los trabajos largos van por tandas de SLICE_MS y
// la siguiente consulta del puente sigue donde se quedó (cursor).
type JobState = { date: string; finished: boolean; failed?: number; heartbeat: number; cursor: number; out: string[]; extra: string[]; costUsd: number }
type Job = { id: string; raw: string; state: JobState }

const SLICE_MS = 150_000
const STALE_MS = 4 * 60_000 // tanda cortada sin avisar: se retoma
const RETRY_MS = 30 * 60_000 // falló (p. ej. puente antiguo): se reintenta
const MAX_TRIES = 4

async function acquire(type: string): Promise<Job | null> {
  const date = today()
  const row = await db.activityLog.findFirst({ where: { type }, orderBy: { createdAt: 'desc' } })
  let state: JobState | null = null
  try { state = row?.metadata ? (JSON.parse(row.metadata) as JobState) : null } catch { state = null }
  const now = Date.now()
  if (!row || !state || state.date !== date) {
    const lead = await db.agent.findUnique({ where: { id: LEAD_ID }, select: { projectId: true } })
    if (!lead) return null
    const fresh: JobState = { date, finished: false, heartbeat: now, cursor: 0, out: [], extra: [], costUsd: 0 }
    const created = await db.activityLog.create({ data: { type, message: type, metadata: JSON.stringify(fresh), projectId: lead.projectId, agentId: LEAD_ID } })
    return { id: created.id, raw: created.metadata!, state: fresh }
  }
  if (state.finished) return null
  if (state.failed) {
    if (state.failed >= MAX_TRIES || now - state.heartbeat < RETRY_MS) return null
  } else if (now - state.heartbeat < STALE_MS) return null
  // Reclamo atómico: si otra consulta del puente lo cogió antes, nada.
  const next: JobState = { ...state, heartbeat: now }
  const claimed = await db.activityLog.updateMany({ where: { id: row.id, metadata: row.metadata! }, data: { metadata: JSON.stringify(next) } })
  return claimed.count ? { id: row.id, raw: JSON.stringify(next), state: next } : null
}

async function save(job: Job, message?: string): Promise<void> {
  await db.activityLog.update({ where: { id: job.id }, data: { metadata: JSON.stringify(job.state), ...(message ? { message } : {}) } })
}

export async function maybeDailyJobs(aiAllowed = true): Promise<void> {
  if (!gestoriaConfigured() || !officeProtected() || !pcConfigured()) return
  if (andorraHour() < START_HOUR) return
  const cal = await acquire('calendar_sync')
  if (cal) await syncCalendar(cal)
  const chase = await acquire('doc_chasers')
  if (chase) await docChasers(chase)
  if (aiAllowed) {
    const odm = await acquire('odm_dates')
    if (odm) await odmDates(odm)
  }
  const monday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Andorra', weekday: 'short' }).format(new Date()) === 'Mon'
  if (aiAllowed && monday) {
    const status = await acquire('status_reports')
    if (status) await statusReports(status)
  }
}

// Recorre los clientes desde el cursor durante una tanda; devuelve true si
// ha terminado la lista.
async function walk(job: Job, max: number, step: (c: Client) => Promise<void>): Promise<boolean> {
  const clients = (await activeClients()).sort((x, y) => x.id.localeCompare(y.id))
  const deadline = Date.now() + SLICE_MS
  while (job.state.cursor < clients.length && job.state.out.length < max) {
    if (Date.now() > deadline) {
      job.state.heartbeat = 0 // la siguiente consulta del puente sigue
      await save(job)
      return false
    }
    await step(clients[job.state.cursor]).catch(() => {})
    job.state.cursor++
    job.state.heartbeat = Date.now()
    await save(job)
  }
  return true
}

async function activeClients(): Promise<Client[]> {
  const [procs, clients] = await Promise.all([gestoriaFetch('GET', '/api/processes'), gestoriaFetch('GET', '/api/clients')])
  if (!procs.ok || !clients.ok || !Array.isArray(procs.data) || !Array.isArray(clients.data)) return []
  const ids = new Set((procs.data as Array<{ clientId: string; status: string }>).filter((p) => !CLOSED.includes(p.status)).map((p) => p.clientId))
  return (clients.data as Client[]).filter((c) => ids.has(c.id) && c.email)
}

function lang(c: Client): 'fr' | 'es' {
  return /esp|spa|andor/i.test(String(c.nationality || '')) ? 'es' : 'fr'
}

async function mailsWith(c: Client, days: number): Promise<Mail[]> {
  const res = await runPcCommand('mail_search', {
    terminos: [String(c.email).toLowerCase()], desde: new Date(Date.now() - days * 86_400_000).toISOString(), max: 10, cuenta: OUTLOOK_ACCOUNT,
  }, DOC_AGENT, 90_000)
  return res.ok && Array.isArray(res.data) ? (res.data as Mail[]) : []
}

const latest = (mails: Mail[], carpeta: string) => mails.filter((m) => m.carpeta === carpeta).map((m) => new Date(String(m.fecha)).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0]

// ── Recordatorios de documentación ────────────────────────────────────────
async function docChasers(job: Job): Promise<void> {
  const finished = await walk(job, MAX_CHASERS_PER_DAY, async (c) => {
    const missing = await gestoriaFetch('GET', `/api/clients/${c.id}/request-missing`)
    const items = missing.ok ? ((missing.data as { items?: unknown[] }).items ?? []) : []
    if (!items.length) return

    const previous = await db.activityLog.findMany({
      where: { type: 'doc_chaser', metadata: { contains: c.id }, createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
    })
    if (previous[0] && Date.now() - previous[0].createdAt.getTime() < CHASE_AFTER_DAYS * 86_400_000) return

    const mails = await mailsWith(c, 60)
    const sent = latest(mails, 'enviado')
    const received = latest(mails, 'recibido')
    // Solo si ya se le pidió (correo nuestro), hace una semana o más, y no
    // ha contestado desde entonces.
    if (!sent || Date.now() - sent < CHASE_AFTER_DAYS * 86_400_000 || (received && received > sent)) return
    if (previous.length >= MAX_CHASERS) {
      job.state.extra.push(`${c.firstName} ${c.lastName}`)
      return
    }

    const level = previous.length + 1
    const l = lang(c)
    let draft = await gestoriaFetch('POST', `/api/clients/${c.id}/request-missing`, { lang: l, includeUploadLink: true })
    if (!draft.ok) draft = await gestoriaFetch('POST', `/api/clients/${c.id}/request-missing`, { lang: l })
    if (!draft.ok) return
    const { subject, body } = draft.data as { subject: string; body: string }
    const intro = l === 'fr'
      ? (level === 1 ? 'Je me permets de revenir vers vous concernant votre dossier.' : 'Sans retour de votre part, je vous relance car votre dossier est en attente de ces éléments pour avancer.')
      : (level === 1 ? 'Le escribo de nuevo en relación con su expediente.' : 'Al no haber recibido respuesta, le recuerdo que su expediente está parado a la espera de esta documentación.')
    // La despedida de GestoriaAD se quita: Outlook añade la firma al enviar.
    const texto = body.replace(/^(.*\n)/, `$1\n${intro}\n`).replace(/\n(Bien cordialement|Un saludo),[\s\S]*$/, '').trim()
    await saveDraft({ para: c.email, asunto: `${l === 'fr' ? (level === 1 ? 'Rappel' : 'Relance') : 'Recordatorio'} : ${subject}`, texto }, DOC_AGENT, `${c.firstName} ${c.lastName}`)
    const lead = await db.agent.findUnique({ where: { id: LEAD_ID }, select: { projectId: true } })
    if (lead) {
      await db.activityLog.create({
        data: { type: 'doc_chaser', message: `Dora preparó el recordatorio ${level} de documentación a ${c.firstName} ${c.lastName}`, metadata: JSON.stringify({ clientId: c.id, level }), agentId: DOC_AGENT, projectId: lead.projectId },
      })
    }
    job.state.out.push(`${c.firstName} ${c.lastName} (${level}º)`)
  })
  if (!finished) return
  job.state.finished = true
  const { out, extra } = job.state
  await save(job, `Dora: ${out.length ? `recordatorios de documentación para ${out.join(', ')}` : 'ningún recordatorio hoy'}${extra.length ? `; sin respuesta tras ${MAX_CHASERS} recordatorios (mejor llamar): ${extra.join(', ')}` : ''}`)
}

// ── Estado del trámite (lunes) ────────────────────────────────────────────
async function statusReports(job: Job): Promise<void> {
  const finished = await walk(job, MAX_STATUS_PER_WEEK, async (c) => {
    const mails = await mailsWith(c, STATUS_SILENCE_DAYS)
    if (mails.length) return // ha habido contacto hace poco
    const briefing = await clientBriefing(`${c.firstName} ${c.lastName}`, c.id).catch(() => null)
    if (!briefing) return
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: `Eres el gestor de una gestoría en Andorra. Escribe un correo breve (máx. 120 palabras) a ${c.firstName} ${c.lastName}, que lleva semanas sin noticias nuestras, contándole en qué punto está su trámite y el siguiente paso, y qué necesitamos de él si falta algo. Idioma: ${lang(c) === 'fr' ? 'francés' : 'español'}. Tono cercano y profesional, en primera persona; sin firma (se añade sola). Usa solo estos datos; no inventes fechas ni importes:
${JSON.stringify(briefing).slice(0, 5000)}
Responde SOLO con JSON: {"asunto":"…","texto":"…"}`,
      }],
    })
    job.state.costUsd += calcCostUsd('haiku', response.usage.input_tokens, response.usage.output_tokens)
    const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    let out: { asunto?: string; texto?: string } = {}
    try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch { return }
    if (!out.texto) return
    await saveDraft({ para: c.email, asunto: out.asunto || (lang(c) === 'fr' ? 'Point sur votre dossier' : 'Estado de su expediente'), texto: out.texto }, LEAD_ID, `${c.firstName} ${c.lastName}`)
    job.state.out.push(`${c.firstName} ${c.lastName}`)
  })
  if (!finished) return
  job.state.finished = true
  const { out, costUsd } = job.state
  if (costUsd) {
    await db.message.create({
      data: { role: 'agent', model: 'haiku', costUsd, agentId: LEAD_ID, content: `📨 Correos de "así va su trámite" preparados para: ${out.join(', ') || 'nadie'} (en "Para revisar").` },
    })
  }
  await save(job, `Nova: ${out.length ? `estado del trámite para ${out.join(', ')}` : 'nadie sin noticias esta semana'}`)
}

// ── Fecha de inicio (ODM) ──────────────────────────────────────────────────
// Los clientes ya mirados salen de la lista (odm_try), así que cada tanda
// empieza por el principio de lo que queda.
async function odmDates(job: Job): Promise<void> {
  const folders = await clientFolders()
  const deadline = Date.now() + SLICE_MS
  for (const c of await clientsWithoutOdm()) {
    if (Date.now() > deadline) {
      job.state.heartbeat = 0
      await save(job)
      return
    }
    const r = await findOdmDate(c, folders).catch(() => ({ line: null, costUsd: 0 }))
    job.state.costUsd += r.costUsd
    if (r.line) ('saved' in r && r.saved ? job.state.out : job.state.extra).push(r.line)
    job.state.heartbeat = Date.now()
    await save(job)
  }
  job.state.finished = true
  const { out, extra, costUsd } = job.state
  if (out.length || extra.length) {
    await db.message.create({
      data: {
        role: 'agent', model: 'haiku', costUsd, agentId: 't-cli',
        content: `📅 **Fecha de inicio (firma de la ODM)**${out.length ? `\n\nPuesta en GestoriaAD:\n${out.map((l) => `- ${l}`).join('\n')}` : ''}${extra.length ? `\n\nSin fecha (o para revisar):\n${extra.map((l) => `- ${l}`).join('\n')}` : ''}`,
      },
    })
  }
  await save(job, `Clara: fecha de la ODM puesta a ${out.length} cliente(s)${extra.length ? `; ${extra.length} sin ODM o sin fecha` : ''}`)
}

// ── Agenda ────────────────────────────────────────────────────────────────
async function syncCalendar(job: Job): Promise<void> {
  const until = Date.now() + CALENDAR_DAYS * 86_400_000
  const from = Date.now() - 86_400_000
  const inRange = (d?: string | null) => !!d && new Date(d).getTime() >= from && new Date(d).getTime() <= until
  const [tasks, alerts, procs] = await Promise.all([
    gestoriaFetch('GET', '/api/tasks'), gestoriaFetch('GET', '/api/alerts'), gestoriaFetch('GET', '/api/processes'),
  ])
  const events: Array<{ key: string; asunto: string; fecha: string; nota: string }> = []
  for (const t of (tasks.ok && Array.isArray(tasks.data) ? tasks.data : []) as Array<{ id: string; title: string; done: boolean; dueDate?: string; notes?: string }>) {
    if (!t.done && inRange(t.dueDate)) events.push({ key: `task-${t.id}`, asunto: `Tarea: ${t.title}`, fecha: t.dueDate!.slice(0, 10), nota: String(t.notes || '').slice(0, 500) })
  }
  for (const a of (alerts.ok && Array.isArray(alerts.data) ? alerts.data : []) as Array<{ id: string; title: string; isRead: boolean; dueDate?: string; message?: string }>) {
    if (!a.isRead && inRange(a.dueDate)) events.push({ key: `alert-${a.id}`, asunto: a.title, fecha: a.dueDate!.slice(0, 10), nota: String(a.message || '').slice(0, 500) })
  }
  for (const p of (procs.ok && Array.isArray(procs.data) ? procs.data : []) as Array<{ id: string; title: string; status: string; deadline?: string; client?: { firstName?: string; lastName?: string } }>) {
    if (!CLOSED.includes(p.status) && inRange(p.deadline)) {
      events.push({ key: `proc-${p.id}`, asunto: `Fecha límite: ${p.title} — ${p.client?.firstName ?? ''} ${p.client?.lastName ?? ''}`.trim(), fecha: p.deadline!.slice(0, 10), nota: '' })
    }
  }
  const res = await runPcCommand('cal_sync', { eventos: events.slice(0, 80), cuenta: OUTLOOK_ACCOUNT }, LEAD_ID, 120_000)
  if (res.ok) job.state.finished = true
  else job.state.failed = (job.state.failed ?? 0) + 1
  job.state.heartbeat = Date.now()
  await save(job, res.ok ? `Agenda: ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}` : `Agenda: no se pudo sincronizar (${String(res.data).slice(0, 150)})`)
}
