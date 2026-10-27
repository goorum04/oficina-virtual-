import { gestoriaFetch } from '@/lib/gestoria'

// Resumen de un cliente para atender una llamada: todo lo que hay que saber
// en una sola llamada a la herramienta (y en paralelo contra GestoriaAD),
// para que el agente de llamadas conteste en segundos en vez de encadenar
// cinco consultas.

type Row = Record<string, unknown>

const MISSING_TIMEOUT_MS = 6000
const CLOSED = ['completado', 'cancelado', 'rechazado']

function norm(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const fullName = (c: Row) => `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
const day = (d: unknown) => (typeof d === 'string' && d ? d.slice(0, 10) : null)
const cut = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t || null
}

async function getJson(path: string): Promise<unknown> {
  const res = await gestoriaFetch('GET', path)
  if (!res.ok) throw new Error(`GestoriaAD respondió ${res.status} en ${path}`)
  return res.data
}

// La búsqueda de GestoriaAD exige la frase entera en nombre O apellido y
// distingue tildes ("Thadee" no encuentra a "Thadée"): se trae la lista
// (son decenas de clientes) y se filtra aquí sin tildes ni mayúsculas,
// exigiendo que aparezcan todas las palabras dichas.
async function findClients(query: string): Promise<Row[]> {
  const words = norm(query).split(/[\s,.-]+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  const all = (await getJson('/api/clients')) as Row[]
  return all.filter((c) => words.every((w) => norm(`${fullName(c)} ${c.email ?? ''}`).includes(w)))
}

// Varias alertas con el mismo título (p.ej. una por apostilla caducada) se
// cuentan juntas, con la fecha más próxima, para leerlas de un vistazo.
function groupAlerts(alerts: Row[]) {
  const groups = new Map<string, { titulo: unknown; cuantas: number; vence: string | null; prioridad: unknown }>()
  for (const a of alerts) {
    const key = String(a.title)
    const g = groups.get(key)
    const due = day(a.dueDate)
    if (!g) groups.set(key, { titulo: a.title, cuantas: 1, vence: due, prioridad: a.priority })
    else {
      g.cuantas++
      if (due && (!g.vence || due < g.vence)) g.vence = due
    }
  }
  return [...groups.values()]
}

export async function clientBriefing(query: string, clientId?: string): Promise<unknown> {
  let id = clientId
  if (!id) {
    const matches = await findClients(query)
    if (!matches.length) return { encontrado: false, mensaje: `No hay ningún cliente que coincida con "${query}".` }
    const exact = matches.filter((c) => norm(fullName(c)) === norm(query))
    const pick = exact.length === 1 ? exact : matches
    if (pick.length > 1) {
      return {
        encontrado: false,
        mensaje: 'Hay varios clientes que coinciden: pregunta cuál es y vuelve a llamar con su clientId.',
        candidatos: pick.slice(0, 10).map((c) => ({ clientId: c.id, nombre: fullName(c), email: c.email, estado: c.status })),
      }
    }
    id = String(pick[0].id)
  }

  const enc = encodeURIComponent(id)
  const [client, processes, missing] = await Promise.all([
    getJson(`/api/clients/${enc}`) as Promise<Row>,
    getJson(`/api/processes?clientId=${enc}`) as Promise<Row[]>,
    // "Lo que falta" es lo más lento (revisa documentos de HubSpot): si
    // tarda, el resumen sale sin ello antes que hacer esperar al humano.
    Promise.race([
      getJson(`/api/clients/${enc}/request-missing`).catch(() => null),
      new Promise((r) => setTimeout(() => r(null), MISSING_TIMEOUT_MS)),
    ]) as Promise<{ items?: Array<{ es: string }> } | null>,
  ])

  const alertsByProcess = new Map<unknown, Row[]>()
  for (const p of (client.processes as Row[]) || []) alertsByProcess.set(p.id, (p.alerts as Row[]) || [])

  const sorted = [...processes].sort((a, b) => Number(CLOSED.includes(String(a.status))) - Number(CLOSED.includes(String(b.status))))
  const emails = (client.emails as Row[]) || []
  const meeting = ((client.transcriptions as Row[]) || [])[0]

  return {
    hoy: new Date().toISOString().slice(0, 10),
    cliente: {
      clientId: client.id,
      nombre: fullName(client),
      estado: client.status,
      riesgo: client.riskLevel,
      pep: client.isPEP ? client.pepDescription || 'sí' : 'no',
      email: client.email,
      telefono: client.phone,
      nacionalidad: client.nationality,
      profesion: client.profession,
      residenciaActual: [client.currentCity, client.currentCountry].filter(Boolean).join(', ') || null,
      inicioRelacion: day(client.odmDate),
      notas: cut(client.notes, 500),
    },
    procesos: sorted.slice(0, 8).map((p) => {
      const steps = (p.steps as Row[]) || []
      return {
        titulo: p.title,
        tipo: p.type,
        estado: p.status,
        fechaLimite: day(p.deadline),
        pasosHechos: `${steps.filter((s) => s.status === 'completado').length}/${steps.length}`,
        siguientePaso: steps.find((s) => s.status !== 'completado')?.title ?? null,
        pasosBloqueados: steps.filter((s) => s.status === 'bloqueado').map((s) => s.title),
        alertasPendientes: groupAlerts(alertsByProcess.get(p.id) || []),
      }
    }),
    ultimosCorreos: emails.slice(0, 4).map((e) => ({
      fecha: day(e.sentAt),
      sentido: e.direction === 'INCOMING_EMAIL' ? 'recibido' : 'enviado',
      asunto: e.subject,
      extracto: cut(e.body, 220),
    })),
    ultimaReunion: meeting ? { fecha: day(meeting.createdAt), titulo: meeting.title, resumen: cut(meeting.summary, 500) } : null,
    faltaDocumentacion: missing === null ? 'no disponible ahora (tardaba demasiado)' : (missing.items || []).map((i) => i.es),
  }
}
