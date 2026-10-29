import { NextResponse } from 'next/server'
import { gestoriaConfigured, gestoriaFetch } from '@/lib/gestoria'

// Clientes de GestoriaAD para elegir con quién es la llamada.
export async function GET() {
  if (!gestoriaConfigured()) return NextResponse.json([])
  const res = await gestoriaFetch('GET', '/api/clients')
  if (!res.ok || !Array.isArray(res.data)) return NextResponse.json([])
  return NextResponse.json((res.data as Array<{ id: string; firstName: string; lastName: string }>)
    .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name)))
}
