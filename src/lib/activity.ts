import { db } from '@/lib/db'

// Qué está haciendo cada agente ahora mismo (para verlo en la oficina): una
// fila fija por agente, "act-<id>". Mientras tiene actividad está en su mesa
// trabajando; sin ella se va a la zona de descanso.

const ID = (agentId: string) => `act-${agentId}`
export const ACTIVITY_FRESH_MS = 3 * 60_000

// Filas internas del registro que no son actividad para mostrar (ajustes,
// claves de los avisos, estado de trabajos, elementos de "Para revisar"…).
export const HIDDEN_LOG_TYPES = ['case_state', 'review', 'daily_digest', 'setting', 'push_sub', 'agent_activity', 'odm_try', 'call']

export async function setActivity(agentId: string, text: string): Promise<void> {
  const metadata = JSON.stringify({ text: text.slice(0, 120), at: Date.now() })
  try {
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { projectId: true, status: true } })
    if (!agent) return
    await db.activityLog.upsert({
      where: { id: ID(agentId) },
      create: { id: ID(agentId), type: 'agent_activity', message: 'actividad', metadata, agentId, projectId: agent.projectId },
      update: { metadata },
    })
    if (agent.status !== 'working') await db.agent.update({ where: { id: agentId }, data: { status: 'working' } })
  } catch { /* la actividad es solo para verla: nunca rompe el trabajo */ }
}

export async function clearActivity(agentId: string): Promise<void> {
  try {
    await db.activityLog.deleteMany({ where: { id: ID(agentId) } })
    await db.agent.updateMany({ where: { id: agentId, status: 'working' }, data: { status: 'idle' } })
  } catch { /* idem */ }
}

// Para el equipo entero (el repaso de clientes de Nova).
export async function setActivities(agentIds: string[], text: string): Promise<void> {
  await Promise.all(agentIds.map((id) => setActivity(id, text)))
}

export async function clearActivities(agentIds: string[]): Promise<void> {
  await Promise.all(agentIds.map((id) => clearActivity(id)))
}

// Frase corta para cada herramienta: lo que se ve en el bocadillo.
export function describeTool(name: string, input: Record<string, unknown>): string {
  const file = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() || 'un archivo'
  const s = (v: unknown) => String(v ?? '').slice(0, 60)
  switch (name) {
    case 'pc_leer': return `Leyendo ${file(input.path)}`
    case 'pc_listar': return `Mirando la carpeta ${file(input.path)}`
    case 'pc_buscar': return `Buscando "${s(input.nombre)}" en el PC`
    case 'pc_escribir': return `Guardando ${file(input.path)}`
    case 'pc_mover': return `Moviendo ${file(input.desde)}`
    case 'pc_ejecutar': return 'Ejecutando un comando en el PC'
    case 'pc_subir_a_gestoria': return `Subiendo ${file(input.path)} a GestoriaAD`
    case 'correo_buscar': return `Buscando correos de ${s([].concat((input.terminos as never) ?? []).join(', ') || input.termino)}`
    case 'correo_leer': return 'Leyendo un correo'
    case 'correo_adjunto': return 'Abriendo un adjunto'
    case 'correo_borrador': return `Redactando un correo${input.asunto ? `: ${s(input.asunto)}` : ''}`
    case 'correo_listar': return 'Mirando la bandeja de entrada'
    case 'correo_clasificar': return 'Clasificando correos'
    case 'gestoria_resumen_cliente': return `Repasando el expediente de ${s(input.nombre) || 'un cliente'}`
    case 'gestoria_guardar_documento_generado': return `Redactando: ${s(input.title)}`
    case 'gestoria_completar_ficha': case 'gestoria_actualizar_cliente': return 'Actualizando la ficha del cliente'
    case 'gestoria_actualizar_paso': return 'Actualizando un paso del proceso'
    case 'gestoria_crear_tarea': return `Anotando tarea: ${s(input.title)}`
    case 'oficina_avanzar_caso': return `Encargando el expediente de ${s(input.cliente)}`
  }
  if (name.startsWith('gestoria_')) return 'Consultando GestoriaAD'
  if (name.startsWith('github_')) return 'Trabajando en el código'
  return 'Trabajando'
}
