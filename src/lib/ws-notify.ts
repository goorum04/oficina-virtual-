import { io, Socket } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3004'

let socket: Socket | null = null

function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, { transports: ['websocket'], reconnection: true })
    socket.on('connect_error', () => {
      // Office WS service is optional (e.g. not running in this environment);
      // the UI still works via polling/refetch, so failures here are non-fatal.
    })
  }
  return socket
}

export function notifyActivity(projectId: string, log: unknown) {
  getSocket().emit('new-activity', { projectId, log })
}

export function notifyAgentStatus(projectId: string, agentId: string, status: string, agent?: unknown) {
  getSocket().emit('agent-status', { projectId, agentId, status, agent })
}

export function notifyTaskUpdate(projectId: string, task: { taskId: string; progress: number; status: string }) {
  getSocket().emit('task-update', { projectId, task })
}
