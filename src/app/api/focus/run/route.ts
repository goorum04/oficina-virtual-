import { runFocusReview } from '@/lib/focus'
import { NextResponse } from 'next/server'

export const maxDuration = 300

// Repaso de clientes prioritarios a demanda (además del automático cada
// pocas horas mientras el puente del PC está conectado).
export async function POST() {
  const result = await runFocusReview()
  return NextResponse.json(result, { status: result.ok ? 200 : 503 })
}
