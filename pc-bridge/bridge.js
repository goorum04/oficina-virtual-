#!/usr/bin/env node
// Puente entre la Oficina Virtual y este PC: pregunta a la oficina si algún
// agente ha pedido algo (ver archivos, leerlos, moverlos, ejecutar un
// comando...), lo hace aquí y devuelve el resultado. Todo lo que hace se
// muestra en esta ventana. Sin dependencias: solo Node 18+.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { exec, execFile } = require('child_process')

const MAX_READ_BYTES = 3 * 1024 * 1024 // la oficina (Vercel) no acepta respuestas de más de ~4,5 MB
const MAX_TEXT_CHARS = 200_000
const MAX_LIST = 500
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_DIRS = 20_000
const EXEC_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 20_000

const MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown',
  '.json': 'application/json', '.html': 'text/html', '.xml': 'application/xml', '.log': 'text/plain',
}

// Igual que en el agente de escritorio de GestoriaAD: si hay un error, que
// la ventana no se cierre antes de poder leerlo.
function pauseAndExit(code) {
  if (process.platform === 'win32') {
    console.log('\nPulsa Enter para cerrar esta ventana...')
    try {
      require('child_process').execSync('pause', { stdio: 'inherit', shell: true })
    } catch { /* sin "pause", se sale igual */ }
  }
  process.exit(code)
}

function loadConfig() {
  const candidates = [
    path.join(process.cwd(), 'config.json'),
    path.join(path.dirname(process.execPath), 'config.json'),
    path.join(__dirname, 'config.json'),
  ]
  const configPath = candidates.find((c) => fs.existsSync(c))
  if (!configPath) {
    console.error('[Puente] No se encuentra config.json junto al programa. Copia config.example.json como config.json y rellénalo.')
    pauseAndExit(1)
  }
  let cfg
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (e) {
    console.error(`[Puente] config.json no es un JSON válido: ${e.message}`)
    pauseAndExit(1)
  }
  for (const key of ['officeUrl', 'token']) {
    if (!cfg[key] || cfg[key] === 'CAMBIA_ESTO') {
      console.error(`[Puente] Falta "${key}" en ${configPath}`)
      pauseAndExit(1)
    }
  }
  cfg.officeUrl = cfg.officeUrl.replace(/\/+$/, '')
  cfg.allowCommands = cfg.allowCommands !== false
  cfg.roots = Array.isArray(cfg.roots) ? cfg.roots.map((r) => path.resolve(r)) : []
  return cfg
}

const cfg = loadConfig()
const log = (...args) => console.log(`[${new Date().toLocaleTimeString()}]`, ...args)

// Con "roots" en config.json se limita el acceso a esas carpetas; vacío = todo el PC.
function checkPath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('Ruta vacía')
  const resolved = path.resolve(p)
  if (cfg.roots.length) {
    const norm = (x) => (process.platform === 'win32' ? x.toLowerCase() : x)
    const inside = cfg.roots.some((root) => {
      const rel = path.relative(norm(root), norm(resolved))
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
    if (!inside) throw new Error(`Ruta fuera de las carpetas permitidas (${cfg.roots.join(', ')})`)
  }
  return resolved
}

function entryInfo(dir, dirent) {
  const full = path.join(dir, dirent.name)
  let size = null
  let modified = null
  try {
    const st = fs.statSync(full)
    size = dirent.isDirectory() ? null : st.size
    modified = st.mtime.toISOString()
  } catch { /* sin permisos: se lista sin detalles */ }
  return { nombre: dirent.name, tipo: dirent.isDirectory() ? 'carpeta' : 'archivo', size, modified }
}

const handlers = {
  info() {
    const drives = process.platform === 'win32'
      ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => fs.existsSync(d))
      : ['/']
    return {
      equipo: os.hostname(), usuario: os.userInfo().username, carpetaPersonal: os.homedir(),
      sistema: `${os.type()} ${os.release()}`, unidades: drives,
      comandosPermitidos: cfg.allowCommands, carpetasPermitidas: cfg.roots.length ? cfg.roots : 'todo el PC',
    }
  },

  list({ path: p }) {
    const dir = checkPath(p)
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const items = entries.slice(0, MAX_LIST).map((d) => entryInfo(dir, d))
    return { carpeta: dir, total: entries.length, elementos: items, recortado: entries.length > MAX_LIST }
  },

  search({ path: p, name }) {
    const root = checkPath(p)
    const needle = String(name || '').toLowerCase()
    if (!needle) throw new Error('Falta el texto a buscar')
    const results = []
    const queue = [root]
    let visited = 0
    while (queue.length && results.length < MAX_SEARCH_RESULTS && visited < MAX_SEARCH_DIRS) {
      const dir = queue.shift()
      visited++
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const d of entries) {
        const full = path.join(dir, d.name)
        if (d.name.toLowerCase().includes(needle)) {
          results.push({ ruta: full, tipo: d.isDirectory() ? 'carpeta' : 'archivo' })
          if (results.length >= MAX_SEARCH_RESULTS) break
        }
        if (d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('$') && d.name !== 'node_modules') queue.push(full)
      }
    }
    return { resultados: results, incompleto: queue.length > 0 }
  },

  read({ path: p, binary }) {
    const file = checkPath(p)
    const st = fs.statSync(file)
    if (st.isDirectory()) throw new Error('Es una carpeta: usa listar')
    if (st.size > MAX_READ_BYTES) throw new Error(`Archivo demasiado grande (${st.size} bytes, máx. ${MAX_READ_BYTES})`)
    const buf = fs.readFileSync(file)
    const ext = path.extname(file).toLowerCase()
    const mimeType = MIME[ext] || 'application/octet-stream'
    const looksText = mimeType.startsWith('text/') || ['application/json', 'application/xml'].includes(mimeType) ||
      (!MIME[ext] && !buf.subarray(0, 8192).includes(0))
    if (looksText && !binary) {
      const text = buf.toString('utf8')
      return { type: 'text', size: st.size, text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(recortado)` : text }
    }
    return { type: 'binary', name: path.basename(file), mimeType, size: st.size, base64: buf.toString('base64') }
  },

  write({ path: p, content, append }) {
    const file = checkPath(p)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (append) fs.appendFileSync(file, String(content ?? ''), 'utf8')
    else fs.writeFileSync(file, String(content ?? ''), 'utf8')
    return `${append ? 'Añadido a' : 'Guardado'} ${file}`
  },

  mkdir({ path: p }) {
    const dir = checkPath(p)
    fs.mkdirSync(dir, { recursive: true })
    return `Carpeta lista: ${dir}`
  },

  move({ from, to, copy }) {
    const src = checkPath(from)
    const dest = checkPath(to)
    if (!fs.existsSync(src)) throw new Error(`No existe: ${src}`)
    if (fs.existsSync(dest)) throw new Error(`El destino ya existe: ${dest}`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (copy) {
      fs.cpSync(src, dest, { recursive: true })
      return `Copiado ${src} → ${dest}`
    }
    try {
      fs.renameSync(src, dest)
    } catch (e) {
      if (e.code !== 'EXDEV') throw e
      // Entre unidades distintas no se puede renombrar: copiar y borrar.
      fs.cpSync(src, dest, { recursive: true })
      fs.rmSync(src, { recursive: true })
    }
    return `Movido ${src} → ${dest}`
  },

  delete({ path: p }) {
    const target = checkPath(p)
    if (!fs.existsSync(target)) throw new Error(`No existe: ${target}`)
    if (path.parse(target).root === target) throw new Error('No se borra la raíz de una unidad')
    fs.rmSync(target, { recursive: true })
    return `Borrado ${target}`
  },

  exec({ command, cwd, shell }) {
    if (!cfg.allowCommands) throw new Error('Este PC no permite ejecutar comandos ("allowCommands": false en config.json)')
    if (typeof command !== 'string' || !command.trim()) throw new Error('Comando vacío')
    const workDir = cwd ? checkPath(cwd) : (cfg.roots[0] || os.homedir())
    const shellPath = process.platform === 'win32'
      ? (shell === 'cmd' ? 'cmd.exe' : 'powershell.exe')
      : '/bin/sh'
    return new Promise((resolve) => {
      exec(command, { cwd: workDir, shell: shellPath, timeout: EXEC_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const cut = (s) => (s.length > MAX_OUTPUT_CHARS ? `${s.slice(0, MAX_OUTPUT_CHARS)}\n…(recortado)` : s)
          resolve({
            codigoSalida: err ? (err.killed ? 'tiempo agotado' : err.code ?? 1) : 0,
            salida: cut(String(stdout)),
            errores: cut(String(stderr)),
          })
        })
    })
  },
}

// ── Outlook de escritorio (COM) ───────────────────────────────────────────
// Órdenes fijas de correo: el texto de cada script está aquí, los datos
// (ids, fechas, carpeta) llegan por variables de entorno, así ninguna orden
// puede colar un comando distinto. Nunca envían ni borran correos.
const OUTLOOK_HEADER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
catch {
  try { $ol = New-Object -ComObject Outlook.Application }
  catch { throw 'No se pudo abrir Outlook. Hace falta el Outlook de escritorio clásico (el "nuevo Outlook" no permite automatizarlo).' }
}
$ns = $ol.GetNamespace('MAPI')
$inbox = $ns.GetDefaultFolder(6)
# Bandejas de entrada de las cuentas de Outlook. Con BR_ACCOUNT solo la de
# esa dirección (por su cuenta de envío o por el nombre del buzón).
function AllInboxes {
  $list = @()
  foreach ($st in $ns.Stores) {
    try { $list += [pscustomobject]@{ cuenta = $st.DisplayName; folder = $st.GetDefaultFolder(6) } } catch {}
  }
  if (-not $list.Count) { $list += [pscustomobject]@{ cuenta = $inbox.Store.DisplayName; folder = $inbox } }
  $want = [string]$env:BR_ACCOUNT
  if (-not $want) { return $list }
  foreach ($acc in $ns.Accounts) {
    if ([string]$acc.SmtpAddress -ieq $want) {
      try { return @([pscustomobject]@{ cuenta = $want; folder = $acc.DeliveryStore.GetDefaultFolder(6) }) } catch {}
    }
  }
  $match = @($list | Where-Object { $_.cuenta -like ('*' + $want + '*') })
  if ($match.Count) { return $match }
  throw ('No encuentro la cuenta ' + $want + ' en Outlook. Cuentas disponibles: ' + (($list | ForEach-Object { $_.cuenta }) -join ', '))
}
function SenderSmtp($m) {
  try { if ($m.SenderEmailType -eq 'EX') { $u = $m.Sender.GetExchangeUser(); if ($u) { return $u.PrimarySmtpAddress } } } catch {}
  return $m.SenderEmailAddress
}
# Los ids que se dan a la oficina son "<buzón>|<correo>": fuera del buzón por
# defecto, Outlook necesita los dos para encontrar el mensaje.
function GetMail($id) {
  $parts = ([string]$id) -split '\\|', 2
  if ($parts.Count -eq 2) { return $ns.GetItemFromID($parts[1], $parts[0]) }
  return $ns.GetItemFromID($parts[0])
}
function Clip($s, $n) {
  if ($null -eq $s) { return '' }
  $t = (($s -replace '<?https?://[^\\s>]+>?', '') -replace '\\s+', ' ').Trim()
  if ($t.Length -gt $n) { return $t.Substring(0, $n) + '...' } else { return $t }
}
`

const OUTLOOK_SCRIPTS = {
  mail_list: `
$since = if ($env:BR_SINCE) { [datetime]::Parse($env:BR_SINCE) } else { (Get-Date).AddDays(-2) }
$max = [int]$env:BR_MAX
$unreadOnly = $env:BR_UNREAD -eq '1'
$out = New-Object System.Collections.ArrayList
foreach ($ib in (AllInboxes)) {
  $items = $ib.folder.Items
  $items.Sort('[ReceivedTime]', $true)
  $n = 0
  $m = $items.GetFirst()
  while ($m -ne $null -and $n -lt $max) {
    if ($m.Class -eq 43) {
      if ($m.ReceivedTime -lt $since) { break }
      if (-not $unreadOnly -or $m.UnRead) {
        [void]$out.Add([ordered]@{
          id = ($ib.folder.StoreID + '|' + $m.EntryID); cuenta = $ib.cuenta; de = $m.SenderName; email = (SenderSmtp $m); asunto = $m.Subject
          recibido = $m.ReceivedTime.ToString('yyyy-MM-ddTHH:mm'); leido = (-not $m.UnRead)
          categorias = $m.Categories; adjuntos = $m.Attachments.Count; extracto = (Clip $m.Body 400)
        })
        $n++
      }
    }
    $m = $items.GetNext()
  }
}
$sorted = @($out | Sort-Object { $_.recibido } -Descending | Select-Object -First $max)
ConvertTo-Json -InputObject $sorted -Depth 3 -Compress
`,
  mail_accounts: `
$res = @()
foreach ($ib in (AllInboxes)) {
  $items = $ib.folder.Items
  $items.Sort('[ReceivedTime]', $true)
  $first = $items.GetFirst()
  $res += [ordered]@{ cuenta = $ib.cuenta; correos = $items.Count; ultimo = $(if ($first) { $first.ReceivedTime.ToString('yyyy-MM-ddTHH:mm') } else { $null }) }
}
ConvertTo-Json -InputObject @($res) -Depth 3 -Compress
`,
  mail_read: `
$m = GetMail $env:BR_ID
$att = @()
foreach ($a in $m.Attachments) { $att += $a.FileName }
$body = [string]$m.Body
if ($body.Length -gt 8000) { $body = $body.Substring(0, 8000) + '...' }
ConvertTo-Json -Compress -Depth 3 -InputObject ([ordered]@{
  id = $env:BR_ID; de = $m.SenderName; email = (SenderSmtp $m); para = $m.To; cc = $m.CC
  asunto = $m.Subject; recibido = $m.ReceivedTime.ToString('yyyy-MM-ddTHH:mm')
  categorias = $m.Categories; adjuntos = $att; texto = $body
})
`,
  mail_categorize: `
$m = GetMail $env:BR_ID
$cat = $env:BR_CAT
$exists = $false
foreach ($c in $ns.Categories) { if ($c.Name -eq $cat) { $exists = $true } }
if (-not $exists) { try { [void]$ns.Categories.Add($cat, [int]$env:BR_COLOR) } catch {} }
$keep = @()
if ($m.Categories) { $keep = @($m.Categories -split ',\\s*' | Where-Object { $_ -and -not $_.StartsWith($env:BR_PREFIX) }) }
$m.Categories = (@($keep) + $cat) -join ', '
$m.Save()
ConvertTo-Json -Compress -InputObject ('Clasificado como ' + $cat + ': ' + $m.Subject)
`,
  mail_move: `
$m = GetMail $env:BR_ID
$f = $inbox
try { $f = $m.Parent.Store.GetDefaultFolder(6) } catch {}
foreach ($part in ($env:BR_FOLDER -split '[\\\\/]')) {
  $name = $part.Trim()
  if (-not $name) { continue }
  $next = $null
  foreach ($sf in $f.Folders) { if ($sf.Name -eq $name) { $next = $sf; break } }
  if (-not $next) { $next = $f.Folders.Add($name) }
  $f = $next
}
$subject = $m.Subject
[void]$m.Move($f)
ConvertTo-Json -Compress -InputObject ('Movido a ' + $f.FolderPath + ': ' + $subject)
`,
}

// Colores de las categorías "Gestoría: …" en Outlook (OlCategoryColor).
const CATEGORY_COLORS = { Urgente: 1, Cliente: 8, 'Banco/Notaría': 9, 'Administración': 6, Facturas: 4, Informativo: 5, Publicidad: 14 }

function runOutlook(kind, env) {
  if (process.platform !== 'win32') return Promise.reject(new Error('El correo solo funciona en Windows con Outlook de escritorio'))
  const script = OUTLOOK_HEADER + OUTLOOK_SCRIPTS[kind]
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env: { ...process.env, ...env }, timeout: 80_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).split('\n').filter((l) => l.trim()).slice(0, 3).join(' ')))
        try { resolve(JSON.parse(String(stdout).trim() || 'null')) } catch { resolve(String(stdout).trim()) }
      })
  })
}

Object.assign(handlers, {
  mail_list({ desde, max, soloNoLeidos, cuenta }) {
    return runOutlook('mail_list', {
      BR_ACCOUNT: cuenta ? String(cuenta) : '',
      BR_SINCE: desde ? String(desde) : '',
      BR_MAX: String(Math.min(Math.max(Number(max) || 20, 1), 50)),
      BR_UNREAD: soloNoLeidos ? '1' : '0',
    })
  },
  mail_accounts() {
    return runOutlook('mail_accounts', {})
  },
  mail_read({ id }) {
    return runOutlook('mail_read', { BR_ID: String(id || '') })
  },
  mail_categorize({ id, categoria, categoryPrefix }) {
    const short = String(categoria || '').replace(String(categoryPrefix || ''), '')
    return runOutlook('mail_categorize', {
      BR_ID: String(id || ''), BR_CAT: String(categoria || ''),
      BR_PREFIX: String(categoryPrefix || 'Gestoría: '), BR_COLOR: String(CATEGORY_COLORS[short] || 0),
    })
  },
  mail_move({ id, carpeta }) {
    if (!String(carpeta || '').trim()) throw new Error('Falta la carpeta')
    return runOutlook('mail_move', { BR_ID: String(id || ''), BR_FOLDER: String(carpeta) })
  },
})

function describe(cmd) {
  const p = cmd.payload || {}
  switch (cmd.kind) {
    case 'exec': return `EJECUTAR: ${p.command}${p.cwd ? `  (en ${p.cwd})` : ''}`
    case 'move': return `${p.copy ? 'COPIAR' : 'MOVER'}: ${p.from} → ${p.to}`
    case 'search': return `BUSCAR "${p.name}" en ${p.path}`
    case 'info': return 'INFO del equipo'
    case 'mail_list': return `CORREO: listar${p.desde ? ` desde ${p.desde}` : ''}`
    case 'mail_read': return 'CORREO: leer un mensaje'
    case 'mail_accounts': return 'CORREO: ver cuentas de Outlook'
    case 'mail_categorize': return `CORREO: clasificar como ${p.categoria}`
    case 'mail_move': return `CORREO: mover a ${p.carpeta}`
    default: return `${cmd.kind.toUpperCase()}: ${p.path}`
  }
}

async function api(route, body) {
  const res = await fetch(`${cfg.officeUrl}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw Object.assign(new Error('Token no válido: revisa "token" en config.json y PC_BRIDGE_TOKEN en la oficina'), { fatal: true })
  if (!res.ok) throw new Error(`La oficina respondió ${res.status}`)
  return res.json()
}

async function runCommand(cmd) {
  const handler = handlers[cmd.kind]
  log(`→ ${describe(cmd)}`)
  try {
    if (!handler) throw new Error(`Orden desconocida: ${cmd.kind}`)
    const result = await handler(cmd.payload || {})
    log('  ✓ hecho')
    return { id: cmd.id, ok: true, result }
  } catch (e) {
    log(`  ✗ ${e.message}`)
    return { id: cmd.id, ok: false, result: e.message }
  }
}

async function main() {
  log(`Puente conectado a ${cfg.officeUrl}`)
  log(`Acceso: ${cfg.roots.length ? cfg.roots.join(', ') : 'todo el PC'} · comandos ${cfg.allowCommands ? 'PERMITIDOS' : 'desactivados'}`)
  log('Deja esta ventana abierta mientras quieras que los agentes puedan usar el PC. Ctrl+C para cortar el acceso.')
  let failures = 0
  while (true) {
    try {
      const { command } = await api('/api/pc/poll', { hostname: os.hostname(), platform: process.platform })
      if (failures) log('Conexión recuperada.')
      failures = 0
      if (command) await api('/api/pc/result', await runCommand(command))
    } catch (e) {
      if (e.fatal) {
        console.error(`[Puente] ${e.message}`)
        pauseAndExit(1)
      }
      if (failures++ === 0) log(`Sin conexión con la oficina (${e.message}); reintentando...`)
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * failures)))
    }
  }
}

process.on('uncaughtException', (e) => {
  console.error('[Puente] Error inesperado:', e)
  pauseAndExit(1)
})

main()
