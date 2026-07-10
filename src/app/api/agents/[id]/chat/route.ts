import { db } from '@/lib/db'
import { anthropic, CHAT_MODEL } from '@/lib/anthropic'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const messages = await db.message.findMany({
    where: { agentId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(messages)
}

function systemPromptFor(agent: {
  name: string
  role: string
  function: string | null
  isSpokesperson: boolean
}, teammates: { name: string; role: string }[]) {
  const base = `Eres ${agent.name}, ${agent.role} en un equipo de agentes de IA de una agencia de desarrollo. Tu función: ${agent.function || 'sin descripción específica'}.
Respondes en español, de forma profesional, breve y directa, como un compañero de equipo real (no como un asistente genérico). No inventes trabajo que no se te haya descrito; si no sabes algo, dilo.`

  if (!agent.isSpokesperson) return base

  const team = teammates.map(t => `- ${t.name} (${t.role})`).join('\n')
  return `${base}
Además eres el portavoz/Project Manager: el humano habla contigo para pedir reportes de estado, auditorías o coordinar al resto del equipo. Estos son tus compañeros:
${team}
Cuando te pidan un reporte o auditoría, responde de forma estructurada y concisa. Puedes mencionar que puede hablar directamente con cualquier compañero si lo prefiere.`
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { message } = await req.json()

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  const agent = await db.agent.findUnique({ where: { id } })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const userMessage = await db.message.create({
    data: { role: 'user', content: message, agentId: id },
  })

  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback = await db.message.create({
      data: {
        role: 'agent',
        content: '(IA no configurada todavía: falta la variable de entorno ANTHROPIC_API_KEY en el servidor)',
        agentId: id,
      },
    })
    return NextResponse.json({ userMessage, agentMessage: fallback })
  }

  const teammates = agent.isSpokesperson
    ? await db.agent.findMany({
        where: { projectId: agent.projectId, id: { not: agent.id } },
        select: { name: true, role: true },
      })
    : []

  const history = await db.message.findMany({
    where: { agentId: id },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })

  await db.agent.update({ where: { id }, data: { status: 'thinking' } })

  try {
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 512,
      system: systemPromptFor(agent, teammates),
      messages: history.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    })

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')

    const agentMessage = await db.message.create({
      data: { role: 'agent', content: text || '(sin respuesta)', agentId: id },
    })
    await db.agent.update({ where: { id }, data: { status: 'idle' } })

    return NextResponse.json({ userMessage, agentMessage })
  } catch (err) {
    await db.agent.update({ where: { id }, data: { status: 'error' } })
    const agentMessage = await db.message.create({
      data: { role: 'agent', content: `Error al contactar la IA: ${err instanceof Error ? err.message : 'desconocido'}`, agentId: id },
    })
    return NextResponse.json({ userMessage, agentMessage }, { status: 502 })
  }
}
