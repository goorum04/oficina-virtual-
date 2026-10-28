# Oficina Virtual

Visualización 3D en tiempo real de una oficina donde "trabajan" agentes de
IA: cada agente aparece en su escritorio, con una animación distinta según su
estado (escribiendo, pensando, en espera, en descanso), un tipo de "cerebro"
(Claude Opus/Sonnet/Haiku, GPT-4o, Gemini, Llama, Mistral) con su propio
color/tamaño/velocidad, y puede reunirse con el resto del equipo en la sala
de reuniones para presentar un reporte del proyecto. Uno de los agentes es el
**portavoz** (Project Manager): es con quien se habla por defecto para pedir
reportes o auditorías, aunque también se puede chatear directamente con
cualquier otro agente. Las respuestas del chat las genera Claude a través de
la API de Anthropic.

## Equipo de la gestoría

Los agentes gestionan **GestoriaAD** (repo `goorum04/hubspot`) a través de su
API, cada uno en un área concreta:

| Agente | Área |
|--------|------|
| Nova (portavoz) | Coordinación: reportes de toda la gestoría, agenda, tareas del equipo, historial. Trabaja en el despacho de dirección |
| Clara | Clientes y KYC: altas, datos, documentación que falta, enlaces de subida |
| Pau | Procesos: residencias, sociedades, IE y sus pasos |
| Vera | Alertas, vencimientos y apostillas |
| Dora | Documentación: registro, análisis KYC con IA, checklists IE |
| Hugo | HubSpot: importaciones y sincronización |
| Olga | Correo de Outlook (en el PC): cada 20 minutos lo revisa, lo clasifica con categorías "Gestoría: …" y crea alertas o tareas para lo importante |
| Rayo | Llamadas: resumen de un cliente en segundos mientras hablas por teléfono |

Las herramientas están en `src/lib/gestoria-tools.ts`. Borrar datos u
operaciones masivas exigen que el humano lo confirme en el chat. Para
conectarlo:

1. En GestoriaAD, añade un usuario para la oficina a `APP_USERS`
   (p.ej. `oficina:<clave>`); así su historial de cambios registra lo que
   hacen los agentes.
2. En la oficina, define `GESTORIA_URL`, `GESTORIA_USER` y `GESTORIA_PASSWORD`.
3. `bun run db:push` y `bun run db:seed` para crear las tablas nuevas y el
   equipo (el seed borra el equipo anterior y sus chats).

## Revisión automática del correo

Mientras el puente del PC está abierto, cada vez que pregunta por órdenes
la oficina comprueba si toca revisar el correo (cada 20 minutos, ver
`src/lib/mail-review.ts`). Olga lee lo nuevo del Outlook de escritorio, lo
clasifica, crea alertas/tareas en GestoriaAD y deja el resumen en su chat y
en la actividad. En esas revisiones solo tiene herramientas de correo y de
crear alertas/tareas; nunca envía ni borra correos. Necesita el Outlook de
escritorio clásico (el "nuevo Outlook" no se puede automatizar).

## Acceso al PC

Con el programa `pc-bridge/` abierto en el PC de la gestoría, todos los
agentes pueden ver, buscar, leer (también PDF e imágenes), crear, mover y
borrar archivos, subirlos a la ficha de un cliente y ejecutar comandos.
Borrar y ejecutar piden confirmación en el chat. Instalación en
[`pc-bridge/README.md`](pc-bridge/README.md).

## Acceso a la oficina

Con `APP_USERS` definido, la oficina entera pide usuario y contraseña
(igual que GestoriaAD). Sin él sigue abierta, pero los agentes no reciben
las herramientas de GestoriaAD ni del PC.

![Vista de la oficina virtual](docs/preview.png)

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router) + TypeScript
- [react-three-fiber](https://docs.pmnd.rs/react-three-fiber) / [three.js](https://threejs.org/) + drei para la escena 3D (`src/components/office/Scene3D.tsx`)
- Tailwind CSS + shadcn/ui para la interfaz superpuesta
- Prisma + PostgreSQL (p.ej. [Supabase](https://supabase.com/)) para persistir proyectos, agentes, tareas y actividad
- Socket.IO para actualizaciones en tiempo real (servicio independiente en `mini-services/office-ws`)

## Estructura

```
src/app/                    Next.js App Router: página principal + API routes
src/app/api/                Endpoints REST (proyectos, agentes, tareas, actividad, simulación)
src/components/office/      Escena 3D (oficina, escritorios, agentes, sala de reuniones, descanso)
src/components/ui/          Componentes shadcn/ui
src/lib/                    Cliente de Prisma y helper de notificaciones WebSocket
prisma/schema.prisma        Modelos: Project, Agent, Task, ActivityLog, Message
mini-services/office-ws/    Servicio Socket.IO independiente (puerto 3004)
pc-bridge/                  Programa para el PC de la gestoría (acceso de los agentes)
scripts/seed.ts             Crea el equipo de 7 agentes de la gestoría con su área y portavoz
```

## Desarrollo local

Requiere [Bun](https://bun.sh/).

```bash
bun install
cp .env.example .env      # completa DATABASE_URL (Postgres) y ANTHROPIC_API_KEY
bun run db:push           # crea el esquema en la base
bun run db:seed           # crea el equipo de 7 agentes

bun run dev               # Next.js en http://localhost:3000
bun run dev:ws            # servicio WebSocket en el puerto 3004 (otra terminal)
```

## Despliegue en Vercel

Vercel no soporta procesos persistentes, así que el servicio WebSocket
(`mini-services/office-ws`) no corre ahí — la app sigue funcionando (el botón
"Simular" recarga los datos), pero sin push en tiempo real a menos que aloje
ese servicio aparte (Railway, Fly.io, etc.) y apunte `NEXT_PUBLIC_WS_URL` a él.
Necesita una base Postgres accesible desde internet (SQLite no funciona en
funciones serverless). Configura `DATABASE_URL` como variable de entorno del
proyecto en Vercel.

La app funciona sin el servicio WebSocket (la actividad se recarga al pulsar
"Simular"), pero con él las actualizaciones de agentes/tareas/actividad
llegan en tiempo real a todos los clientes conectados al mismo proyecto.

## Scripts

| Comando            | Descripción                                    |
|---------------------|-------------------------------------------------|
| `bun run dev`       | Servidor de desarrollo Next.js                  |
| `bun run dev:ws`    | Servicio WebSocket (`mini-services/office-ws`)  |
| `bun run build`     | Build de producción                             |
| `bun run start`     | Sirve el build de producción                    |
| `bun run lint`      | ESLint                                          |
| `bun run db:push`   | Sincroniza el esquema Prisma con la base Postgres |
| `bun run db:seed`   | Carga datos de ejemplo                          |

## Desarrollo histórico

`worklog.md` documenta, tarea por tarea, cómo se construyó la escena 3D
(oficina, cerebros por tipo de agente, sala de reuniones, sala de descanso).
