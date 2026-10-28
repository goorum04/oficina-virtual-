import { NextResponse } from 'next/server'
import { notify, saveSubscription, vapidPublicKey } from '@/lib/push'

// GET: clave pública para suscribirse. POST: guardar la suscripción del
// móvil (y mandar un aviso de prueba).
export async function GET() {
  return NextResponse.json({ publicKey: await vapidPublicKey() })
}

export async function POST(req: Request) {
  const sub = await req.json().catch(() => null)
  if (!sub?.endpoint || !sub?.keys) return NextResponse.json({ error: 'Suscripción no válida' }, { status: 400 })
  await saveSubscription(sub)
  await notify('Avisos activados', 'Te avisaré cuando haya algo para revisar o algo urgente.', { tag: 'welcome' })
  return NextResponse.json({ ok: true })
}
