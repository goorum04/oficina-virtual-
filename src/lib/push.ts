import webpush from 'web-push'
import { createHash } from 'crypto'
import { db } from '@/lib/db'

// Avisos al móvil (Web Push). Las claves VAPID se generan la primera vez y
// se guardan en la base de datos; cada móvil que activa los avisos deja su
// suscripción (ActivityLog "push_sub").

const VAPID_ID = 'setting-vapid'

async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  const row = await db.activityLog.findUnique({ where: { id: VAPID_ID } })
  if (row?.metadata) return JSON.parse(row.metadata)
  const keys = webpush.generateVAPIDKeys()
  const lead = await db.agent.findUnique({ where: { id: 't-pm' }, select: { projectId: true } })
  if (!lead) throw new Error('No existe el equipo')
  await db.activityLog.upsert({
    where: { id: VAPID_ID },
    create: { id: VAPID_ID, type: 'setting', message: 'Claves de avisos', metadata: JSON.stringify(keys), projectId: lead.projectId },
    update: {},
  })
  const saved = await db.activityLog.findUnique({ where: { id: VAPID_ID } })
  return JSON.parse(saved!.metadata!)
}

export async function vapidPublicKey(): Promise<string> {
  return (await vapid()).publicKey
}

export async function saveSubscription(sub: webpush.PushSubscription): Promise<void> {
  const id = `push-${createHash('sha1').update(sub.endpoint).digest('hex').slice(0, 24)}`
  const lead = await db.agent.findUnique({ where: { id: 't-pm' }, select: { projectId: true } })
  if (!lead) return
  const metadata = JSON.stringify(sub)
  await db.activityLog.upsert({
    where: { id },
    create: { id, type: 'push_sub', message: 'Móvil con avisos', metadata, projectId: lead.projectId },
    update: { metadata },
  })
}

// Envía un aviso a todos los móviles. "tag" agrupa: un aviso nuevo con el
// mismo tag sustituye al anterior en vez de apilarse.
export async function notify(title: string, body: string, opts: { url?: string; tag?: string } = {}): Promise<void> {
  const subs = await db.activityLog.findMany({ where: { type: 'push_sub' } })
  if (!subs.length) return
  const keys = await vapid()
  webpush.setVapidDetails('mailto:secretariat-and@epona-andorre.com', keys.publicKey, keys.privateKey)
  const payload = JSON.stringify({ title, body, url: opts.url ?? '/revisar', tag: opts.tag })
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(JSON.parse(s.metadata!), payload, { TTL: 12 * 3600 })
    } catch (err) {
      // Suscripción caducada o desinstalada: se olvida.
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await db.activityLog.delete({ where: { id: s.id } }).catch(() => {})
    }
  }))
}

// Aviso de "hay cosas para revisar", como mucho uno cada media hora.
export async function notifyReviewPending(): Promise<void> {
  const last = await db.activityLog.findUnique({ where: { id: 'setting-last-review-push' } })
  if (last && Date.now() - last.createdAt.getTime() < 30 * 60_000) return
  const pending = await db.activityLog.count({ where: { type: 'review', metadata: { contains: '"status":"pending"' } } })
  if (!pending) return
  await db.activityLog.deleteMany({ where: { id: 'setting-last-review-push' } })
  const lead = await db.agent.findUnique({ where: { id: 't-pm' }, select: { projectId: true } })
  if (lead) await db.activityLog.create({ data: { id: 'setting-last-review-push', type: 'setting', message: 'Último aviso de revisión', projectId: lead.projectId } })
  await notify('Para revisar', `${pending} cosa(s) esperan tu visto bueno.`, { tag: 'review' })
}
