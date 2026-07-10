import { db } from '@/lib/db'

async function seed() {
  await db.project.deleteMany()

  const team = await db.project.create({
    data: {
      name: 'Mi Equipo',
      description: 'Equipo de agentes IA de la agencia',
      status: 'active',
      color: '#8b5cf6',
    },
  })

  await db.agent.createMany({
    data: [
      { id: 't-pm', name: 'Nova', role: 'Portavoz / Project Manager', function: 'Punto de contacto principal: reportes, auditorías, coordinación general del equipo y estado de todos los proyectos.', avatar: '🧭', brain: 'claude-opus', status: 'idle', isSpokesperson: true, projectId: team.id },
      { id: 't-be', name: 'Rex', role: 'Backend', function: 'APIs, base de datos, integraciones y lógica de servidor.', avatar: '⚙️', brain: 'claude-sonnet', status: 'idle', projectId: team.id },
      { id: 't-fe', name: 'Luma', role: 'Frontend', function: 'Interfaces, componentes React y experiencia de usuario en el navegador.', avatar: '🎨', brain: 'claude-sonnet', status: 'idle', projectId: team.id },
      { id: 't-des', name: 'Iris', role: 'Diseño UI/UX', function: 'Wireframes, identidad visual y flujos de usuario.', avatar: '🖌️', brain: 'gemini-pro', status: 'idle', projectId: team.id },
      { id: 't-qa', name: 'Byte', role: 'QA / Testing', function: 'Pruebas manuales y automatizadas, control de calidad antes de cada entrega.', avatar: '🧪', brain: 'claude-haiku', status: 'idle', projectId: team.id },
      { id: 't-ops', name: 'Atlas', role: 'DevOps', function: 'Despliegues, infraestructura, monitoreo y CI/CD.', avatar: '🛠️', brain: 'gpt-4o', status: 'idle', projectId: team.id },
      { id: 't-sup', name: 'Sol', role: 'Soporte / Atención al cliente', function: 'Responde dudas de clientes, incidencias y seguimiento post-entrega.', avatar: '💬', brain: 'mistral', status: 'idle', projectId: team.id },
    ],
  })

  console.log('Seed completed!')
}

seed()
  .catch(console.error)
  .finally(() => db.$disconnect())
