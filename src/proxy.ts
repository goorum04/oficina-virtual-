import { NextRequest, NextResponse } from 'next/server'
import { safeEqual } from '@/lib/safe-equal'
import { configuredUsers } from '@/lib/access'
import { createHmac } from 'node:crypto'

// Toda la oficina (UI + API) va detrás de HTTP Basic Auth, igual que
// GestoriaAD, en cuanto APP_USERS está definido.

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

// Archivos estáticos sin datos que el móvil pide sin credenciales (el
// service worker de los avisos y el manifiesto para instalar la app).
const PUBLIC_FILES = ['/sw.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

// Tras entrar una vez con usuario y contraseña, una cookie firmada recuerda
// la sesión SESSION_DAYS días (sobre todo para el móvil, que si no la vuelve
// a pedir al reabrir). La firma usa los propios usuarios configurados: si se
// cambia una contraseña, todas las sesiones caducan.
const SESSION_COOKIE = 'oficina_sesion'
const SESSION_DAYS = 90

function sign(payload: string, users: Array<[string, string]>): string {
  return createHmac('sha256', JSON.stringify(users)).update(payload).digest('base64url')
}

function validSession(request: NextRequest, users: Array<[string, string]>): boolean {
  const value = request.cookies.get(SESSION_COOKIE)?.value
  if (!value) return false
  const [user, exp, mac] = value.split('.')
  if (!user || !exp || !mac || Number(exp) < Date.now()) return false
  if (!users.some(([u]) => safeEqual(Buffer.from(user, 'base64url').toString(), u))) return false
  return safeEqual(mac, sign(`${user}.${exp}`, users))
}

function withSession(user: string, users: Array<[string, string]>): NextResponse {
  const res = NextResponse.next()
  const payload = `${Buffer.from(user).toString('base64url')}.${Date.now() + SESSION_DAYS * 86_400_000}`
  res.cookies.set(SESSION_COOKIE, `${payload}.${sign(payload, users)}`, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86_400,
  })
  return res
}

export function proxy(request: NextRequest) {
  if (isBridgePath(request.nextUrl.pathname)) return NextResponse.next()
  if (request.method === 'GET' && PUBLIC_FILES.includes(request.nextUrl.pathname)) return NextResponse.next()

  if (isCrossSiteMutation(request)) {
    return new NextResponse('Petición de otro sitio bloqueada', { status: 403 })
  }

  const users = configuredUsers()
  // Sin usuarios configurados la oficina sigue abierta como siempre, pero
  // los agentes no reciben herramientas de GestoriaAD ni del PC
  // (officeProtected en lib/access.ts).
  if (users.length === 0) return NextResponse.next()
  if (validSession(request, users)) return NextResponse.next()

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
    if (ok) return withSession(user, users)
  }

  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Oficina Virtual"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
