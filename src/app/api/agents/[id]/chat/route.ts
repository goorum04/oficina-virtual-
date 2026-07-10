import { db } from '@/lib/db'
import { anthropic, CHAT_MODEL } from '@/lib/anthropic'
import { getInstallationOctokit } from '@/lib/github'
import { GITHUB_TOOLS, runGithubTool } from '@/lib/github-tools'
import { NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import type { Octokit } from '@octokit/rest'

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
  githubRepo: string | null
}, teammates: { name: string; role: string }[]) {
  let base = `Eres ${agent.name}, ${agent.role} en un equipo de agentes de IA de una agencia de desarrollo. Tu función: ${agent.function || 'sin descripción específica'}.
Respondes en español, de forma profesional, breve y directa, como un compañero de equipo real (no como un asistente genérico). No inventes trabajo que no se te haya descrito; si no sabes algo, dilo.`

  if (agent.isSpokesperson) {
    const team = teammates.map(t => `- ${t.name} (${t.role})`).join('\n')
    base += `
Además eres el portavoz/Project Manager: el humano habla contigo para pedir reportes de estado, auditorías o coordinar al resto del equipo. Estos son tus compañeros:
${team}
Cuando te pidan un reporte o auditoría, responde de forma estructurada y concisa. Puedes mencionar que puede hablar directamente con cualquier compañero si lo prefiere.`
  }

  if (agent.githubRepo) {
    base += `
Tienes acceso al repositorio de GitHub "${agent.githubRepo}" mediante herramientas: puedes listar/leer archivos, escribir cambios en una rama nueva (nunca en la rama por defecto directamente), y abrir un Pull Request. NUNCA uses github_merge_pr a menos que el humano haya confirmado explícitamente en la conversación que quiere que mergees (por ejemplo "sí", "mergéalo", "adelante"). Si no está claro, pregunta primero y espera su respuesta antes de mergear.`
  }

  return base
}

async function runAgentTurn(opts: {
  system: string
  history: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[]
  octokit?: Octokit
  owner?: string
  repo?: string
}): Promise<string> {
  const messages: Anthropic.MessageParam[] = [...opts.history]

  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: CHAT_MODEL,
      max_tokens: 1024,
      system: opts.system,
      tools: opts.tools,
      messages,
    })

    if (response.stop_reason !== 'tool_use') {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n') || '(sin respuesta)'
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = opts.octokit && opts.owner && opts.repo
          ? await runGithubTool(opts.octokit, opts.owner, opts.repo, block.name, block.input as Record<string, unknown>)
          : 'GitHub tools not available for this agent.'
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return '(demasiados pasos de herramientas en esta petición, intenta algo más simple)'
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

  let octokit: Octokit | undefined
  let owner: string | undefined
  let repo: string | undefined
  if (agent.githubRepo) {
    const connection = await db.githubConnection.findFirst({ orderBy: { createdAt: 'desc' } })
    if (connection) {
      octokit = getInstallationOctokit(connection.installationId)
      ;[owner, repo] = agent.githubRepo.split('/')
    }
  }

  await db.agent.update({ where: { id }, data: { status: 'thinking' } })

  try {
    const text = await runAgentTurn({
      system: systemPromptFor(agent, teammates),
      history: history.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      tools: agent.githubRepo ? GITHUB_TOOLS : undefined,
      octokit,
      owner,
      repo,
    })

    const agentMessage = await db.message.create({
      data: { role: 'agent', content: text, agentId: id },
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
