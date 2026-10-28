import { db } from '@/lib/db'

// Tope de gasto mensual en IA (lo fija el humano en el panel). Al 80 % se
// avisa; al 100 % se para todo lo automático hasta el mes siguiente (el chat
// sigue funcionando: lo pide el humano).

export const USD_TO_EUR = 0.92
const SETTING_ID = 'setting-budget'
const DEFAULT_MONTHLY_EUR = 60

function monthStart(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Andorra', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  return new Date(`${y}-${m}-01T00:00:00+01:00`)
}

export async function monthlyLimitEur(): Promise<number> {
  const row = await db.activityLog.findUnique({ where: { id: SETTING_ID } })
  const v = row?.metadata ? Number(JSON.parse(row.metadata).monthlyEur) : NaN
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MONTHLY_EUR
}

export async function setMonthlyLimitEur(eur: number, projectId: string): Promise<void> {
  const metadata = JSON.stringify({ monthlyEur: eur })
  await db.activityLog.upsert({
    where: { id: SETTING_ID },
    create: { id: SETTING_ID, type: 'setting', message: 'Tope de gasto mensual', metadata, projectId },
    update: { metadata },
  })
}

export async function monthSpendEur(): Promise<number> {
  const sum = await db.message.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: monthStart() } } })
  return Number(sum._sum.costUsd || 0) * USD_TO_EUR
}

export async function budgetStatus(): Promise<{ spentEur: number; limitEur: number; ratio: number }> {
  const [spentEur, limitEur] = await Promise.all([monthSpendEur(), monthlyLimitEur()])
  return { spentEur, limitEur, ratio: spentEur / limitEur }
}


// ¿Puede trabajar solo el equipo? (false = tope del mes alcanzado). Al
// pasar el 80 % y el 100 % avisa al móvil (una vez por mes y nivel).
export async function checkBudget(): Promise<boolean> {
  const { spentEur, limitEur, ratio } = await budgetStatus()
  const level = ratio >= 1 ? 100 : ratio >= 0.8 ? 80 : 0
  if (!level) return true
  const id = `setting-budget-warn-${monthStart().getTime()}-${level}`
  if (await db.activityLog.findUnique({ where: { id } })) return level < 100
  const lead = await db.agent.findUnique({ where: { id: 't-pm' }, select: { projectId: true } })
  if (!lead) return level < 100
  await db.activityLog.create({ data: { id, type: 'setting', message: `Aviso de gasto ${level} %`, projectId: lead.projectId } })
  const { notify } = await import('@/lib/push')
  await notify(
    level === 100 ? 'Tope de gasto alcanzado' : 'Gasto de IA al 80 %',
    `${spentEur.toFixed(2).replace('.', ',')} € de ${limitEur} € este mes.${level === 100 ? ' El equipo deja de trabajar solo hasta el mes que viene.' : ''}`,
    { tag: 'budget' },
  )
  return level < 100
}
