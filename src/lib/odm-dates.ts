import { PDFDocument } from 'pdf-lib'
import { db } from '@/lib/db'
import { anthropic } from '@/lib/anthropic'
import { gestoriaFetch } from '@/lib/gestoria'
import { runPcCommand } from '@/lib/pc'
import { MODELS } from '@/lib/model-router'
import { calcCostUsd } from '@/lib/pricing'

// Fecha de inicio de cada cliente = fecha de firma de su ODM (Ordre de
// Mission). GestoriaAD la saca de los documentos de HubSpot; a los que no la
// tienen se les busca la ODM en su carpeta de OneDrive y se lee la fecha que
// hay tras "Fait à … le :" en la última página. Solo se rellena si está
// vacía: nunca se cambia una fecha que ya esté puesta.

export const CLIENT_ROOTS = [
  'C:\\Users\\nicoj\\OneDrive - SPMI Solutions Informatiques\\Said',
  'C:\\Users\\nicoj\\OneDrive - SPMI Solutions Informatiques\\SILVIA\\DOSSIER CLIENTS',
]
const AGENT = 't-cli'
const RETRY_DAYS = 14

export type OdmClient = { id: string; firstName: string; lastName: string; odmDate?: string | null }

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Carpetas de cliente de las dos raíces (una consulta por raíz y tanda).
export async function clientFolders(): Promise<Array<{ path: string; name: string; modified: string }>> {
  const out: Array<{ path: string; name: string; modified: string }> = []
  for (const root of CLIENT_ROOTS) {
    const res = await runPcCommand('list', { path: root }, AGENT, 60_000)
    if (!res.ok) continue
    for (const e of ((res.data as { elementos?: Array<{ nombre: string; tipo: string; modified?: string }> }).elementos ?? [])) {
      if (e.tipo === 'carpeta') out.push({ path: `${root}\\${e.nombre}`, name: e.nombre, modified: e.modified ?? '' })
    }
  }
  return out
}

export async function clientsWithoutOdm(): Promise<OdmClient[]> {
  const res = await gestoriaFetch('GET', '/api/clients')
  if (!res.ok || !Array.isArray(res.data)) return []
  const recent = await db.activityLog.findMany({
    where: { type: 'odm_try', createdAt: { gte: new Date(Date.now() - RETRY_DAYS * 86_400_000) } },
    select: { metadata: true },
  })
  const tried = new Set(recent.map((r) => JSON.parse(r.metadata || '{}').clientId))
  return (res.data as OdmClient[]).filter((c) => !c.odmDate && !tried.has(c.id)).sort((a, b) => a.id.localeCompare(b.id))
}

// Busca la ODM firmada del cliente, lee la fecha y la guarda. Devuelve una
// línea para el informe (o null si no hay nada que contar).
export async function findOdmDate(c: OdmClient, folders: Array<{ path: string; name: string; modified: string }>): Promise<{ line: string | null; costUsd: number; saved?: boolean }> {
  try {
    return await lookup(c, folders)
  } catch {
    // Que un error no lo deje en bucle: se reintenta dentro de RETRY_DAYS.
    await logTry(c.id, null)
    return { line: null, costUsd: 0 }
  }
}

// Palabras de un nombre (sin acentos), para comparar apellidos enteros:
// "Edouard" no es "Douard".
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)

// Fecha que llevan muchos escaneos en el nombre: "_250604_" = 04/06/2025.
function fileDate(name: string): Date | null {
  const m = name.match(/_(\d{2})(\d{2})(\d{2})_/)
  if (!m) return null
  const d = new Date(`20${m[1]}-${m[2]}-${m[3]}T12:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

async function lookup(c: OdmClient, folders: Array<{ path: string; name: string; modified: string }>): Promise<{ line: string | null; costUsd: number; saved?: boolean }> {
  const last = words(c.lastName)
  const first = words(c.firstName)
  const log = (found: string | null) => logTry(c.id, found)
  const bySurname = folders.filter((f) => last.length && last.every((w) => words(f.name).includes(w)))
  // Si hay varias, las que también llevan el nombre; si sigue habiendo
  // carpetas de personas distintas, no se adivina.
  const withFirst = bySurname.filter((f) => first.some((w) => words(f.name).includes(w)))
  const mine = (withFirst.length ? withFirst : bySurname).sort((a, b) => b.modified.localeCompare(a.modified))
  if (!mine.length) { await log(null); return { line: `${c.firstName} ${c.lastName}: no encuentro su carpeta`, costUsd: 0 } }
  const distinct = new Set(mine.map((f) => words(f.name).sort().join(' ')))
  if (!withFirst.length && distinct.size > 1) {
    await log(null)
    return { line: `${c.firstName} ${c.lastName}: hay varias carpetas con ese apellido (${mine.map((f) => f.name).join(', ')})`, costUsd: 0 }
  }

  const files: string[] = []
  for (const f of mine) {
    for (const term of ['odm', 'ordre']) {
      const res = await runPcCommand('search', { path: f.path, name: term }, AGENT, 60_000)
      if (!res.ok) continue
      for (const r of ((res.data as { resultados?: Array<{ ruta: string; tipo: string }> }).resultados ?? [])) {
        const base = r.ruta.split('\\').pop() ?? ''
        if (r.tipo === 'archivo' && /\.pdf$/i.test(base) && /\bodm\b|ordre[\s_-]*de[\s_-]*mission/i.test(base) && !/avenant/i.test(base) && !files.includes(r.ruta)) files.push(r.ruta)
      }
    }
    if (files.length) break
  }
  if (!files.length) { await log(null); return { line: `${c.firstName} ${c.lastName}: no encuentro la ODM en su carpeta`, costUsd: 0 } }
  // Primero las que llevan su apellido y las que dicen estar firmadas.
  const score = (p: string) => {
    const base = p.split('\\').pop() ?? ''
    return (last.some((w) => words(base).includes(w)) ? 2 : 0) + (/sign|firm/i.test(base) ? 1 : 0)
  }
  files.sort((a, b) => score(b) - score(a))

  let costUsd = 0
  for (const file of files.slice(0, 3)) {
    const name = file.split('\\').pop() ?? file
    const pdf = await readPdf(file)
    if (!pdf) continue
    const lastPdf = await lastPages(pdf, 2)
    const response = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: lastPdf } },
          { type: 'text', text: 'Son las últimas páginas de un ORDRE DE MISSION (ODM) de una gestoría. ¿Qué fecha está escrita tras "Fait à … en deux exemplaires le :" (junto a las firmas)? Lee el año con cuidado (cuatro cifras). Si está en blanco, no hay firmas, o el documento es un AVENANT, responde null. Responde SOLO con JSON: {"fecha":"YYYY-MM-DD"} o {"fecha":null}' },
        ],
      }],
    })
    costUsd += calcCostUsd('haiku', response.usage.input_tokens, response.usage.output_tokens)
    const text = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    const fecha = text.match(/"fecha"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1]
    const d = fecha ? new Date(`${fecha}T12:00:00Z`) : null
    if (!fecha || !d || isNaN(d.getTime()) || d.getFullYear() < 2015 || d > new Date()) continue
    const shown = fecha.split('-').reverse().join('/')
    // Si el nombre del archivo lleva la fecha del escaneo y no cuadra (más
    // de un año de diferencia), se deja para que lo mire el humano.
    const scanned = fileDate(name)
    if (scanned && Math.abs(scanned.getTime() - d.getTime()) > 365 * 86_400_000) {
      await log(null)
      return { line: `${c.firstName} ${c.lastName}: la ODM dice ${shown} pero el archivo es de ${scanned.toISOString().slice(0, 7)}; revísala (${name})`, costUsd }
    }
    // Se vuelve a mirar justo antes de guardar: solo si sigue vacía.
    const now = await gestoriaFetch('GET', `/api/clients/${c.id}`)
    if (now.ok && (now.data as { odmDate?: string | null }).odmDate) { await log(fecha); return { line: null, costUsd } }
    const put = await gestoriaFetch('PUT', `/api/clients/${c.id}`, { odmDate: fecha })
    await log(fecha)
    const otherName = !last.some((w) => words(name).includes(w)) ? ' — el archivo no lleva su apellido, compruébalo' : ''
    return { line: put.ok ? `${c.firstName} ${c.lastName}: ${shown} (${name})${otherName}` : `${c.firstName} ${c.lastName}: fecha ${shown} pero GestoriaAD no la guardó (${put.status})`, costUsd, saved: put.ok }
  }
  await log(null)
  return { line: `${c.firstName} ${c.lastName}: su ODM no tiene la fecha de firma rellenada`, costUsd }
}

async function logTry(clientId: string, fecha: string | null): Promise<void> {
  const agent = await db.agent.findUnique({ where: { id: AGENT }, select: { projectId: true } })
  if (agent) await db.activityLog.create({ data: { type: 'odm_try', message: 'odm', metadata: JSON.stringify({ clientId, fecha }), projectId: agent.projectId, agentId: AGENT } })
}

async function readPdf(file: string): Promise<string | null> {
  const res = await runPcCommand('read', { path: file, binary: true }, AGENT, 90_000)
  if (!res.ok && /demasiado grande/i.test(String(res.data))) {
    // Archivos de más de 3 MB: por trozos.
    const parts: Buffer[] = []
    let offset = 0
    let size = Infinity
    while (offset < size) {
      const chunk = await runPcCommand('read', { path: file, offset, length: 3 * 1024 * 1024 }, AGENT, 90_000)
      if (!chunk.ok) return null
      const data = chunk.data as { size: number; base64: string }
      const buf = Buffer.from(data.base64, 'base64')
      if (!buf.length) break
      size = data.size
      parts.push(buf)
      offset += buf.length
    }
    return Buffer.concat(parts).toString('base64')
  }
  return res.ok ? (res.data as { base64?: string }).base64 ?? null : null
}

async function lastPages(base64: string, n: number): Promise<string> {
  try {
    const doc = await PDFDocument.load(Buffer.from(base64, 'base64'), { ignoreEncryption: true })
    const total = doc.getPageCount()
    if (total <= n) return base64
    const out = await PDFDocument.create()
    const pages = await out.copyPages(doc, Array.from({ length: n }, (_, i) => total - n + i))
    pages.forEach((p) => out.addPage(p))
    return Buffer.from(await out.save()).toString('base64')
  } catch {
    return base64
  }
}
