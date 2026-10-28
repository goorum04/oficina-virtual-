import type Anthropic from '@anthropic-ai/sdk'
import { toToolText } from '@/lib/gestoria'
import { officeProtected } from '@/lib/access'
import { pcConfigured, runPcCommand } from '@/lib/pc'
import { MAIL_AGENT_ID } from '@/lib/gestoria-tools'
import type { ToolOutput } from '@/lib/pc-tools'
import { OFFICE_EXTS, officeText } from '@/lib/office-text'
import { addReview } from '@/lib/review'
import { pdfForModel } from '@/lib/pdf-pages'

// Correo de Outlook leído en el propio PC a través del puente (órdenes
// mail_* de pc-bridge, que usan el Outlook de escritorio). Son órdenes fijas
// —leer, clasificar con una categoría, mover a una carpeta—, no comandos
// libres: no necesitan confirmación y la revisión automática puede usarlas
// sola. Nunca envían ni borran correos.

// Buzón de la gestoría que revisa Olga (en el Outlook del PC hay más cuentas).
export const OUTLOOK_ACCOUNT = 'secretariat-and@epona-andorre.com'

export const MAIL_CATEGORIES = [
  'Gestoría: Urgente',
  'Gestoría: Cliente',
  'Gestoría: Banco/Notaría',
  'Gestoría: Administración',
  'Gestoría: Facturas',
  'Gestoría: Informativo',
  'Gestoría: Publicidad',
]

const TOOLS: Array<Anthropic.Tool & { readOnly?: boolean }> = [
  {
    name: 'correo_listar',
    readOnly: true,
    description: `Lista los correos de la bandeja de entrada de ${OUTLOOK_ACCOUNT} en Outlook (los más recientes primero): id, remitente, asunto, fecha, si está leído, categorías y un extracto.`,
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Solo los recibidos a partir de esta fecha ISO (p.ej. "2026-10-27T08:00")' },
        max: { type: 'number', description: 'Máximo de correos (por defecto 20, tope 50)' },
        soloNoLeidos: { type: 'boolean' },
      },
    },
  },
  {
    name: 'correo_cuentas',
    readOnly: true,
    description: 'Cuentas de correo configuradas en el Outlook del PC: nombre, nº de correos en la bandeja de entrada y fecha del último recibido.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'correo_leer',
    readOnly: true,
    description: 'Lee un correo completo: texto, destinatarios y nombres de los adjuntos.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'correo_clasificar',
    description: 'Pone una categoría de Outlook a un correo (se ve de color en Outlook). Sustituye la categoría "Gestoría: …" anterior si la había.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, categoria: { type: 'string', enum: MAIL_CATEGORIES } },
      required: ['id', 'categoria'],
    },
  },
  {
    name: 'correo_mover',
    description: 'Mueve un correo a una subcarpeta de la bandeja de entrada (la crea si no existe), p.ej. "Clientes/Coskun" o "Publicidad".',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, carpeta: { type: 'string' } },
      required: ['id', 'carpeta'],
    },
  },
  {
    name: 'correo_buscar',
    readOnly: true,
    description: 'Busca los correos con un cliente en RECIBIDOS y ENVIADOS (lo que nos ha mandado y lo que le hemos pedido), por apellido, nombre o email en remitente, destinatarios o asunto. Devuelve id, carpeta, fecha, asunto, adjuntos y extracto.',
    input_schema: {
      type: 'object',
      properties: {
        terminos: { type: 'array', items: { type: 'string' }, description: 'Apellido, email o palabras clave (mín. 3 letras), p.ej. ["bencheikh", "ralte"]' },
        desde: { type: 'string', description: 'Fecha ISO desde la que buscar (por defecto, últimos 6 meses)' },
        max: { type: 'number', description: 'Máximo de correos (por defecto 15, tope 40)' },
      },
      required: ['terminos'],
    },
  },
  {
    name: 'correo_adjunto',
    readOnly: true,
    description: 'Abre un adjunto de un correo (PDF e imágenes se ven directamente; de Excel y Word se lee el texto; máx. 3 MB). indice empieza en 1, en el orden de la lista "adjuntos".',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, indice: { type: 'number' } },
      required: ['id', 'indice'],
    },
  },
  {
    name: 'correo_borrador',
    description: 'Deja un BORRADOR en Outlook (nunca se envía; el humano lo revisa y lo manda). Con responderA (id de un correo) es una respuesta a todos en ese hilo; si no, un correo nuevo a "para".',
    input_schema: {
      type: 'object',
      properties: {
        responderA: { type: 'string', description: 'id del correo al que se responde' },
        para: { type: 'string' },
        asunto: { type: 'string' },
        texto: { type: 'string', description: 'Texto completo del correo, en el idioma del cliente' },
      },
      required: ['texto'],
    },
  },
]

export function mailToolsFor(agent: { id: string }): Anthropic.Tool[] {
  if (agent.id !== MAIL_AGENT_ID || !pcConfigured() || !officeProtected()) return []
  return TOOLS.map(({ readOnly: _readOnly, ...tool }) => tool)
}

export function isMailTool(name: string): boolean {
  return TOOLS.some((t) => t.name === name)
}

export function isMailWriteTool(name: string): boolean {
  return TOOLS.some((t) => t.name === name && !t.readOnly)
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

export async function runMailTool(name: string, input: Record<string, unknown>, agentId: string): Promise<ToolOutput> {
  if (name === 'correo_adjunto') {
    const res = await runPcCommand('mail_attachment', { ...input, cuenta: OUTLOOK_ACCOUNT }, agentId, 90_000)
    if (!res.ok) return `Error en el PC: ${toToolText(res.data)}`
    const file = res.data as { name: string; size: number; base64: string }
    const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()
    if (ext === '.pdf') {
      const pdf = await pdfForModel(file.base64)
      const blocks: Exclude<ToolOutput, string> = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 } }]
      if (pdf.note) blocks.push({ type: 'text', text: pdf.note.replace(/ Para otras.*$/, '') })
      return blocks
    }
    if (IMAGE_TYPES[ext]) return [{ type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext] as 'image/png', data: file.base64 } }]
    if (['.txt', '.csv', '.md'].includes(ext)) return Buffer.from(file.base64, 'base64').toString('utf8').slice(0, 30_000)
    if (OFFICE_EXTS.includes(ext)) return `Contenido de "${file.name}":\n${officeText(file.name, file.base64)}`
    return `Adjunto "${file.name}" (${file.size} bytes): formato que no se puede leer directamente (pídelo en PDF si hace falta).`
  }
  const kind = {
    correo_listar: 'mail_list',
    correo_cuentas: 'mail_accounts',
    correo_leer: 'mail_read',
    correo_clasificar: 'mail_categorize',
    correo_mover: 'mail_move',
    correo_buscar: 'mail_search',
  }[name]
  if (name === 'correo_borrador') return saveDraft(input, agentId)
  if (!kind) return `Herramienta desconocida: ${name}`
  if (name === 'correo_clasificar' && !MAIL_CATEGORIES.includes(String(input.categoria))) {
    return `Error: categoría no válida. Usa una de: ${MAIL_CATEGORIES.join(', ')}`
  }
  try {
    // Outlook puede tardar en arrancar la primera vez.
    const res = await runPcCommand(kind, { ...input, cuenta: OUTLOOK_ACCOUNT, categoryPrefix: 'Gestoría: ' }, agentId, 90_000)
    return res.ok ? toToolText(res.data) : `Error en el PC: ${toToolText(res.data)}`
  } catch (err) {
    return `Error en ${name}: ${err instanceof Error ? err.message : 'desconocido'}`
  }
}

// Borrador en Outlook + elemento en "Para revisar" (desde ahí se envía,
// se edita o se descarta con un clic).
export async function saveDraft(input: Record<string, unknown>, agentId: string, cliente?: string): Promise<string> {
  try {
    const res = await runPcCommand('mail_draft', { ...input, cuenta: OUTLOOK_ACCOUNT }, agentId, 90_000)
    if (!res.ok) return `Error en el PC: ${toToolText(res.data)}`
    const draftId = typeof res.data === 'object' && res.data ? (res.data as { id?: string }).id : undefined
    const asunto = typeof input.asunto === 'string' && input.asunto ? input.asunto : undefined
    await addReview(`Correo ${input.responderA ? 'de respuesta' : 'nuevo'}${cliente ? ` a ${cliente}` : input.para ? ` a ${input.para}` : ''}${asunto ? `: ${asunto}` : ''}`, {
      kind: 'mail', cliente, texto: String(input.texto || ''), para: input.para ? String(input.para) : undefined, asunto,
      draftId, responderA: input.responderA ? String(input.responderA) : undefined,
    }, agentId)
    return `${toToolText(res.data)} — queda en "Para revisar" de la oficina para que el humano lo envíe.`
  } catch (err) {
    return `Error en correo_borrador: ${err instanceof Error ? err.message : 'desconocido'}`
  }
}

// Para el gestor de caso (case-worker.ts): buscar, leer, abrir adjuntos y
// dejar borradores; sin clasificar ni mover.
export function caseMailTools(): Anthropic.Tool[] {
  if (!pcConfigured()) return []
  return TOOLS
    .filter((t) => ['correo_buscar', 'correo_leer', 'correo_adjunto', 'correo_borrador'].includes(t.name))
    .map(({ readOnly: _readOnly, ...tool }) => tool)
}
