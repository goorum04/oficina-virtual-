// Cliente HTTP de GestoriaAD (la app de gestión de la gestoría, repo
// goorum04/hubspot). La oficina no toca su base de datos: llama a su API
// con un usuario propio de APP_USERS, así el historial de cambios de
// GestoriaAD deja constancia de lo que hace cada agente.

const MAX_RESPONSE_CHARS = 30_000

export function gestoriaConfigured(): boolean {
  return Boolean(process.env.GESTORIA_URL && process.env.GESTORIA_USER && process.env.GESTORIA_PASSWORD)
}

export async function gestoriaFetch(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = (process.env.GESTORIA_URL || '').replace(/\/+$/, '')
  const auth = Buffer.from(`${process.env.GESTORIA_USER}:${process.env.GESTORIA_PASSWORD}`).toString('base64')
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch { /* respuesta no JSON (p.ej. 401 en texto plano) */ }
  return { ok: res.ok, status: res.status, data }
}

// Las respuestas van al contexto del modelo: se recortan para no gastar
// tokens de más con listas enormes.
export function toToolText(data: unknown): string {
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  return text.length > MAX_RESPONSE_CHARS
    ? `${text.slice(0, MAX_RESPONSE_CHARS)}\n…(respuesta recortada: usa filtros más concretos)`
    : text
}
