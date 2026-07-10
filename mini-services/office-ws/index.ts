import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)

  socket.on('join-project', (projectId: string) => {
    socket.join(`project:${projectId}`)
    console.log(`Socket ${socket.id} joined project: ${projectId}`)
  })

  socket.on('leave-project', (projectId: string) => {
    socket.leave(`project:${projectId}`)
    console.log(`Socket ${socket.id} left project: ${projectId}`)
  })

  // When the API creates a new activity, it calls this endpoint
  socket.on('new-activity', (data: { projectId: string; log: any }) => {
    io.to(`project:${data.projectId}`).emit('activity', data.log)
  })

  socket.on('agent-status', (data: { projectId: string; agentId: string; status: string; agent: any }) => {
    io.to(`project:${data.projectId}`).emit('agent-update', {
      agentId: data.agentId,
      status: data.status,
      agent: data.agent,
    })
  })

  socket.on('task-update', (data: { projectId: string; task: any }) => {
    io.to(`project:${data.projectId}`).emit('task-updated', data.task)
  })

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = Number(process.env.PORT) || 3004
httpServer.listen(PORT, () => {
  console.log(`Office WebSocket server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('Shutting down...')
  httpServer.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  console.log('Shutting down...')
  httpServer.close(() => process.exit(0))
})