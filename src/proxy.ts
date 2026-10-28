import { NextRequest, NextResponse } from 'next/server'
import { configuredUsers } from '@/lib/access'
import { SESSION_COOKIE, checkPassword, sessionCookie, validSession } from '@/lib/session'

// Toda la oficina (UI + API) va detrás de usuario y contraseña en cuanto
// APP_USERS está definido: página /entrar (o Basic Auth) y luego sesión
// recordada (lib/session.ts).

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
// La página de entrada (comprueba ella misma la contraseña).
const LOGIN_PATH = '/entrar'

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
  if (validSession(request.cookies.get(SESSION_COOKIE)?.value, users)) return NextResponse.next()
  if (request.nextUrl.pathname === LOGIN_PATH) return NextResponse.next()

  // Usuario y contraseña del navegador (o de curl): también vale, y deja la
  // sesión recordada.
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
    const sep = decoded.indexOf(':')
    const user = sep === -1 ? decoded : decoded.slice(0, sep)
    const pass = sep === -1 ? '' : decoded.slice(sep + 1)
    if (checkPassword(user, pass, users)) {
      const res = NextResponse.next()
      const c = sessionCookie(user, users)
      res.cookies.set(c.name, c.value, c.options)
      return res
    }
  }

  // Al abrir una página sin sesión: a la página de entrada.
  if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
    const url = new URL(LOGIN_PATH, request.url)
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Oficina Virtual"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
