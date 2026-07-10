import { db } from '@/lib/db'

async function seed() {
  // Create projects
  const p1 = await db.project.create({
    data: {
      name: 'E-Commerce Platform',
      description: 'Plataforma de comercio electrónico con Next.js y Stripe',
      status: 'active',
      color: '#10b981',
    },
  })

  const p2 = await db.project.create({
    data: {
      name: 'Mobile App Backend',
      description: 'API REST para aplicación móvil con autenticación JWT',
      status: 'active',
      color: '#f59e0b',
    },
  })

  const p3 = await db.project.create({
    data: {
      name: 'Data Analytics Dashboard',
      description: 'Dashboard de análisis de datos en tiempo real',
      status: 'active',
      color: '#8b5cf6',
    },
  })

  // Create agents for Project 1
  const a1 = await db.agent.create({
    data: {
      name: 'Claude Frontend',
      role: 'developer',
      avatar: '🎨',
      brain: 'claude-sonnet',
      status: 'working',
      projectId: p1.id,
    },
  })

  const a2 = await db.agent.create({
    data: {
      name: 'Claude Backend',
      role: 'developer',
      avatar: '⚙️',
      brain: 'claude-opus',
      status: 'working',
      projectId: p1.id,
    },
  })

  const a3 = await db.agent.create({
    data: {
      name: 'Claude QA',
      role: 'tester',
      avatar: '🧪',
      brain: 'gpt-4o',
      status: 'thinking',
      projectId: p1.id,
    },
  })

  // Create agents for Project 2
  const a4 = await db.agent.create({
    data: {
      name: 'Claude Architect',
      role: 'architect',
      avatar: '🏗️',
      brain: 'claude-opus',
      status: 'working',
      projectId: p2.id,
    },
  })

  const a5 = await db.agent.create({
    data: {
      name: 'Claude API Dev',
      role: 'developer',
      avatar: '🔧',
      brain: 'claude-haiku',
      status: 'idle',
      projectId: p2.id,
    },
  })

  // Create agents for Project 3
  const a6 = await db.agent.create({
    data: {
      name: 'Claude Data',
      role: 'developer',
      avatar: '📊',
      brain: 'gemini-pro',
      status: 'working',
      projectId: p3.id,
    },
  })

  const a7 = await db.agent.create({
    data: {
      name: 'Claude Reviewer',
      role: 'reviewer',
      avatar: '👀',
      brain: 'mistral',
      status: 'waiting',
      projectId: p3.id,
    },
  })

  // Create tasks for Project 1
  const t1 = await db.task.create({
    data: {
      title: 'Diseñar componente de carrito de compras',
      description: 'Crear el componente React para el carrito con animaciones',
      status: 'in_progress',
      priority: 'high',
      progress: 72,
      agentId: a1.id,
      projectId: p1.id,
    },
  })

  const t2 = await db.task.create({
    data: {
      title: 'Implementar API de pagos con Stripe',
      description: 'Integrar Stripe para procesamiento de pagos',
      status: 'in_progress',
      priority: 'critical',
      progress: 45,
      agentId: a2.id,
      projectId: p1.id,
    },
  })

  const t3 = await db.task.create({
    data: {
      title: 'Tests de integración para checkout',
      description: 'Escribir tests E2E para el flujo de compra completo',
      status: 'pending',
      priority: 'medium',
      progress: 0,
      agentId: a3.id,
      projectId: p1.id,
    },
  })

  const t4 = await db.task.create({
    data: {
      title: 'Optimizar imágenes con Next/Image',
      description: 'Configurar optimización automática de imágenes',
      status: 'completed',
      priority: 'low',
      progress: 100,
      agentId: a1.id,
      projectId: p1.id,
    },
  })

  // Create tasks for Project 2
  const t5 = await db.task.create({
    data: {
      title: 'Diseñar esquema de base de datos',
      description: 'Definir modelos Prisma para la app móvil',
      status: 'in_progress',
      priority: 'high',
      progress: 88,
      agentId: a4.id,
      projectId: p2.id,
    },
  })

  const t6 = await db.task.create({
    data: {
      title: 'Implementar autenticación JWT',
      description: 'Sistema de login/registro con tokens JWT',
      status: 'pending',
      priority: 'critical',
      progress: 0,
      agentId: a5.id,
      projectId: p2.id,
    },
  })

  // Create tasks for Project 3
  const t7 = await db.task.create({
    data: {
      title: 'Crear pipeline de datos en tiempo real',
      description: 'Configurar WebSocket para streaming de datos',
      status: 'in_progress',
      priority: 'high',
      progress: 60,
      agentId: a6.id,
      projectId: p3.id,
    },
  })

  const t8 = await db.task.create({
    data: {
      title: 'Revisión de código del módulo de gráficos',
      description: 'Review del componente de visualización',
      status: 'pending',
      priority: 'medium',
      progress: 0,
      agentId: a7.id,
      projectId: p3.id,
    },
  })

  // Create activity logs
  const logData = [
    { type: 'task_progress', message: 'Progreso del carrito: 72% completado — renderizando animaciones de productos', agentId: a1.id, taskId: t1.id, projectId: p1.id },
    { type: 'task_progress', message: 'Stripe API: configurando webhooks para notificaciones de pago', agentId: a2.id, taskId: t2.id, projectId: p1.id },
    { type: 'agent_message', message: 'Analizando casos de edge para el checkout flow...', agentId: a3.id, projectId: p1.id },
    { type: 'task_completed', message: 'Optimización de imágenes completada — lazy loading implementado', agentId: a1.id, taskId: t4.id, projectId: p1.id },
    { type: 'info', message: 'Pipeline de despliegue configurado exitosamente', projectId: p1.id },
    { type: 'task_progress', message: 'Esquema DB: 88% — faltan relaciones many-to-many', agentId: a4.id, taskId: t5.id, projectId: p2.id },
    { type: 'agent_message', message: 'Esperando que el esquema esté listo para comenzar auth', agentId: a5.id, projectId: p2.id },
    { type: 'task_progress', message: 'WebSocket: 60% — conectado al stream de datos, procesando eventos', agentId: a6.id, taskId: t7.id, projectId: p3.id },
    { type: 'agent_message', message: 'Revisando pull request #42 del módulo de gráficos...', agentId: a7.id, projectId: p3.id },
    { type: 'info', message: 'Deploy staging completado para E-Commerce Platform', projectId: p1.id },
    { type: 'task_started', message: 'Iniciando diseño del carrito de compras', agentId: a1.id, taskId: t1.id, projectId: p1.id },
    { type: 'task_started', message: 'Iniciando integración con Stripe', agentId: a2.id, taskId: t2.id, projectId: p1.id },
    { type: 'error', message: 'Error en test de integración: timeout en respuesta del servidor de pagos', agentId: a3.id, taskId: t3.id, projectId: p1.id },
    { type: 'task_progress', message: 'Stripe API: implementando manejo de errores y reintentos', agentId: a2.id, taskId: t2.id, projectId: p1.id },
  ]

  for (const log of logData) {
    await db.activityLog.create({
      data: {
        ...log,
        createdAt: new Date(Date.now() - Math.random() * 3600000),
      },
    })
  }

  console.log('Seed completed!')
}

seed()
  .catch(console.error)
  .finally(() => db.$disconnect())