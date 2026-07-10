import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { notifyActivity, notifyAgentStatus, notifyTaskUpdate } from '@/lib/ws-notify'

const simulatedActions = [
  { type: 'task_progress', messages: [
    'Escribiendo tests unitarios para el módulo de autenticación...',
    'Refactorizando componente de navegación responsive...',
    'Implementando validación de formularios con Zod...',
    'Optimizando queries de base de datos con índices...',
    'Creando middleware de rate limiting...',
    'Configurando cache con Redis para sesiones...',
    'Implementando paginación cursor-based en la API...',
    'Añadiendo soporte para internacionalización (i18n)...',
    'Escribiendo documentación de la API con OpenAPI...',
    'Implementando notificaciones push con WebPush...',
    'Creando componente de gráficos con Recharts...',
    'Configurando CI/CD pipeline con GitHub Actions...',
    'Implementando manejo de archivos con upload resumable...',
    'Optimizando bundle size con code splitting...',
    'Añadiendo modo offline con Service Workers...',
  ]},
  { type: 'agent_message', messages: [
    'Analizando la arquitectura actual para proponer mejoras...',
    'Revisando dependencias con vulnerabilidades conocidas...',
    'Investigando patrones de diseño para este caso de uso...',
    'Evaluando rendimiento del endpoint de búsqueda...',
    'Comparando estrategias de state management...',
    'Mapeando flujos de usuario para el nuevo feature...',
    'Revisando logs de producción para encontrar bugs...',
    'Investigando compatibilidad con navegadores antiguos...',
    'Analizando requisitos del cliente para próxima sprint...',
    'Documentando decisiones técnicas del sprint actual...',
  ]},
  { type: 'info', messages: [
    'Linting completado sin errores',
    'Build de producción exitoso',
    'Todos los tests pasaron (47/47)',
    'Coverage de código: 87.3%',
    'Nuevo deploy a staging completado',
    'Migración de base de datos aplicada',
    'Dependencias actualizadas correctamente',
    'Análisis de seguridad completado — sin issues críticos',
  ]},
  { type: 'error', messages: [
    'Error de compilación: tipo no coincide en la línea 42',
    'Test fallido: expected 200 but received 500',
    'Timeout en conexión a servicio externo',
    'Memory leak detectado en el módulo de caché',
    'Conflictos de merge en la rama feature/auth',
  ]},
]

export async function POST(req: Request) {
  const { projectId } = await req.json()

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }

  // Get working agents for this project
  const agents = await db.agent.findMany({
    where: { projectId, status: { in: ['working', 'thinking'] } },
    include: {
      tasks: { where: { status: 'in_progress' } },
    },
  })

  if (agents.length === 0) {
    return NextResponse.json({ message: 'No active agents' })
  }

  // Pick a random agent
  const agent = agents[Math.floor(Math.random() * agents.length)]

  // Pick a random action type (weighted towards progress and messages)
  const actionWeights = [0.45, 0.35, 0.15, 0.05]
  let rand = Math.random()
  let actionIdx = 0
  for (let i = 0; i < actionWeights.length; i++) {
    rand -= actionWeights[i]
    if (rand <= 0) { actionIdx = i; break }
  }

  const action = simulatedActions[actionIdx]
  const message = action.messages[Math.floor(Math.random() * action.messages.length)]

  // Create log entry
  const log = await db.activityLog.create({
    data: {
      type: action.type,
      message,
      agentId: agent.id,
      taskId: agent.tasks[0]?.id || null,
      projectId,
    },
    include: {
      agent: { select: { id: true, name: true, avatar: true } },
      task: { select: { id: true, title: true } },
    },
  })
  notifyActivity(projectId, log)

  // Update task progress if it's a progress action and agent has an in-progress task
  if (action.type === 'task_progress' && agent.tasks.length > 0) {
    const task = agent.tasks[0]
    const newProgress = Math.min(100, task.progress + Math.floor(Math.random() * 8) + 1)
    const newStatus = newProgress >= 100 ? 'completed' : task.status

    await db.task.update({
      where: { id: task.id },
      data: { progress: newProgress },
    })
    notifyTaskUpdate(projectId, { taskId: task.id, progress: newProgress, status: newStatus })

    // If task completed, update status
    if (newProgress >= 100) {
      await db.task.update({
        where: { id: task.id },
        data: { status: 'completed' },
      })

      const completedLog = await db.activityLog.create({
        data: {
          type: 'task_completed',
          message: `Tarea completada: ${task.title}`,
          agentId: agent.id,
          taskId: task.id,
          projectId,
        },
        include: {
          agent: { select: { id: true, name: true, avatar: true } },
          task: { select: { id: true, title: true } },
        },
      })
      notifyActivity(projectId, completedLog)

      // Maybe assign a new pending task to the agent
      const pendingTask = await db.task.findFirst({
        where: { projectId, status: 'pending', agentId: null },
      })
      if (pendingTask) {
        await db.task.update({
          where: { id: pendingTask.id },
          data: { agentId: agent.id, status: 'in_progress' },
        })
        notifyTaskUpdate(projectId, { taskId: pendingTask.id, progress: pendingTask.progress, status: 'in_progress' })
      }
    }
  }

  // Randomly change agent status
  if (Math.random() < 0.2) {
    const statuses = ['working', 'thinking', 'waiting', 'working', 'working']
    const newStatus = statuses[Math.floor(Math.random() * statuses.length)]
    const updatedAgent = await db.agent.update({
      where: { id: agent.id },
      data: { status: newStatus },
    })
    notifyAgentStatus(projectId, agent.id, newStatus, updatedAgent)
  }

  return NextResponse.json(log)
}