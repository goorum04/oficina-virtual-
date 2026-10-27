import { db } from '@/lib/db'
import { bridgeAuthorized } from '@/lib/pc'
import { NextResponse, after } from 'next/server'
import { maybeReviewMail } from '@/lib/mail-review'
import { maybeRunFocus } from '@/lib/focus'
import { maybeRunNextCase } from '@/lib/case-worker'

// La revisión automática del correo corre tras responder (after) y puede
// durar unos minutos.
export const maxDuration = 300

const WAIT_MS = 20_000

// El puente del PC llama aquí sin parar: se registra como conectado y
// espera hasta ~20s a que haya una orden pendiente (long polling), así las
// órdenes llegan casi al instante sin martillear la API.
export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return NextResponse.json({ error: 'Token no válido' }, { status: 401 })
  const { hostname, platform } = await req.json().catch(() => ({}))

  const now = new Date()
  await db.pcBridge.upsert({
    where: { id: 'pc' },
    create: { id: 'pc', lastSeen: now, hostname: hostname ?? null, platform: platform ?? null },
    update: { lastSeen: now, hostname: hostname ?? null, platform: platform ?? null },
  })

  // El puente pregunta sin parar mientras el PC está encendido: se aprovecha
  // como reloj para revisar el correo cada cierto tiempo (ver mail-review).
  after(() => maybeReviewMail().catch((e) => console.error('[mail-review]', e)))
  after(() => maybeRunFocus().catch((e) => console.error('[focus]', e)))
  after(() => maybeRunNextCase().catch((e) => console.error('[case]', e)))

  const deadline = Date.now() + WAIT_MS
  while (true) {
    const next = await db.pcCommand.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } })
    if (next) {
      // Reclamo atómico: si otra petición la cogió antes, se sigue esperando.
      const claimed = await db.pcCommand.updateMany({ where: { id: next.id, status: 'pending' }, data: { status: 'running' } })
      if (claimed.count) {
        return NextResponse.json({ command: { id: next.id, kind: next.kind, payload: JSON.parse(next.payload) } })
      }
    }
    if (Date.now() > deadline) return NextResponse.json({ command: null })
    await new Promise((r) => setTimeout(r, 1000))
  }
}
