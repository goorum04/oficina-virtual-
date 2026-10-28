import { NextResponse } from 'next/server'
import { checkPassword, sessionCookie } from '@/lib/session'

// Página de entrada propia (sin la ventana de usuario y contraseña del
// navegador, que la app del iPhone en la pantalla de inicio no muestra).

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function page(next: string, error = ''): NextResponse {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f172a"><link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png"><title>Entrar · Oficina</title>
<style>
  *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:-apple-system,system-ui,sans-serif;color:#0f172a;padding:16px}
  form{width:100%;max-width:360px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;box-shadow:0 20px 50px -20px rgba(15,23,42,.3)}
  h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:#64748b;font-size:14px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input{width:100%;font-size:16px;padding:12px;border:1px solid #cbd5e1;border-radius:10px;outline:none}input:focus{border-color:#0f172a}
  button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;background:#0f172a;color:#fff;font-size:16px;font-weight:600}
  .err{margin-top:14px;color:#dc2626;font-size:14px}
</style></head><body>
<form method="post" action="/entrar">
  <h1>Oficina de la gestoría</h1><p>Entra una vez: te recordará 90 días.</p>
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="u">Usuario</label><input id="u" name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" required>
  <label for="p">Contraseña</label><input id="p" name="clave" type="password" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
</form></body></html>`
  return new NextResponse(html, { status: error ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(req: Request) {
  return page(safeNext(new URL(req.url).searchParams.get('next')))
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null)
  const user = String(form?.get('usuario') ?? '').trim()
  const pass = String(form?.get('clave') ?? '')
  const next = safeNext(String(form?.get('next') ?? '/'))
  if (!checkPassword(user, pass)) {
    await new Promise((r) => setTimeout(r, 800)) // frena a quien prueba contraseñas
    return page(next, 'Usuario o contraseña incorrectos')
  }
  const res = NextResponse.redirect(new URL(next, req.url), 303)
  const c = sessionCookie(user)
  res.cookies.set(c.name, c.value, c.options)
  return res
}
