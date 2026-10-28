import { db } from '@/lib/db'
import { gestoriaFetch } from '@/lib/gestoria'
import { notifyReviewPending } from '@/lib/push'

// "Para revisar": todo lo que los agentes preparan para el humano (borradores
// de correo, documentos redactados, fichas y pasos que han tocado) en una
// sola lista, para aprobar con un clic. Cada elemento es un ActivityLog de
// tipo "review" con los datos en metadata.

export type ReviewKind = 'mail' | 'document' | 'client' | 'step' | 'newclient'
export type ReviewStatus = 'pending' | 'sent' | 'done' | 'discarded'

export type ReviewData = {
  kind: ReviewKind
  status?: ReviewStatus
  cliente?: string
  clientId?: string
  detalle?: string
  // Correo
  texto?: string
  para?: string
  asunto?: string
  draftId?: string
  responderA?: string
  // Documento de GestoriaAD
  docId?: string
  resultado?: string
  // Cliente nuevo propuesto (se crea en GestoriaAD al aprobarlo)
  nuevo?: { firstName: string; lastName: string; email: string; notes?: string }
}

export async function addReview(title: string, data: ReviewData, agentId: string): Promise<void> {
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { projectId: true } })
  if (!agent) return
  await db.activityLog.create({
    data: { type: 'review', message: title.slice(0, 200), metadata: JSON.stringify({ status: 'pending', ...data }), agentId, projectId: agent.projectId },
  })
  await notifyReviewPending().catch(() => {})
}

const names = new Map<string, string>()
export async function clientName(clientId: string | undefined): Promise<string | undefined> {
  if (!clientId) return undefined
  if (names.has(clientId)) return names.get(clientId)
  const res = await gestoriaFetch('GET', `/api/clients/${encodeURIComponent(clientId)}`).catch(() => null)
  const c = res?.ok ? (res.data as { firstName?: string; lastName?: string }) : null
  const name = c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : undefined
  if (name) names.set(clientId, name)
  return name
}

const FIELD_LABEL: Record<string, string> = {
  email: 'Email', phone: 'Teléfono', dateOfBirth: 'Fecha de nacimiento', nationality: 'Nacionalidad', passportNumber: 'Pasaporte/DNI',
  cityOrigin: 'Ciudad de origen', currentCountry: 'País de residencia', currentCity: 'Ciudad de residencia', profession: 'Profesión',
  pepDescription: 'PEP', sourceOfFunds: 'Origen de fondos', sourceOfWealth: 'Origen del patrimonio',
}
const STEP_LABEL: Record<string, string> = { completado: 'completado', bloqueado: 'bloqueado', en_curso: 'en curso', pendiente: 'pendiente' }

// Tras una escritura correcta en GestoriaAD, deja constancia en la lista.
export async function reviewFromGestoriaWrite(tool: string, input: Record<string, unknown>, result: string, agentId: string): Promise<void> {
  const clientId = typeof input.clientId === 'string' ? input.clientId : undefined
  if (tool === 'gestoria_guardar_documento_generado') {
    let docId: string | undefined
    try { docId = (JSON.parse(result) as { id?: string }).id } catch { /* respuesta recortada */ }
    const cliente = await clientName(clientId)
    await addReview(`Documento redactado: ${String(input.title || '')}`, {
      kind: 'document', cliente, clientId, docId, texto: String(input.content || '').slice(0, 20_000),
    }, agentId)
  } else if (tool === 'gestoria_actualizar_cliente') {
    const fields = Object.keys(input).filter((k) => k !== 'clientId' && k !== 'confirmado')
    const cliente = await clientName(clientId)
    await addReview(`Ficha de ${cliente ?? 'cliente'} actualizada`, {
      kind: 'client', cliente, clientId,
      detalle: fields.map((k) => `${FIELD_LABEL[k] ?? k}: ${String(input[k]).slice(0, 200)}`).join('\n'),
    }, agentId)
  } else if (tool === 'gestoria_completar_ficha') {
    let filled: Record<string, unknown> = {}
    try { filled = (JSON.parse(result) as { rellenados?: Record<string, unknown> }).rellenados ?? {} } catch { /* sin detalle */ }
    if (!Object.keys(filled).length) return
    const cliente = await clientName(clientId)
    await addReview(`Ficha de ${cliente ?? 'cliente'} completada (${Object.keys(filled).length} dato(s))`, {
      kind: 'client', cliente, clientId,
      detalle: Object.entries(filled).map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${String(v).slice(0, 200)}`).join('\n'),
    }, agentId)
  } else if (tool === 'gestoria_actualizar_paso') {
    const status = String(input.status || '')
    if (!status) return // solo notas o responsable
    let step = ''
    try { step = String((JSON.parse(result) as { title?: string }).title || '') } catch { /* sin título */ }
    await addReview(`Paso ${step ? `"${step}" ` : ''}marcado como ${STEP_LABEL[status] ?? status}`, {
      kind: 'step', detalle: [input.notes, input.note, input.notas].filter(Boolean).map(String).join('\n') || undefined,
    }, agentId)
  }
}
