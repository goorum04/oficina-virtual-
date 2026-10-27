import { enqueueCaseByName } from '@/lib/case-worker'
import { NextResponse } from 'next/server'

// Encarga trabajar el expediente de un cliente ({ cliente: "Bencheikh" }).
// Se pone en la cola; el puente del PC lo recoge en unos segundos.
export async function POST(req: Request) {
  const { cliente } = await req.json().catch(() => ({}))
  if (typeof cliente !== 'string' || !cliente.trim()) return NextResponse.json({ error: 'cliente requerido' }, { status: 400 })
  return NextResponse.json({ message: await enqueueCaseByName(cliente.trim()) })
}
