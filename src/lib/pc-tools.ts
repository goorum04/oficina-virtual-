import type Anthropic from '@anthropic-ai/sdk'
import { gestoriaConfigured, gestoriaUpload, toToolText } from '@/lib/gestoria'
import { bridgeStatus, pcConfigured, runPcCommand } from '@/lib/pc'
import { officeProtected } from '@/lib/access'
import { OFFICE_EXTS, officeText } from '@/lib/office-text'
import { pdfForModel } from '@/lib/pdf-pages'

// Herramientas para controlar el PC de la gestoría a través del puente
// (pc-bridge/). Las tienen todos los agentes en cuanto PC_BRIDGE_TOKEN está
// configurado. Borrar y ejecutar comandos exigen confirmación del humano.

const str = { type: 'string' }
const path = { type: 'string', description: 'Ruta en el PC, p.ej. "C:\\\\GestoriaAD\\\\Clientes\\\\Ana Pi"' }

const CONFIRM_PROP = {
  confirmado: {
    type: 'boolean',
    description: 'Pon true SOLO si el humano ha confirmado explícitamente en la conversación esta acción concreta.',
  },
}

interface PcTool {
  name: string
  description: string
  properties?: Record<string, unknown>
  required?: string[]
  needsConfirmation?: boolean
  readOnly?: boolean
}

const TOOLS: PcTool[] = [
  { name: 'pc_estado', readOnly: true, description: 'Si el PC está conectado, su nombre, usuario, carpeta personal y unidades disponibles.' },
  { name: 'pc_listar', readOnly: true, description: 'Lista el contenido de una carpeta del PC (nombre, tipo, tamaño, fecha).', properties: { path }, required: ['path'] },
  {
    name: 'pc_buscar', readOnly: true,
    description: 'Busca archivos y carpetas cuyo nombre contenga un texto, recorriendo subcarpetas (máx. 200 resultados).',
    properties: { path, nombre: { type: 'string', description: 'Texto a buscar en el nombre (sin distinguir mayúsculas)' } },
    required: ['path', 'nombre'],
  },
  {
    name: 'pc_leer', readOnly: true,
    description: 'Lee un archivo del PC: texto tal cual; PDF e imágenes los ves directamente (de un PDF largo, 15 páginas cada vez: elige cuáles con paginas, p. ej. "16-30"); de Excel (.xlsx) y Word (.docx) recibes el texto. Hasta 30 MB.',
    properties: { path, paginas: { type: 'string', description: 'Solo PDF: páginas a ver, "desde-hasta" (opcional)' } }, required: ['path'],
  },
  {
    name: 'pc_escribir',
    description: 'Crea o sobrescribe un archivo de texto en el PC (o añade al final con append=true). Crea las carpetas que falten.',
    properties: { path, content: str, append: { type: 'boolean' } },
    required: ['path', 'content'],
  },
  { name: 'pc_crear_carpeta', description: 'Crea una carpeta (y las intermedias que falten).', properties: { path }, required: ['path'] },
  {
    name: 'pc_mover',
    description: 'Mueve o renombra un archivo o carpeta. Con copiar=true lo copia en vez de moverlo. No sobrescribe si el destino ya existe.',
    properties: { desde: path, hasta: path, copiar: { type: 'boolean' } },
    required: ['desde', 'hasta'],
  },
  {
    name: 'pc_borrar', needsConfirmation: true,
    description: 'Borra un archivo o una carpeta con todo su contenido.',
    properties: { path }, required: ['path'],
  },
  {
    name: 'pc_ejecutar', needsConfirmation: true,
    description: 'Ejecuta un comando en el PC y devuelve su salida (máx. 2 minutos). En Windows, por defecto en PowerShell.',
    properties: {
      comando: str,
      carpeta: { type: 'string', description: 'Carpeta de trabajo (opcional)' },
      shell: { type: 'string', enum: ['powershell', 'cmd'] },
    },
    required: ['comando'],
  },
  {
    name: 'pc_subir_a_gestoria',
    description: 'Sube un archivo del PC a la ficha de un cliente en GestoriaAD (queda en HubSpot y se analiza). Máx. 3 MB.',
    properties: { path, clientId: str },
    required: ['path', 'clientId'],
  },
]

function toAnthropicTool(t: PcTool): Anthropic.Tool {
  return {
    name: t.name,
    description: t.needsConfirmation
      ? `${t.description} ACCIÓN PELIGROSA: antes explica al humano exactamente qué vas a hacer (ruta o comando completo) y llama solo cuando haya dicho que sí, con confirmado=true.`
      : t.description,
    input_schema: {
      type: 'object',
      properties: { ...(t.properties || {}), ...(t.needsConfirmation ? CONFIRM_PROP : {}) },
      required: [...(t.required || []), ...(t.needsConfirmation ? ['confirmado'] : [])],
    },
  }
}

export function pcToolsFor(): Anthropic.Tool[] {
  if (!pcConfigured() || !officeProtected()) return []
  return TOOLS
    .filter((t) => t.name !== 'pc_subir_a_gestoria' || gestoriaConfigured())
    .map(toAnthropicTool)
}

export function isPcTool(name: string): boolean {
  return TOOLS.some((t) => t.name === name)
}

export function isPcWriteTool(name: string): boolean {
  const tool = TOOLS.find((t) => t.name === name)
  return Boolean(tool && !tool.readOnly)
}

type ReadResult =
  | { type: 'text'; text: string; size: number }
  | { type: 'binary'; mimeType: string; base64: string; size: number; name: string }

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export type ToolOutput = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>

export async function runPcTool(toolName: string, input: Record<string, unknown>, agentId: string): Promise<ToolOutput> {
  const tool = TOOLS.find((t) => t.name === toolName)
  if (!tool) return `Herramienta desconocida: ${toolName}`
  if (tool.needsConfirmation && input.confirmado !== true) {
    return 'No ejecutado: esta acción necesita la confirmación explícita del humano. Explícale qué vas a hacer y espera su respuesta.'
  }

  try {
    switch (toolName) {
      case 'pc_estado': {
        const status = await bridgeStatus()
        if (!status.online) return toToolText({ conectado: false, ultimaConexion: status.lastSeen })
        const res = await runPcCommand('info', {}, agentId)
        return toToolText({ conectado: true, ...(res.data as object) })
      }
      case 'pc_listar':
        return result(await runPcCommand('list', { path: input.path }, agentId))
      case 'pc_buscar':
        return result(await runPcCommand('search', { path: input.path, name: input.nombre }, agentId, 60_000))
      case 'pc_escribir':
        return result(await runPcCommand('write', { path: input.path, content: input.content, append: input.append === true }, agentId))
      case 'pc_crear_carpeta':
        return result(await runPcCommand('mkdir', { path: input.path }, agentId))
      case 'pc_mover':
        return result(await runPcCommand('move', { from: input.desde, to: input.hasta, copy: input.copiar === true }, agentId))
      case 'pc_borrar':
        return result(await runPcCommand('delete', { path: input.path }, agentId))
      case 'pc_ejecutar':
        return result(await runPcCommand('exec', { command: input.comando, cwd: input.carpeta, shell: input.shell }, agentId, 150_000))
      case 'pc_leer': {
        let res = await runPcCommand('read', { path: input.path }, agentId)
        // Más de 3 MB: se pide por trozos (cada respuesta del puente tiene
        // que caber en el límite de Vercel) y se junta aquí.
        if (!res.ok && /demasiado grande/i.test(String(res.data))) res = await readInChunks(String(input.path), agentId)
        if (!res.ok) return result(res)
        const file = res.data as ReadResult
        if (file.type === 'text') return file.text
        if (IMAGE_TYPES.includes(file.mimeType)) {
          return [{ type: 'image', source: { type: 'base64', media_type: file.mimeType as 'image/png', data: file.base64 } }]
        }
        if (file.mimeType === 'application/pdf') {
          const pdf = await pdfForModel(file.base64, typeof input.paginas === 'string' ? input.paginas : undefined)
          const blocks: Exclude<ToolOutput, string> = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 } }]
          if (pdf.note) blocks.push({ type: 'text', text: pdf.note })
          return blocks
        }
        const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase()
        if (OFFICE_EXTS.includes(ext)) return `Contenido de "${file.name}":\n${officeText(file.name, file.base64)}`
        return `Archivo binario (${file.mimeType}, ${file.size} bytes): no se puede mostrar su contenido.`
      }
      case 'pc_subir_a_gestoria': {
        const res = await runPcCommand('read', { path: input.path, binary: true }, agentId)
        if (!res.ok) return result(res)
        const file = res.data as Extract<ReadResult, { type: 'binary' }>
        const up = await gestoriaUpload(`/api/clients/${encodeURIComponent(String(input.clientId))}/upload-document`, file.name, file.mimeType, file.base64)
        return up.ok ? `Subido a GestoriaAD: ${toToolText(up.data)}` : `Error ${up.status} de GestoriaAD: ${toToolText(up.data)}`
      }
    }
    return `Herramienta sin implementar: ${toolName}`
  } catch (err) {
    return `Error en ${toolName}: ${err instanceof Error ? err.message : 'desconocido'}`
  }
}

const CHUNK_BYTES = 3 * 1024 * 1024

async function readInChunks(path: string, agentId: string): Promise<{ ok: boolean; data: unknown }> {
  const parts: Buffer[] = []
  let offset = 0
  let first: { name: string; mimeType: string; size: number } | null = null
  do {
    const res = await runPcCommand('read', { path, offset, length: CHUNK_BYTES }, agentId)
    if (!res.ok) return res
    const chunk = res.data as { type: string; name: string; mimeType: string; size: number; base64: string }
    if (chunk.type !== 'chunk') return { ok: false, data: 'El puente del PC no lee archivos grandes: actualízalo (OficinaPuente.zip nuevo).' }
    first ??= chunk
    const buf = Buffer.from(chunk.base64, 'base64')
    if (!buf.length) break
    parts.push(buf)
    offset += buf.length
  } while (first && offset < first.size)
  if (!first) return { ok: false, data: 'No se pudo leer el archivo' }
  return { ok: true, data: { type: 'binary', name: first.name, mimeType: first.mimeType, size: first.size, base64: Buffer.concat(parts).toString('base64') } }
}

function result(res: { ok: boolean; data: unknown }): string {
  return res.ok ? toToolText(res.data) : `Error en el PC: ${toToolText(res.data)}`
}
