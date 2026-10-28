import { PDFDocument } from 'pdf-lib'

// Los PDF largos se mandan al modelo solo por las páginas que hacen falta:
// cada página cuesta como una imagen y, en un expediente, se reenvía en cada
// paso. Por defecto las primeras MAX_PAGES; con "paginas" (p. ej. "16-30")
// otras.

const MAX_PAGES = 15

export async function pdfForModel(base64: string, paginas?: string): Promise<{ base64: string; note: string }> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(Buffer.from(base64, 'base64'), { ignoreEncryption: true })
  } catch {
    return { base64, note: '' } // si no se puede abrir, va entero
  }
  const total = doc.getPageCount()
  const m = String(paginas || '').match(/^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/)
  const from = m ? Math.max(1, Number(m[1])) : 1
  const to = Math.min(total, m ? Number(m[2] || m[1]) : MAX_PAGES, from + MAX_PAGES - 1)
  if (from === 1 && to >= total) return { base64, note: '' }
  const out = await PDFDocument.create()
  const pages = await out.copyPages(doc, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))
  pages.forEach((p) => out.addPage(p))
  return {
    base64: Buffer.from(await out.save()).toString('base64'),
    note: `(PDF de ${total} páginas: ves las páginas ${from}-${to}. Para otras, vuelve a leerlo con paginas="desde-hasta".)`,
  }
}
