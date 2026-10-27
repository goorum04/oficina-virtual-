import type Anthropic from '@anthropic-ai/sdk'
import { gestoriaConfigured, gestoriaFetch, toToolText } from '@/lib/gestoria'
import { officeProtected } from '@/lib/access'
import { clientBriefing } from '@/lib/client-briefing'

// Herramientas con las que los agentes de la oficina gestionan GestoriaAD.
// Cada agente se encarga de un área (ver AGENT_AREAS) y solo recibe las
// herramientas de su área más las de consulta comunes; el portavoz recibe
// además todas las de consulta de las demás áreas para poder hacer reportes.

export type GestoriaArea = 'coordinacion' | 'clientes' | 'procesos' | 'alertas' | 'documentos' | 'hubspot' | 'bandeja' | 'llamadas'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Input = Record<string, unknown>

interface GestoriaTool {
  area: GestoriaArea | 'comun'
  name: string
  description: string
  properties?: Record<string, unknown>
  required?: string[]
  // Solo lectura: el portavoz las recibe de todas las áreas.
  readOnly?: boolean
  // Borra datos o hace cambios masivos: exige confirmado=true.
  needsConfirmation?: boolean
  request?: (input: Input) => { method: Method; path: string; body?: unknown }
  // Para herramientas que combinan varias llamadas a la API.
  run?: (input: Input) => Promise<unknown>
  // Reduce la respuesta a lo útil antes de pasársela al modelo.
  shape?: (data: unknown) => unknown
}

const id = (v: unknown) => encodeURIComponent(String(v ?? ''))
const str = { type: 'string' }
const date = { type: 'string', description: 'Fecha ISO, p.ej. "2026-11-30"' }

function withoutKeys(input: Input, keys: string[]): Input {
  return Object.fromEntries(Object.entries(input).filter(([k]) => !keys.includes(k)))
}

const clientName = (c: unknown) => {
  const x = c as { firstName?: string; lastName?: string } | null | undefined
  return x ? `${x.firstName ?? ''} ${x.lastName ?? ''}`.trim() : null
}

const CLIENT_FIELDS = {
  firstName: str, lastName: str, email: str, phone: str, dateOfBirth: str,
  nationality: str, passportNumber: str, cityOrigin: str, currentCountry: str,
  currentCity: str, profession: str,
  riskLevel: { type: 'string', enum: ['bajo', 'medio', 'alto'] },
  isPEP: { type: 'boolean' }, pepDescription: str, sourceOfFunds: str, sourceOfWealth: str,
  status: { type: 'string', enum: ['contacto_inicial', 'en_estudio', 'dokumentacion_pendiente', 'en_proceso', 'completado', 'archivado'] },
  notes: str,
  odmDate: date,
}

const PROCESS_STATUS = { type: 'string', enum: ['en_estudio', 'en_curso', 'pendiente_info', 'completado', 'cancelado', 'rechazado'] }
const STEP_STATUS = { type: 'string', enum: ['pendiente', 'en_curso', 'completado', 'bloqueado'] }
const DOC_STATUS = { type: 'string', enum: ['pendiente', 'recibido', 'en_verificacion', 'verificado', 'rechazado', 'caducado'] }
const ALERT_TYPE = { type: 'string', enum: ['vencimiento', 'documento', 'uif', 'informacion', 'error'] }
const ALERT_PRIORITY = { type: 'string', enum: ['baja', 'media', 'alta', 'urgente'] }

const TOOLS: GestoriaTool[] = [
  // ── Común: todos los agentes ──────────────────────────────────────────
  {
    area: 'comun', readOnly: true,
    name: 'gestoria_buscar_clientes',
    description: 'Busca clientes por nombre, apellido o email (vacío = todos). Devuelve id, nombre, estado, riesgo y nº de procesos.',
    properties: { search: str },
    request: (i) => ({ method: 'GET', path: `/api/clients${i.search ? `?search=${id(i.search)}` : ''}` }),
    shape: (d) => (d as Array<Record<string, unknown>>).map((c) => ({
      id: c.id, nombre: clientName(c), email: c.email, estado: c.status, riesgo: c.riskLevel,
      isPEP: c.isPEP, hubspotId: c.hubspotId, procesos: (c._count as { processes?: number })?.processes,
    })),
  },
  {
    area: 'comun', readOnly: true,
    name: 'gestoria_ver_cliente',
    description: 'Ficha completa de un cliente: datos KYC, procesos con sus alertas pendientes, transcripciones y correos.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'GET', path: `/api/clients/${id(i.clientId)}` }),
  },
  {
    area: 'comun', readOnly: true,
    name: 'gestoria_resumen',
    description: 'Cifras generales de la gestoría: procesos activos, alertas pendientes y vencidas, vencimientos a 30 días, documentos pendientes, tareas abiertas.',
    request: () => ({ method: 'GET', path: '/api/stats' }),
  },

  // ── Llamadas: resumen rápido de un cliente ────────────────────────────
  {
    area: 'llamadas', readOnly: true,
    name: 'gestoria_resumen_cliente',
    description: 'Todo lo que hay que saber de un cliente en UNA sola llamada: datos, procesos con su siguiente paso y bloqueos, alertas pendientes, últimos correos, última reunión y documentación que falta. Busca por nombre y/o apellido (o pasa clientId si ya lo tienes).',
    properties: { nombre: { type: 'string', description: 'Nombre, apellido o ambos, tal como lo diga el humano' }, clientId: str },
    run: (i) => clientBriefing(String(i.nombre ?? ''), i.clientId ? String(i.clientId) : undefined),
  },

  // ── Coordinación (portavoz): agenda, tareas del equipo, historial ─────
  {
    area: 'coordinacion', readOnly: true,
    name: 'gestoria_agenda',
    description: 'Todo lo que tiene fecha: alertas sin revisar, fechas límite de procesos activos y caducidades de documentos (vencido + próximos 120 días).',
    request: () => ({ method: 'GET', path: '/api/agenda' }),
  },
  {
    area: 'coordinacion', readOnly: true,
    name: 'gestoria_historial',
    description: 'Historial de cambios (quién hizo qué). Con clientId, solo lo de ese cliente y sus procesos.',
    properties: { clientId: str, limit: { type: 'number' } },
    request: (i) => {
      const q = new URLSearchParams()
      if (i.clientId) q.set('clientId', String(i.clientId))
      q.set('limit', String(i.limit ?? 50))
      return { method: 'GET', path: `/api/audit?${q}` }
    },
  },
  {
    area: 'coordinacion', readOnly: true,
    name: 'gestoria_listar_tareas',
    description: 'Tareas del equipo de la gestoría, pendientes y hechas.',
    request: () => ({ method: 'GET', path: '/api/tasks' }),
  },
  {
    area: 'coordinacion',
    name: 'gestoria_crear_tarea',
    description: 'Anota una tarea para el equipo de la gestoría.',
    properties: { title: str, notes: str, dueDate: date, assignee: { type: 'string', description: 'Persona responsable' } },
    required: ['title'],
    request: (i) => ({ method: 'POST', path: '/api/tasks', body: i }),
  },
  {
    area: 'coordinacion',
    name: 'gestoria_actualizar_tarea',
    description: 'Edita una tarea o la marca como hecha (done=true) / pendiente (done=false).',
    properties: { taskId: str, title: str, notes: str, done: { type: 'boolean' }, dueDate: date, assignee: str },
    required: ['taskId'],
    request: (i) => ({ method: 'PATCH', path: `/api/tasks/${id(i.taskId)}`, body: withoutKeys(i, ['taskId']) }),
  },
  {
    area: 'coordinacion', needsConfirmation: true,
    name: 'gestoria_borrar_tarea',
    description: 'Borra una tarea.',
    properties: { taskId: str }, required: ['taskId'],
    request: (i) => ({ method: 'DELETE', path: `/api/tasks/${id(i.taskId)}` }),
  },

  // ── Clientes y KYC ────────────────────────────────────────────────────
  {
    area: 'clientes',
    name: 'gestoria_crear_cliente',
    description: 'Da de alta un cliente (se crea también en HubSpot automáticamente si está conectado).',
    properties: CLIENT_FIELDS, required: ['firstName', 'lastName'],
    request: (i) => ({ method: 'POST', path: '/api/clients', body: i }),
  },
  {
    area: 'clientes',
    name: 'gestoria_actualizar_cliente',
    description: 'Edita los datos de un cliente (solo los campos que se pasen). Se sincroniza con HubSpot.',
    properties: { clientId: str, ...CLIENT_FIELDS }, required: ['clientId'],
    request: (i) => ({ method: 'PUT', path: `/api/clients/${id(i.clientId)}`, body: withoutKeys(i, ['clientId']) }),
  },
  {
    area: 'clientes', needsConfirmation: true,
    name: 'gestoria_borrar_cliente',
    description: 'Borra un cliente con todos sus procesos, alertas y documentos.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'DELETE', path: `/api/clients/${id(i.clientId)}` }),
  },
  {
    area: 'clientes', readOnly: true,
    name: 'gestoria_que_falta',
    description: 'Lista la documentación que le falta a un cliente.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'GET', path: `/api/clients/${id(i.clientId)}/request-missing` }),
  },
  {
    area: 'clientes',
    name: 'gestoria_redactar_peticion_documentos',
    description: 'Redacta el borrador de correo al cliente pidiendo lo que falta (no lo envía). Opcionalmente incluye un enlace de subida.',
    properties: { clientId: str, lang: { type: 'string', enum: ['fr', 'es'] }, includeUploadLink: { type: 'boolean' } },
    required: ['clientId'],
    request: (i) => ({ method: 'POST', path: `/api/clients/${id(i.clientId)}/request-missing`, body: withoutKeys(i, ['clientId']) }),
  },
  {
    area: 'clientes', readOnly: true,
    name: 'gestoria_enlaces_subida',
    description: 'Enlaces de subida de documentos activos de un cliente.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'GET', path: `/api/clients/${id(i.clientId)}/upload-link` }),
  },
  {
    area: 'clientes',
    name: 'gestoria_crear_enlace_subida',
    description: 'Crea un enlace para que el cliente suba documentos sin usuario (el cliente debe estar vinculado a HubSpot).',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'POST', path: `/api/clients/${id(i.clientId)}/upload-link`, body: {} }),
  },
  {
    area: 'clientes', needsConfirmation: true,
    name: 'gestoria_revocar_enlace_subida',
    description: 'Revoca un enlace de subida.',
    properties: { clientId: str, linkId: str }, required: ['clientId', 'linkId'],
    request: (i) => ({ method: 'DELETE', path: `/api/clients/${id(i.clientId)}/upload-link?linkId=${id(i.linkId)}` }),
  },
  {
    area: 'clientes', readOnly: true,
    name: 'gestoria_transcripciones',
    description: 'Transcripciones de reuniones (de un cliente, o todas).',
    properties: { clientId: str },
    request: (i) => ({ method: 'GET', path: `/api/transcriptions${i.clientId ? `?clientId=${id(i.clientId)}` : ''}` }),
  },

  // ── Procesos (residencias, sociedades, IE…) ───────────────────────────
  {
    area: 'procesos', readOnly: true,
    name: 'gestoria_listar_procesos',
    description: 'Lista procesos (de un cliente o todos) con su estado, fecha límite y avance de pasos.',
    properties: { clientId: str, limit: { type: 'number' } },
    request: (i) => {
      const q = new URLSearchParams()
      if (i.clientId) q.set('clientId', String(i.clientId))
      if (i.limit) q.set('limit', String(i.limit))
      return { method: 'GET', path: `/api/processes?${q}` }
    },
    shape: (d) => (d as Array<Record<string, unknown>>).map((p) => {
      const steps = (p.steps as Array<{ status: string; title: string }>) || []
      return {
        id: p.id, titulo: p.title, tipo: p.type, estado: p.status, cliente: clientName(p.client),
        clientId: p.clientId, fechaLimite: p.deadline,
        pasos: `${steps.filter((s) => s.status === 'completado').length}/${steps.length}`,
        siguientePaso: steps.find((s) => s.status !== 'completado')?.title ?? null,
        alertasPendientes: (p._count as { alerts?: number })?.alerts,
      }
    }),
  },
  {
    area: 'procesos', readOnly: true,
    name: 'gestoria_ver_proceso',
    description: 'Detalle de un proceso con todos sus pasos (ids incluidos), documentos y alertas.',
    properties: { processId: str }, required: ['processId'],
    request: (i) => ({ method: 'GET', path: `/api/processes/${id(i.processId)}` }),
  },
  {
    area: 'procesos', readOnly: true,
    name: 'gestoria_plantillas_proceso',
    description: 'Tipos de proceso disponibles y sus pasos estándar.',
    request: () => ({ method: 'GET', path: '/api/process-templates' }),
  },
  {
    area: 'procesos',
    name: 'gestoria_crear_proceso',
    description: 'Abre un proceso para un cliente; los pasos se crean de la plantilla del tipo. Para sociedades el tipo combina comercial/holding/patrimonial con "_" (p.ej. "comercial_holding").',
    properties: { clientId: str, type: str, title: str }, required: ['clientId', 'type', 'title'],
    request: (i) => ({ method: 'POST', path: '/api/processes', body: i }),
  },
  {
    area: 'procesos',
    name: 'gestoria_actualizar_proceso',
    description: 'Edita un proceso: estado, fecha límite, coste, notas, título.',
    properties: { processId: str, title: str, status: PROCESS_STATUS, deadline: date, startDate: date, completedAt: date, totalCost: { type: 'number' }, notes: str },
    required: ['processId'],
    request: (i) => ({ method: 'PUT', path: `/api/processes/${id(i.processId)}`, body: withoutKeys(i, ['processId']) }),
  },
  {
    area: 'procesos', needsConfirmation: true,
    name: 'gestoria_borrar_proceso',
    description: 'Borra un proceso con sus pasos, documentos y alertas.',
    properties: { processId: str }, required: ['processId'],
    request: (i) => ({ method: 'DELETE', path: `/api/processes/${id(i.processId)}` }),
  },
  {
    area: 'procesos',
    name: 'gestoria_actualizar_paso',
    description: 'Cambia el estado de un paso de proceso (al completarlo se anota en HubSpot) o edita sus notas/responsable.',
    properties: { stepId: str, status: STEP_STATUS, notes: str, title: str, responsible: str },
    required: ['stepId'],
    request: (i) => ({ method: 'PUT', path: `/api/process-steps/${id(i.stepId)}`, body: withoutKeys(i, ['stepId']) }),
  },
  {
    area: 'procesos',
    name: 'gestoria_anadir_pasos',
    description: 'Añade pasos al final de un proceso existente.',
    properties: {
      processId: str,
      steps: { type: 'array', items: { type: 'object', properties: { title: str, description: str, requiredDocs: str, responsible: str }, required: ['title'] } },
    },
    required: ['processId', 'steps'],
    request: (i) => ({ method: 'POST', path: '/api/process-steps', body: i }),
  },
  {
    area: 'procesos', needsConfirmation: true,
    name: 'gestoria_borrar_paso',
    description: 'Borra un paso de un proceso.',
    properties: { stepId: str }, required: ['stepId'],
    request: (i) => ({ method: 'DELETE', path: `/api/process-steps/${id(i.stepId)}` }),
  },

  // ── Alertas y vencimientos ────────────────────────────────────────────
  {
    area: 'alertas', readOnly: true,
    name: 'gestoria_listar_alertas',
    description: 'Lista alertas (por defecto solo las no revisadas) con su cliente y proceso.',
    properties: { incluirRevisadas: { type: 'boolean' } },
    request: () => ({ method: 'GET', path: '/api/alerts' }),
    shape: (d) => (d as Array<Record<string, unknown>>).map((a) => {
      const p = a.process as { title?: string; client?: unknown } | null
      return {
        id: a.id, titulo: a.title, tipo: a.type, prioridad: a.priority,
        vence: typeof a.dueDate === 'string' ? a.dueDate.slice(0, 10) : null,
        revisada: a.isRead, cliente: clientName(p?.client), proceso: p?.title ?? null,
      }
    }),
  },
  {
    area: 'alertas',
    name: 'gestoria_crear_alerta',
    description: 'Crea una alerta (opcionalmente ligada a un proceso). Se anota en HubSpot.',
    properties: { title: str, message: str, type: ALERT_TYPE, priority: ALERT_PRIORITY, dueDate: date, processId: str },
    required: ['title'],
    request: (i) => ({ method: 'POST', path: '/api/alerts', body: i }),
  },
  {
    area: 'alertas',
    name: 'gestoria_actualizar_alerta',
    description: 'Edita una alerta o la marca como revisada (isRead=true).',
    properties: { alertId: str, title: str, message: str, type: ALERT_TYPE, priority: ALERT_PRIORITY, dueDate: date, isRead: { type: 'boolean' } },
    required: ['alertId'],
    request: (i) => ({ method: 'PATCH', path: `/api/alerts/${id(i.alertId)}`, body: withoutKeys(i, ['alertId']) }),
  },
  {
    area: 'alertas',
    name: 'gestoria_marcar_alertas_revisadas',
    description: 'Marca varias alertas como revisadas de una vez.',
    properties: { ids: { type: 'array', items: str } }, required: ['ids'],
    request: (i) => ({ method: 'PATCH', path: '/api/alerts', body: { ids: i.ids } }),
  },
  {
    area: 'alertas', needsConfirmation: true,
    name: 'gestoria_borrar_alerta',
    description: 'Borra una alerta (normalmente basta con marcarla revisada).',
    properties: { alertId: str }, required: ['alertId'],
    request: (i) => ({ method: 'DELETE', path: `/api/alerts/${id(i.alertId)}` }),
  },
  {
    area: 'alertas',
    name: 'gestoria_poner_al_dia_alertas_apostilla',
    description: 'Revisa las alertas de apostilla: marca revisadas las que ya no aplican y corrige títulos desfasados. No borra nada.',
    request: () => ({ method: 'POST', path: '/api/admin/triage-alerts' }),
  },
  {
    area: 'alertas',
    name: 'gestoria_escanear_apostillas',
    description: 'Re-escanea todos los documentos en busca de apostillas y actualiza sus alertas de caducidad.',
    request: () => ({ method: 'POST', path: '/api/admin/scan-apostilles' }),
  },

  // ── Documentación ─────────────────────────────────────────────────────
  {
    area: 'documentos', readOnly: true,
    name: 'gestoria_listar_documentos',
    description: 'Documentos registrados (de un proceso, o todos) con estado y caducidad.',
    properties: { processId: str },
    request: (i) => ({ method: 'GET', path: `/api/documents${i.processId ? `?processId=${id(i.processId)}` : ''}` }),
  },
  {
    area: 'documentos',
    name: 'gestoria_crear_documento',
    description: 'Registra un documento esperado/recibido en un proceso.',
    properties: { title: str, category: str, processId: str, stepId: str }, required: ['title', 'category'],
    request: (i) => ({ method: 'POST', path: '/api/documents', body: i }),
  },
  {
    area: 'documentos',
    name: 'gestoria_actualizar_documento',
    description: 'Cambia estado, caducidad o notas de un documento.',
    properties: { documentId: str, title: str, category: str, status: DOC_STATUS, expiryDate: date, notes: str, stepId: str },
    required: ['documentId'],
    request: (i) => ({ method: 'PUT', path: `/api/documents/${id(i.documentId)}`, body: withoutKeys(i, ['documentId']) }),
  },
  {
    area: 'documentos', needsConfirmation: true,
    name: 'gestoria_borrar_documento',
    description: 'Borra un documento registrado.',
    properties: { documentId: str }, required: ['documentId'],
    request: (i) => ({ method: 'DELETE', path: `/api/documents/${id(i.documentId)}` }),
  },
  {
    area: 'documentos', readOnly: true,
    name: 'gestoria_documentos_analizados',
    description: 'Documentos de HubSpot de un cliente ya analizados por la IA (tipo, datos extraídos, apostilla, caducidad).',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'GET', path: `/api/clients/${id(i.clientId)}/processed-documents` }),
  },
  {
    area: 'documentos', readOnly: true,
    name: 'gestoria_documentos_generados',
    description: 'Documentos redactados desde la app para un cliente (checklists, notas, resúmenes).',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'GET', path: `/api/clients/${id(i.clientId)}/generated-documents` }),
  },
  {
    area: 'documentos',
    name: 'gestoria_guardar_documento_generado',
    description: 'Guarda en la ficha del cliente un documento redactado (nota, checklist, resumen). El agente de escritorio lo baja a la carpeta del cliente.',
    properties: { clientId: str, title: str, content: str, format: { type: 'string', enum: ['md', 'txt'] } },
    required: ['clientId', 'title', 'content'],
    request: (i) => ({ method: 'POST', path: `/api/clients/${id(i.clientId)}/generated-documents`, body: withoutKeys(i, ['clientId']) }),
  },
  {
    area: 'documentos',
    name: 'gestoria_generar_checklist_ie',
    description: 'Genera y guarda el checklist de documentación de Inversió Estrangera de un cliente.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'POST', path: `/api/clients/${id(i.clientId)}/ie-checklist` }),
  },
  {
    area: 'documentos',
    name: 'gestoria_buscar_documentos_nuevos_hubspot',
    description: 'Busca en HubSpot documentos nuevos de un cliente y los añade sin tocar los existentes.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'POST', path: `/api/clients/${id(i.clientId)}/sync-hubspot-documents` }),
  },
  {
    area: 'documentos', readOnly: true,
    name: 'gestoria_estado_analisis_kyc',
    description: 'Cuántos documentos quedan por analizar y cuánto cupo diario de IA queda.',
    request: () => ({ method: 'GET', path: '/api/admin/run-extraction' }),
  },
  {
    area: 'documentos',
    name: 'gestoria_lanzar_analisis_kyc',
    description: 'Empuja la cola de análisis KYC de documentos pendientes (gasta cupo diario de IA compartido con el chatbot).',
    request: () => ({ method: 'POST', path: '/api/admin/run-extraction' }),
  },

  // ── HubSpot ───────────────────────────────────────────────────────────
  {
    area: 'hubspot', readOnly: true,
    name: 'gestoria_estado_hubspot',
    description: 'Si HubSpot está conectado y el estado de la sincronización.',
    request: () => ({ method: 'GET', path: '/api/hubspot/status' }),
  },
  {
    area: 'hubspot', readOnly: true,
    name: 'gestoria_buscar_contactos_hubspot',
    description: 'Busca contactos en HubSpot e indica cuáles ya existen como cliente en la app.',
    properties: { query: str },
    request: (i) => ({ method: 'GET', path: `/api/hubspot/import${i.query ? `?query=${id(i.query)}` : ''}` }),
  },
  {
    area: 'hubspot',
    name: 'gestoria_importar_contactos_hubspot',
    description: 'Importa contactos concretos de HubSpot como clientes (con sus documentos y correos).',
    properties: { contactIds: { type: 'array', items: str }, matchBy: { type: 'string', enum: ['email', 'name'] } },
    required: ['contactIds'],
    request: (i) => ({ method: 'POST', path: '/api/hubspot/import', body: { contactIds: i.contactIds, matchBy: i.matchBy } }),
  },
  {
    area: 'hubspot', needsConfirmation: true,
    name: 'gestoria_importar_todo_hubspot',
    description: 'Importa TODOS los contactos de HubSpot (operación masiva).',
    request: () => ({ method: 'POST', path: '/api/hubspot/import', body: { importAll: true } }),
  },
  {
    area: 'hubspot',
    name: 'gestoria_sincronizar_cliente_desde_hubspot',
    description: 'Trae a la app los cambios de HubSpot de un cliente vinculado.',
    properties: { clientId: str }, required: ['clientId'],
    request: (i) => ({ method: 'POST', path: '/api/hubspot/sync', body: { direction: 'from_hubspot', clientId: i.clientId } }),
  },
  {
    area: 'hubspot', needsConfirmation: true,
    name: 'gestoria_enviar_todo_a_hubspot',
    description: 'Envía a HubSpot todos los clientes de la app (operación masiva).',
    request: () => ({ method: 'POST', path: '/api/hubspot/sync', body: { direction: 'to_hubspot' } }),
  },

  // ── Bandeja de entrada (Outlook) ──────────────────────────────────────
  {
    area: 'bandeja', readOnly: true,
    name: 'gestoria_listar_bandeja',
    description: 'Correos de Outlook que no se han podido asignar a ningún cliente.',
    properties: { status: { type: 'string', enum: ['pendiente', 'archivado', 'asignado'] } },
    request: (i) => ({ method: 'GET', path: `/api/inbox-emails?status=${id(i.status || 'pendiente')}` }),
  },
  {
    area: 'bandeja',
    name: 'gestoria_asignar_correo',
    description: 'Asigna un correo de la bandeja a un cliente (queda en su historial de correos).',
    properties: { emailId: str, clientId: str }, required: ['emailId', 'clientId'],
    request: (i) => ({ method: 'PATCH', path: `/api/inbox-emails/${id(i.emailId)}`, body: { clientId: i.clientId } }),
  },
  {
    area: 'bandeja',
    name: 'gestoria_archivar_correo',
    description: 'Archiva un correo de la bandeja que no corresponde a ningún cliente.',
    properties: { emailId: str }, required: ['emailId'],
    request: (i) => ({ method: 'PATCH', path: `/api/inbox-emails/${id(i.emailId)}`, body: { status: 'archivado' } }),
  },
  {
    area: 'bandeja',
    name: 'gestoria_sincronizar_outlook',
    description: 'Comprueba ahora si han llegado correos nuevos a Outlook.',
    request: () => ({ method: 'POST', path: '/api/outlook/sync' }),
  },
]

const CONFIRM_PROP = {
  confirmado: {
    type: 'boolean',
    description: 'Pon true SOLO si el humano ha confirmado explícitamente en la conversación esta acción concreta.',
  },
}

function toAnthropicTool(t: GestoriaTool): Anthropic.Tool {
  const description = t.needsConfirmation
    ? `${t.description} ACCIÓN IRREVERSIBLE O MASIVA: antes pide confirmación al humano explicando qué vas a hacer, y llama solo cuando haya dicho que sí, con confirmado=true.`
    : t.description
  return {
    name: t.name,
    description,
    input_schema: {
      type: 'object',
      properties: { ...(t.properties || {}), ...(t.needsConfirmation ? CONFIRM_PROP : {}) },
      required: [...(t.required || []), ...(t.needsConfirmation ? ['confirmado'] : [])],
    },
  }
}

// Agente de llamadas: contesta rápido con un resumen del cliente (ver la
// ruta de chat: modelo rápido, sin herramientas del PC).
export const CALL_AGENT_ID = 't-call'

// Agente de correo: lee el Outlook del PC (mail-tools.ts) y además lleva la
// bandeja de correos sin cliente de GestoriaAD.
export const MAIL_AGENT_ID = 't-mail'

// Qué área lleva cada agente del equipo (ids fijos de scripts/seed.ts).
export const AGENT_AREAS: Record<string, GestoriaArea> = {
  't-pm': 'coordinacion',
  't-cli': 'clientes',
  't-pro': 'procesos',
  't-ale': 'alertas',
  't-doc': 'documentos',
  't-hs': 'hubspot',
  [MAIL_AGENT_ID]: 'bandeja',
  [CALL_AGENT_ID]: 'llamadas',
}

// Para avisar de lo que llega por correo, el agente de correo crea alertas
// y tareas (de otras áreas) y consulta lo que ya existe para no duplicar.
const MAIL_AGENT_EXTRA_TOOLS = [
  'gestoria_crear_alerta', 'gestoria_listar_alertas', 'gestoria_crear_tarea', 'gestoria_listar_tareas', 'gestoria_listar_procesos',
]

export const AREA_LABELS: Record<GestoriaArea, string> = {
  coordinacion: 'coordinación del equipo, agenda, tareas e historial de cambios',
  clientes: 'clientes y KYC: altas, datos, documentación que falta y enlaces de subida',
  procesos: 'procesos (residencias, sociedades, IE…) y sus pasos',
  alertas: 'alertas, vencimientos y caducidades',
  documentos: 'documentación: registro, análisis KYC con IA, checklists y documentos redactados',
  hubspot: 'la integración con HubSpot: importaciones y sincronización',
  bandeja: 'el correo de Outlook: revisarlo, clasificarlo y avisar de lo importante (y la bandeja de correos sin cliente de GestoriaAD)',
  llamadas: 'atender llamadas de clientes: resumir al momento cómo va cada cliente',
}

export function gestoriaToolsFor(agent: { id: string; isSpokesperson: boolean }): Anthropic.Tool[] {
  if (!gestoriaConfigured() || !officeProtected()) return []
  const area = AGENT_AREAS[agent.id]
  if (!area) return []
  return TOOLS
    .filter((t) => t.area === 'comun' || t.area === area || (agent.isSpokesperson && t.readOnly) ||
      (area === 'bandeja' && MAIL_AGENT_EXTRA_TOOLS.includes(t.name)))
    .map(toAnthropicTool)
}

export function isGestoriaTool(name: string): boolean {
  return TOOLS.some((t) => t.name === name)
}

export function isGestoriaWriteTool(name: string): boolean {
  const tool = TOOLS.find((t) => t.name === name)
  return Boolean(tool && !tool.readOnly)
}

export async function runGestoriaTool(toolName: string, input: Input): Promise<string> {
  const tool = TOOLS.find((t) => t.name === toolName)
  if (!tool) return `Herramienta desconocida: ${toolName}`
  if (tool.needsConfirmation && input.confirmado !== true) {
    return 'No ejecutado: esta acción necesita la confirmación explícita del humano. Explícale qué vas a hacer y espera su respuesta.'
  }
  try {
    if (tool.run) return toToolText(await tool.run(input))
    const req = tool.request!(withoutKeys(input, ['confirmado']))
    const res = await gestoriaFetch(req.method, req.path, req.body)
    if (!res.ok) return `Error ${res.status} de GestoriaAD: ${toToolText(res.data)}`
    let data = res.data
    // La API devuelve todas las alertas; por defecto solo interesan las pendientes.
    if (toolName === 'gestoria_listar_alertas' && Array.isArray(data) && input.incluirRevisadas !== true) {
      data = data.filter((a: { isRead?: boolean }) => !a.isRead)
    }
    return toToolText(tool.shape ? tool.shape(data) : data)
  } catch (err) {
    return `Error llamando a GestoriaAD (${toolName}): ${err instanceof Error ? err.message : 'desconocido'}`
  }
}

// Herramientas concretas por nombre (para el gestor de caso, que no es un
// agente con área fija).
export function gestoriaToolsByName(names: string[]): Anthropic.Tool[] {
  if (!gestoriaConfigured() || !officeProtected()) return []
  return TOOLS.filter((t) => names.includes(t.name)).map(toAnthropicTool)
}
