import { Fragment, type ReactNode } from 'react'

// Markdown sencillo para las respuestas de los agentes: títulos, negrita,
// cursiva, código, enlaces, listas, citas, tablas y separadores. Genera
// elementos de React (nunca HTML en crudo), así que el texto de un agente o
// de un correo no puede inyectar nada en la página.

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(<strong key={key} className="font-semibold text-slate-900">{inline(tok.slice(2, -2), key)}</strong>)
    } else if (tok.startsWith('`')) {
      out.push(<code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('[')) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/) || []
      out.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{label}</a>)
    } else {
      out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>)
    }
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: { text: string; depth: number }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'hr' }

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      i++
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { blocks.push({ kind: 'h', level: h[1].length, text: h[2] }); i++; continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ kind: 'hr' }); i++; continue }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      blocks.push({ kind: 'table', rows })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push({ kind: 'quote', lines: body })
      continue
    }
    const listRe = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: { text: string; depth: number }[] = []
      while (i < lines.length) {
        const m = lines[i].match(listRe)
        if (m) { items.push({ text: m[3], depth: Math.min(Math.floor(m[1].length / 2), 3) }); i++; continue }
        // Continuación de un elemento (línea sangrada sin viñeta).
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue }
        break
      }
      blocks.push({ kind: ordered ? 'ol' : 'ul', items })
      continue
    }
    const body: string[] = []
    while (i < lines.length && lines[i].trim() && !listRe.test(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !lines[i].trim().startsWith('|') && !lines[i].trim().startsWith('```')) {
      body.push(lines[i++])
    }
    blocks.push({ kind: 'p', lines: body })
  }
  return blocks
}

export default function Markdown({ text }: { text: string }) {
  const blocks = parse(text)
  return (
    <div className="space-y-2.5">
      {blocks.map((b, bi) => {
        const k = `b${bi}`
        switch (b.kind) {
          case 'h':
            return (
              <p key={k} className={b.level <= 2 ? 'pt-1 text-[15px] font-semibold text-slate-900' : 'pt-0.5 font-semibold text-slate-900'}>
                {inline(b.text, k)}
              </p>
            )
          case 'p':
            return (
              <p key={k}>
                {b.lines.map((l, li) => (
                  <Fragment key={li}>{li > 0 && <br />}{inline(l, `${k}-${li}`)}</Fragment>
                ))}
              </p>
            )
          case 'ul':
          case 'ol':
            return (
              <div key={k} className="space-y-1">
                {b.items.map((it, ii) => (
                  <div key={ii} className="flex gap-2" style={{ paddingLeft: it.depth * 16 }}>
                    <span className="mt-[1px] w-4 flex-shrink-0 text-right text-slate-400">
                      {b.kind === 'ol' ? `${ii + 1}.` : '•'}
                    </span>
                    <span className="min-w-0 flex-1">{inline(it.text, `${k}-${ii}`)}</span>
                  </div>
                ))}
              </div>
            )
          case 'quote':
            return (
              <div key={k} className="border-l-2 border-slate-300 pl-3 text-slate-600">
                {b.lines.map((l, li) => <p key={li}>{inline(l, `${k}-${li}`)}</p>)}
              </div>
            )
          case 'code':
            return (
              <pre key={k} className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100">{b.text}</pre>
            )
          case 'table':
            return (
              <div key={k} className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className={ri === 0 ? 'bg-slate-50 font-semibold text-slate-900' : 'border-t border-slate-100'}>
                        {r.map((c, ci) => <td key={ci} className="px-2.5 py-1.5 align-top">{inline(c, `${k}-${ri}-${ci}`)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'hr':
            return <hr key={k} className="border-slate-200" />
        }
      })}
    </div>
  )
}
