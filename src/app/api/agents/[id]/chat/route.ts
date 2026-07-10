import { db } from '@/lib/db'
import { anthropic } from '@/lib/anthropic'
import { getInstallationOctokit } from '@/lib/github'
import { GITHUB_TOOLS, runGithubTool } from '@/lib/github-tools'
import { MODELS, pickModel } from '@/lib/model-router'
import { calcCostUsd } from '@/lib/pricing'
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
    include: { attachments: { select: { id: true, filename: true, mimeType: true } } },
  })
  return NextResponse.json(messages)
}

const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BASE64_LEN = 15_000_000 // ~11MB decoded

type IncomingAttachment = { filename: string; mimeType: string; data: string }

function sanitizeAttachments(input: unknown): IncomingAttachment[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((a): a is IncomingAttachment =>
      a && typeof a === 'object' &&
      typeof (a as IncomingAttachment).filename === 'string' &&
      typeof (a as IncomingAttachment).mimeType === 'string' &&
      typeof (a as IncomingAttachment).data === 'string' &&
      (a as IncomingAttachment).data.length > 0 &&
      (a as IncomingAttachment).data.length <= MAX_ATTACHMENT_BASE64_LEN
    )
    .slice(0, MAX_ATTACHMENTS)
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

function attachmentContentBlocks(attachments: IncomingAttachment[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = []
  for (const att of attachments) {
    if ((SUPPORTED_IMAGE_TYPES as readonly string[]).includes(att.mimeType)) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: att.mimeType as (typeof SUPPORTED_IMAGE_TYPES)[number], data: att.data },
      })
    } else if (att.mimeType === 'application/pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: att.data },
      })
    } else if (att.mimeType.startsWith('text/') || att.mimeType === 'application/json') {
      let decoded = ''
      try {
        decoded = Buffer.from(att.data, 'base64').toString('utf-8')
      } catch {
        decoded = ''
      }
      blocks.push({
        type: 'text',
        text: decoded
          ? `Archivo adjunto "${att.filename}":\n\n${decoded.slice(0, 20000)}`
          : `[Adjuntó el archivo "${att.filename}" pero no se pudo leer su contenido]`,
      })
    } else {
      blocks.push({
        type: 'text',
        text: `[Adjuntó el archivo "${att.filename}" (${att.mimeType}), formato no compatible para analizar directamente]`,
      })
    }
  }
  return blocks
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
  model: string
  system: string
  history: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[]
  octokit?: Octokit
  owner?: string
  repo?: string
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const messages: Anthropic.MessageParam[] = [...opts.history]
  let inputTokens = 0
  let outputTokens = 0

  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: opts.system,
      tools: opts.tools,
      messages,
    })
    inputTokens += response.usage.input_tokens
    outputTokens += response.usage.output_tokens

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n') || '(sin respuesta)'
      return { text, inputTokens, outputTokens }
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

  return { text: '(demasiados pasos de herramientas en esta petición, intenta algo más simple)', inputTokens, outputTokens }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { message, attachments: rawAttachments } = await req.json()
  const attachments = sanitizeAttachments(rawAttachments)

  if ((!message || typeof message !== 'string') && attachments.length === 0) {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  const agent = await db.agent.findUnique({ where: { id } })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const userMessage = await db.message.create({
    data: {
      role: 'user',
      content: message || '',
      agentId: id,
      ...(attachments.length
        ? { attachments: { create: attachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, data: a.data })) } }
        : {}),
    },
    include: { attachments: { select: { id: true, filename: true, mimeType: true } } },
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
    include: { attachments: { select: { filename: true } } },
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

  const tier = pickModel(message || (attachments.length ? 'analiza este archivo' : ''), agent)

  try {
    const { text, inputTokens, outputTokens } = await runAgentTurn({
      model: MODELS[tier],
      system: systemPromptFor(agent, teammates),
      history: history.map(m => {
        if (m.id === userMessage.id && attachments.length) {
          const blocks = attachmentContentBlocks(attachments)
          if (m.content) blocks.push({ type: 'text', text: m.content })
          return { role: 'user', content: blocks }
        }
        const placeholder = m.attachments.length
          ? `\n[Adjuntó: ${m.attachments.map(a => a.filename).join(', ')}]`
          : ''
        return {
          role: m.role === 'user' ? 'user' : 'assistant',
          content: (m.content || '(archivo adjunto)') + placeholder,
        }
      }),
      tools: agent.githubRepo ? GITHUB_TOOLS : undefined,
      octokit,
      owner,
      repo,
    })

    const costUsd = calcCostUsd(tier, inputTokens, outputTokens)
    const agentMessage = await db.message.create({
      data: { role: 'agent', content: text, model: tier, inputTokens, outputTokens, costUsd, agentId: id },
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
