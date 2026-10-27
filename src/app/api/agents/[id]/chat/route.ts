import { db } from '@/lib/db'
import { getInstallationOctokit } from '@/lib/github'
import { GITHUB_TOOLS } from '@/lib/github-tools'
import { pcToolsFor } from '@/lib/pc-tools'
import { mailToolsFor } from '@/lib/mail-tools'
import { CALL_AGENT_ID, gestoriaToolsFor } from '@/lib/gestoria-tools'
import { runAgentTurn, systemPromptFor } from '@/lib/agent-turn'
import { MODELS, pickModel } from '@/lib/model-router'
import { calcCostUsd } from '@/lib/pricing'
import { NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import type { Octokit } from '@octokit/rest'

// Un turno puede encadenar varias órdenes al PC (un comando espera hasta 2 min).
export const maxDuration = 300

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

  const isCallAgent = agent.id === CALL_AGENT_ID

  // Los mensajes más recientes (no los primeros de la conversación), en
  // orden cronológico. El agente de llamadas solo necesita los últimos.
  const history = (await db.message.findMany({
    where: { agentId: id },
    orderBy: { createdAt: 'desc' },
    take: isCallAgent ? 6 : 10,
    include: { attachments: { select: { filename: true } } },
  })).reverse()

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

  const gestoriaTools = gestoriaToolsFor(agent)
  // El agente de llamadas no usa el PC: cada herramienta de más hace la
  // respuesta más lenta.
  const pcTools = isCallAgent ? [] : pcToolsFor()
  const mailTools = mailToolsFor(agent)
  const tools = [...gestoriaTools, ...mailTools, ...pcTools, ...(agent.githubRepo ? GITHUB_TOOLS : [])]

  await db.agent.update({ where: { id }, data: { status: 'thinking' } })

  const tier = isCallAgent ? 'haiku' : pickModel(message || (attachments.length ? 'analiza este archivo' : ''), agent)

  try {
    const { text, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens } = await runAgentTurn({
      model: MODELS[tier],
      system: systemPromptFor(agent, teammates, gestoriaTools.length > 0, pcTools.length > 0, mailTools.length > 0),
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
      tools: tools.length ? tools : undefined,
      octokit,
      owner,
      repo,
      agentId: id,
      // Lo que cambia en GestoriaAD aparece también en la actividad de la oficina.
      onWrite: async (toolName) => {
        await db.activityLog.create({
          data: {
            type: 'agent_message',
            message: `${agent.name}: ${toolName.replace(/^(gestoria|pc)_/, '').replace(/_/g, ' ')} ${toolName.startsWith('pc_') ? 'en el PC' : 'en GestoriaAD'}`,
            agentId: id,
            projectId: agent.projectId,
          },
        })
      },
    })

    const costUsd = calcCostUsd(tier, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
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
