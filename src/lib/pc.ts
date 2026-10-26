import { db } from '@/lib/db'
import { safeEqual } from '@/lib/safe-equal'

// Puente con el PC de la gestoría: los agentes encolan órdenes (PcCommand)
// y el programa pc-bridge/ que corre en el PC las recoge, las ejecuta y
// devuelve el resultado. Aquí se encola y se espera la respuesta.

const ONLINE_WINDOW_MS = 45_000
const POLL_EVERY_MS = 700

export function pcConfigured(): boolean {
  return Boolean(process.env.PC_BRIDGE_TOKEN)
}

export function bridgeAuthorized(request: Request): boolean {
  const token = process.env.PC_BRIDGE_TOKEN
  const header = request.headers.get('authorization') || ''
  return Boolean(token) && header.startsWith('Bearer ') && safeEqual(header.slice(7), token!)
}

export async function bridgeStatus(): Promise<{ online: boolean; lastSeen: Date | null; hostname: string | null; platform: string | null }> {
  const row = await db.pcBridge.findUnique({ where: { id: 'pc' } })
  return {
    online: Boolean(row && Date.now() - row.lastSeen.getTime() < ONLINE_WINDOW_MS),
    lastSeen: row?.lastSeen ?? null,
    hostname: row?.hostname ?? null,
    platform: row?.platform ?? null,
  }
}

export type PcResult = { ok: boolean; data: unknown }

export async function runPcCommand(
  kind: string,
  payload: Record<string, unknown>,
  agentId: string | null,
  timeoutMs = 45_000
): Promise<PcResult> {
  const status = await bridgeStatus()
  if (!status.online) {
    return { ok: false, data: 'El PC no está conectado: el programa del puente (pc-bridge) no está abierto o no tiene conexión.' }
  }

  const cmd = await db.pcCommand.create({ data: { kind, payload: JSON.stringify(payload), agentId } })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS))
    const row = await db.pcCommand.findUnique({ where: { id: cmd.id } })
    if (row && (row.status === 'done' || row.status === 'error')) {
      let data: unknown = row.result
      try { data = row.result ? JSON.parse(row.result) : null } catch { /* texto plano */ }
      return { ok: row.status === 'done', data }
    }
  }

  // Si el puente aún no la había recogido, se anula: una orden (sobre todo
  // un comando) no debe ejecutarse minutos después sin que nadie la espere.
  const cancelled = await db.pcCommand.updateMany({
    where: { id: cmd.id, status: 'pending' },
    data: { status: 'error', result: JSON.stringify('cancelada: el PC no la recogió a tiempo'), completedAt: new Date() },
  })
  return {
    ok: false,
    data: cancelled.count
      ? 'El PC no respondió a tiempo; la orden se ha anulado sin ejecutarse.'
      : 'El PC sigue ejecutando la orden y no ha terminado a tiempo; el resultado no está disponible.',
  }
}
