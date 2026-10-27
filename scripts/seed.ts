import { db } from '@/lib/db'

async function seed() {
  await db.project.deleteMany()

  const team = await db.project.create({
    data: {
      name: 'Gestoría',
      description: 'Equipo de agentes IA que gestiona GestoriaAD',
      status: 'active',
      color: '#8b5cf6',
    },
  })

  // Los ids fijan el área de cada agente en GestoriaAD (AGENT_AREAS en
  // src/lib/gestoria-tools.ts): cambiarlos aquí deja al agente sin herramientas.
  await db.agent.createMany({
    data: [
      { id: 't-pm', name: 'Nova', role: 'Portavoz / Coordinación', function: 'Punto de contacto principal: reportes y auditorías de toda la gestoría, agenda, tareas del equipo e historial de cambios.', avatar: '🧭', brain: 'claude-opus', status: 'idle', isSpokesperson: true, projectId: team.id },
      { id: 't-cli', name: 'Clara', role: 'Clientes y KYC', function: 'Altas y datos de clientes, nivel de riesgo y PEP, documentación que falta y enlaces de subida.', avatar: '🪪', brain: 'claude-sonnet', status: 'idle', projectId: team.id },
      { id: 't-pro', name: 'Pau', role: 'Procesos', function: 'Residencias, constitución de sociedades, IE y demás trámites: abre procesos y avanza sus pasos.', avatar: '📋', brain: 'claude-sonnet', status: 'idle', projectId: team.id },
      { id: 't-ale', name: 'Vera', role: 'Alertas y vencimientos', function: 'Vigila caducidades, apostillas y fechas límite; crea y revisa alertas.', avatar: '⏰', brain: 'claude-haiku', status: 'idle', projectId: team.id },
      { id: 't-doc', name: 'Dora', role: 'Documentación', function: 'Registro y estado de documentos, análisis KYC con IA, checklists de IE y documentos redactados.', avatar: '📄', brain: 'gemini-pro', status: 'idle', projectId: team.id },
      { id: 't-hs', name: 'Hugo', role: 'HubSpot', function: 'Importaciones de contactos y sincronización entre GestoriaAD y HubSpot.', avatar: '🔗', brain: 'gpt-4o', status: 'idle', projectId: team.id },
      { id: 't-call', name: 'Rayo', role: 'Llamadas', function: 'Mientras hablas por teléfono con un cliente, te dice al momento cómo va: procesos, siguiente paso, alertas, qué falta y último contacto.', avatar: '⚡', brain: 'claude-haiku', status: 'idle', projectId: team.id },
      { id: 't-mail', name: 'Olga', role: 'Bandeja de entrada', function: 'Correos de Outlook sin cliente: los asigna al cliente que toca o los archiva.', avatar: '📬', brain: 'mistral', status: 'idle', projectId: team.id },
    ],
  })

  console.log('Seed completed!')
}

seed()
  .catch(console.error)
  .finally(() => db.$disconnect())
