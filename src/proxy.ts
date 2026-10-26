import { NextRequest, NextResponse } from 'next/server'
import { safeEqual } from '@/lib/safe-equal'

// Los agentes pueden cambiar datos de GestoriaAD y controlar el PC de la
// gestoría, así que toda la oficina (UI + API) va detrás de HTTP Basic
// Auth, igual que GestoriaAD: APP_USERS="nico:clave1,maria:clave2".
function configuredUsers(): Array<[string, string]> {
  const users: Array<[string, string]> = []
  for (const entry of (process.env.APP_USERS || '').split(',')) {
    const i = entry.indexOf(':')
    if (i > 0) users.push([entry.slice(0, i).trim(), entry.slice(i + 1).trim()])
  }
  return users
}

// El puente del PC no es un navegador: se autentica con su propio token
// (PC_BRIDGE_TOKEN) dentro de esas rutas.
function isBridgePath(pathname: string): boolean {
  return pathname.startsWith('/api/pc/')
}

// El navegador manda el Basic Auth guardado a cualquier petición hacia la
// oficina, venga de donde venga: se rechazan los cambios que vienen de otra
// web (CSRF), que aquí podrían acabar ejecutando comandos en el PC.
function isCrossSiteMutation(request: NextRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'cross-site'
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return origin === 'null'
  try {
    return new URL(origin).host !== request.nextUrl.host
  } catch {
    return true
  }
}

export function proxy(request: NextRequest) {
  if (isBridgePath(request.nextUrl.pathname)) return NextResponse.next()

  if (isCrossSiteMutation(request)) {
    return new NextResponse('Petición de otro sitio bloqueada', { status: 403 })
  }

  const users = configuredUsers()
  // Sin usuarios configurados, abierta solo en desarrollo local.
  if (users.length === 0) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()
    return new NextResponse(
      'Acceso no configurado: define APP_USERS en las variables de entorno.',
      { status: 503 },
    )
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
    const sep = decoded.indexOf(':')
    const user = sep === -1 ? decoded : decoded.slice(0, sep)
    const pass = sep === -1 ? '' : decoded.slice(sep + 1)
    let ok = false
    for (const [u, p] of users) {
      if (safeEqual(user, u) && safeEqual(pass, p)) ok = true
    }
    if (ok) return NextResponse.next()
  }

  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Oficina Virtual"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
