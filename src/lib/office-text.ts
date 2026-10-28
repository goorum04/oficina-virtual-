import { unzipSync, strFromU8 } from 'fflate'

// Texto de un Excel (.xlsx) o Word (.docx) para que el modelo lo lea: son
// ZIPs de XML, así que basta descomprimir y quitar las etiquetas. De los
// Excel se sacan los valores calculados (lo que se ve en la celda), hoja a
// hoja y fila a fila.

const MAX_CHARS = 60_000

export const OFFICE_EXTS = ['.xlsx', '.xlsm', '.docx']

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')

const texts = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1])).join('')

function xlsxText(files: Record<string, Uint8Array>): string {
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '')
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]))
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => [m[0].match(/Id="([^"]+)"/)?.[1], m[0].match(/Target="([^"]+)"/)?.[1]]))
  const sheets = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decode(m[0].match(/name="([^"]*)"/)?.[1] ?? ''),
    target: rels[m[0].match(/r:id="([^"]+)"/)?.[1] ?? ''] ?? '',
  }))
  const out: string[] = []
  for (const sheet of sheets) {
    const file = sheet.target.startsWith('/') ? sheet.target.slice(1) : `xl/${sheet.target.replace(/^\.\//, '')}`
    const xml = read(file)
    const rows: string[] = []
    for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = []
      for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1] ?? ''
        const type = c[1].match(/t="(\w+)"/)?.[1]
        const body = c[2] ?? ''
        const v = body.match(/<v>([^<]*)<\/v>/)?.[1]
        let value = ''
        if (type === 's' && v != null) value = shared[Number(v)] ?? ''
        else if (type === 'inlineStr') value = texts(body)
        else if (type === 'b') value = v === '1' ? 'VERDADERO' : 'FALSO'
        else if (v) value = decode(v)
        else if (body.includes('<f>')) value = `=${decode(body.match(/<f>([^<]*)<\/f>/)?.[1] ?? '')}`
        if (value.trim()) cells.push(`${ref}=${value.trim()}`)
      }
      if (cells.length) rows.push(cells.join(' | '))
    }
    out.push(`### Hoja "${sheet.name}"\n${rows.join('\n') || '(vacía)'}`)
  }
  return out.join('\n\n')
}

function docxText(files: Record<string, Uint8Array>): string {
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : ''
  return decode(xml
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, '') // códigos de campo, no texto
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>\s*<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
}

export function officeText(name: string, base64: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
  const files = unzipSync(Buffer.from(base64, 'base64'))
  const text = ext === '.docx' ? docxText(files) : xlsxText(files)
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(recortado)` : text
}
