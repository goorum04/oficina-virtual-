import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { runPcCommand } from '@/lib/pc'
import { gestoriaFetch, toToolText } from '@/lib/gestoria'
import { OUTLOOK_ACCOUNT } from '@/lib/mail-tools'
import type { ReviewData } from '@/lib/review'

export const maxDuration = 120

// Resolver un elemento de "Para revisar":
// - send: enviar el correo (con el texto editado si se pasa "texto").
// - done: visto / aprobado (documentos, fichas, pasos).
// - discard: descartar (borra el borrador de Outlook o el documento de GestoriaAD).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { action, texto } = await req.json().catch(() => ({}))
  const row = await db.activityLog.findUnique({ where: { id } })
  if (!row || row.type !== 'review') return NextResponse.json({ error: 'No existe' }, { status: 404 })
  const data = JSON.parse(row.metadata || '{}') as ReviewData
  if (data.status !== 'pending') return NextResponse.json({ error: 'Ya está resuelto' }, { status: 409 })

  let resultado = ''
  if (action === 'send') {
    if (data.kind !== 'mail') return NextResponse.json({ error: 'Solo se envían correos' }, { status: 400 })
    const body = typeof texto === 'string' && texto.trim() ? texto : data.texto
    const res = await runPcCommand('mail_send_draft', { id: data.draftId, responderA: data.responderA, texto: body, cuenta: OUTLOOK_ACCOUNT }, row.agentId ?? 't-mail', 90_000)
    if (!res.ok) return NextResponse.json({ error: `No se pudo enviar: ${toToolText(res.data)}` }, { status: 502 })
    resultado = toToolText(res.data)
    data.texto = body
    data.status = 'sent'
  } else if (action === 'discard') {
    if (data.kind === 'mail' && data.draftId) {
      const res = await runPcCommand('mail_discard_draft', { id: data.draftId, cuenta: OUTLOOK_ACCOUNT }, row.agentId ?? 't-mail', 60_000)
      resultado = res.ok ? toToolText(res.data) : `El borrador no se pudo borrar de Outlook: ${toToolText(res.data)}`
    } else if (data.kind === 'document' && data.clientId && data.docId) {
      const res = await gestoriaFetch('DELETE', `/api/clients/${encodeURIComponent(data.clientId)}/generated-documents/${encodeURIComponent(data.docId)}`)
      resultado = res.ok ? 'Documento borrado de GestoriaAD' : `No se pudo borrar el documento (${res.status})`
    }
    data.status = 'discarded'
  } else if (action === 'done') {
    data.status = 'done'
  } else {
    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
  }

  data.resultado = resultado || undefined
  await db.activityLog.update({ where: { id }, data: { metadata: JSON.stringify(data) } })
  return NextResponse.json({ ok: true, resultado })
}
