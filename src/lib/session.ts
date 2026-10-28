import { createHmac } from 'node:crypto'
import { configuredUsers } from '@/lib/access'
import { safeEqual } from '@/lib/safe-equal'

// Sesión recordada: tras entrar una vez (página /entrar o usuario y
// contraseña del navegador), una cookie firmada vale SESSION_DAYS días. La
// firma usa los propios usuarios configurados: si se cambia una contraseña,
// todas las sesiones caducan.

export const SESSION_COOKIE = 'oficina_sesion'
const SESSION_DAYS = 90

type Users = Array<[string, string]>

function sign(payload: string, users: Users): string {
  return createHmac('sha256', JSON.stringify(users)).update(payload).digest('base64url')
}

export function validSession(value: string | undefined, users: Users = configuredUsers()): boolean {
  if (!value) return false
  const [user, exp, mac] = value.split('.')
  if (!user || !exp || !mac || Number(exp) < Date.now()) return false
  if (!users.some(([u]) => safeEqual(Buffer.from(user, 'base64url').toString(), u))) return false
  return safeEqual(mac, sign(`${user}.${exp}`, users))
}

export function checkPassword(user: string, pass: string, users: Users = configuredUsers()): boolean {
  let ok = false
  for (const [u, p] of users) {
    if (safeEqual(user, u) && safeEqual(pass, p)) ok = true
  }
  return ok
}

export function sessionCookie(user: string, users: Users = configuredUsers()) {
  const payload = `${Buffer.from(user).toString('base64url')}.${Date.now() + SESSION_DAYS * 86_400_000}`
  return {
    name: SESSION_COOKIE,
    value: `${payload}.${sign(payload, users)}`,
    options: { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: SESSION_DAYS * 86_400 },
  }
}
