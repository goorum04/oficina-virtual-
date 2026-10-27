import type Anthropic from '@anthropic-ai/sdk'
import { toToolText } from '@/lib/gestoria'
import { officeProtected } from '@/lib/access'
import { pcConfigured, runPcCommand } from '@/lib/pc'
import { MAIL_AGENT_ID } from '@/lib/gestoria-tools'

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

export async function runMailTool(name: string, input: Record<string, unknown>, agentId: string): Promise<string> {
  const kind = {
    correo_listar: 'mail_list',
    correo_cuentas: 'mail_accounts',
    correo_leer: 'mail_read',
    correo_clasificar: 'mail_categorize',
    correo_mover: 'mail_move',
  }[name]
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
