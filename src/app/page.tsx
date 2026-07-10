'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { io, Socket } from 'socket.io-client'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase, FolderOpen, Users, Loader2, Play, X,
  Activity, Zap, CheckCircle2, AlertTriangle, Brain, Sparkles, Clock, ChevronRight, ChevronDown, MessageSquare, Send, Crown, Github, Paperclip, FileText, Image as ImageIcon, DollarSign
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'

const Scene3D = dynamic(() => import('@/components/office/Scene3D'), { ssr: false })
import type { Agent3D } from '@/components/office/Scene3D'

/* ═══════════════════════ TYPES ═══════════════════════ */
interface Task { id: string; title: string; description?: string; status: string; priority: string; progress: number; agentId?: string | null; agent?: { id: string; name: string; avatar: string } | null }
interface ActivityLog { id: string; type: string; message: string; agent?: { id: string; name: string; avatar: string } | null; task?: { id: string; title: string } | null; createdAt: string }
interface Project { id: string; name: string; description?: string; status: string; color: string; agents?: { id: string; name: string; status: string; avatar: string; role: string }[]; tasks?: { id: string; title: string; progress: number; priority: string }[]; _count?: { agents: number; tasks: number; logs: number } }
interface ProjectDetail extends Project {
  agents: (Agent & { tasks: Task[] })[]
  tasks: (Task & { agent?: { id: string; name: string; avatar: string } | null })[]
  logs: ActivityLog[]
}
interface Agent { id: string; name: string; role: string; function?: string | null; avatar: string; brain?: string; status: string; isSpokesperson?: boolean; githubRepo?: string | null; tasks?: Task[] }
interface MessageAttachment { id: string; filename: string; mimeType: string }
interface ChatMessage { id: string; role: string; content: string; model?: string | null; costUsd?: number | null; createdAt: string; attachments?: MessageAttachment[] }
interface PendingAttachment { filename: string; mimeType: string; data: string }

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // 8MB per file

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] || '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
const MODEL_LABEL: Record<string, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' }
function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

const ST: Record<string, { l: string; c: string; i: React.ReactNode }> = {
  working: { l: 'Trabajando', c: '#22c55e', i: <Activity className="w-3 h-3" /> },
  thinking: { l: 'Pensando', c: '#eab308', i: <Brain className="w-3 h-3" /> },
  waiting: { l: 'En pausa', c: '#3b82f6', i: <Clock className="w-3 h-3" /> },
  idle: { l: 'En descanso', c: '#71717a', i: <Clock className="w-3 h-3" /> },
  error: { l: 'Error', c: '#ef4444', i: <AlertTriangle className="w-3 h-3" /> },
}
const PR: Record<string, { l: string; c: string }> = {
  critical: { l: 'Critico', c: 'bg-red-500/15 text-red-400 border-red-500/20' },
  high: { l: 'Alta', c: 'bg-orange-500/15 text-orange-400 border-orange-500/20' },
  medium: { l: 'Media', c: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' },
  low: { l: 'Baja', c: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20' },
}
const LI: Record<string, React.ReactNode> = {
  task_started: <Zap className="w-3 h-3 text-emerald-400" />,
  task_progress: <Activity className="w-3 h-3 text-sky-400" />,
  task_completed: <CheckCircle2 className="w-3 h-3 text-emerald-400" />,
  agent_message: <Brain className="w-3 h-3 text-violet-400" />,
  error: <AlertTriangle className="w-3 h-3 text-red-400" />,
  info: <Sparkles className="w-3 h-3 text-amber-400" />,
}
function ft(d: string) { return new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }

export default function VirtualOffice() {
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<Agent & { tasks: Task[] } | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const socketRef = useRef<Socket | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  /* ---- Fetch projects ---- */
  const [allAgents, setAllAgents] = useState<(Agent & { tasks: Task[] })[]>([])
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(async (data: Project[]) => {
      setProjects(data)
      if (data.length > 0) loadProject(data[0].id)
      else setLoading(false)
      // Load ALL agents from ALL projects for the 3D office view
      const allDetails = await Promise.all(data.map(p => fetch(`/api/projects/${p.id}`).then(r => r.json())))
      const merged = allDetails.flatMap(p => p.agents || [])
      setAllAgents(merged)
    }).catch(() => setLoading(false))
  }, [])

  /* ---- Load project detail ---- */
  const loadProject = useCallback(async (id: string) => {
    setLoading(true)
    setSelectedAgent(null)
    try {
      const res = await fetch(`/api/projects/${id}`)
      const data: ProjectDetail = await res.json()
      setCurrentProject(data)
      setLogs(data.logs || [])
    } catch { }
    setLoading(false)
  }, [])

  /* ---- WebSocket ---- */
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3004'
    const socket = io(wsUrl, { transports: ['websocket'] })
    socketRef.current = socket
    socket.on('connect', () => console.log('WS connected'))
    socket.on('activity', (log: ActivityLog) => {
      setLogs(prev => [log, ...prev].slice(0, 50))
    })
    socket.on('agent-update', (update: { agentId: string; status: string }) => {
      setCurrentProject(prev => {
        if (!prev) return prev
        return {
          ...prev,
          agents: prev.agents.map(a => a.id === update.agentId ? { ...a, status: update.status } : a),
        }
      })
    })
    socket.on('task-updated', (update: { taskId: string; progress: number; status: string }) => {
      setCurrentProject(prev => {
        if (!prev) return prev
        return {
          ...prev,
          tasks: prev.tasks.map(t => t.id === update.taskId ? { ...t, progress: update.progress, status: update.status } : t),
          agents: prev.agents.map(a => ({
            ...a,
            tasks: a.tasks.map(t => t.id === update.taskId ? { ...t, progress: update.progress, status: update.status } : t),
          })),
        }
      })
    })
    return () => { socket.disconnect() }
  }, [])

  /* ---- Join the WS room for the active project (so it receives live updates) ---- */
  useEffect(() => {
    const socket = socketRef.current
    const id = currentProject?.id
    if (!socket || !id) return
    socket.emit('join-project', id)
    return () => { socket.emit('leave-project', id) }
  }, [currentProject?.id])

  /* ---- Auto-scroll logs ---- */
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  /* ---- Simulate ---- */
  const simulate = useCallback(async () => {
    if (!currentProject) return
    setSimulating(true)
    try {
      await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProject.id }),
      })
      // Refresh data
      const res = await fetch(`/api/projects/${currentProject.id}`)
      const data: ProjectDetail = await res.json()
      setCurrentProject(data)
    } catch { }
    setSimulating(false)
  }, [currentProject])

  /* ═══ COSTS ═══ */
  const [totalCostUsd, setTotalCostUsd] = useState(0)
  const [costByAgent, setCostByAgent] = useState<Record<string, number>>({})

  const loadCosts = useCallback(async () => {
    try {
      const res = await fetch('/api/costs')
      const data = await res.json()
      setTotalCostUsd(data.total || 0)
      setCostByAgent(data.byAgent || {})
    } catch { }
  }, [])

  useEffect(() => {
    loadCosts()
  }, [loadCosts])

  /* ═══ CHAT ═══ */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([])
  const [fileError, setFileError] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setFileError('')
    const accepted: PendingAttachment[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setFileError(`"${file.name}" supera el límite de 8MB`)
        continue
      }
      if (pendingFiles.length + accepted.length >= 4) {
        setFileError('Máximo 4 archivos por mensaje')
        break
      }
      const data = await fileToBase64(file)
      accepted.push({ filename: file.name, mimeType: file.type || 'application/octet-stream', data })
    }
    setPendingFiles(prev => [...prev, ...accepted])
  }, [pendingFiles])

  useEffect(() => {
    setPendingFiles([])
    setFileError('')
    if (!selectedAgent) { setChatMessages([]); return }
    setChatLoading(true)
    fetch(`/api/agents/${selectedAgent.id}/chat`)
      .then(r => r.json())
      .then((data: ChatMessage[]) => setChatMessages(Array.isArray(data) ? data : []))
      .catch(() => setChatMessages([]))
      .finally(() => setChatLoading(false))
  }, [selectedAgent?.id])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim()
    if ((!text && pendingFiles.length === 0) || !selectedAgent || chatSending) return
    const attachments = pendingFiles
    setChatInput('')
    setPendingFiles([])
    setFileError('')
    setChatSending(true)
    try {
      const res = await fetch(`/api/agents/${selectedAgent.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, attachments }),
      })
      const data = await res.json()
      if (data.userMessage && data.agentMessage) {
        setChatMessages(prev => [...prev, data.userMessage, data.agentMessage])
        if (data.agentMessage.costUsd) loadCosts()
      }
    } catch { }
    setChatSending(false)
  }, [chatInput, pendingFiles, selectedAgent, chatSending, loadCosts])

  /* ═══ TEAM DROPDOWN ═══ */
  const [teamMenuOpenFor, setTeamMenuOpenFor] = useState<string | null>(null)

  /* ═══ GITHUB ═══ */
  const [githubConnected, setGithubConnected] = useState(false)
  const [githubAccount, setGithubAccount] = useState('')
  const [githubRepos, setGithubRepos] = useState<string[]>([])

  const loadGithubStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/github/repos')
      const data = await res.json()
      setGithubConnected(!!data.connected)
      setGithubAccount(data.account || '')
      setGithubRepos(data.repos || [])
    } catch { }
  }, [])

  useEffect(() => {
    loadGithubStatus()
    if (typeof window !== 'undefined' && window.location.search.includes('github=')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loadGithubStatus])

  const assignRepo = useCallback(async (agentId: string, repo: string) => {
    const res = await fetch(`/api/agents/${agentId}/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: repo || null }),
    })
    const updated = await res.json()
    setAllAgents(prev => prev.map(a => a.id === agentId ? { ...a, githubRepo: updated.githubRepo } : a))
    setSelectedAgent(prev => prev && prev.id === agentId ? { ...prev, githubRepo: updated.githubRepo } : prev)
  }, [])

  /* ═══ MEETING STATE ═══ */
  const [meetingPhase, setMeetingPhase] = useState<string>('idle')
  const [spokespersonId, setSpokespersonId] = useState<string>('')
  const [reportLines, setReportLines] = useState<string[]>([])
  const meetingTimerRef = useRef<NodeJS.Timeout[]>([])

  const generateReport = useCallback(() => {
    const agents = allAgents
    if (agents.length === 0) return { spokespersonId: '', lines: [] }
    // Pick the spokesperson or first agent
    const spokesperson = agents.find(a => a.isSpokesperson) || agents[0]
    const allTasks = agents.flatMap(a => a.tasks || [])
    const totalT = allTasks.length
    const completedT = allTasks.filter(t => t.status === 'completed').length
    const inProgress = allTasks.filter(t => t.status === 'in_progress')
    const avgP = totalT > 0 ? Math.round(allTasks.reduce((s, t) => s + t.progress, 0) / totalT) : 0
    const working = agents.filter(a => a.status === 'working').length

    const lines = [
      `REPORTE DE LA OFICINA`,
      `Agentes: ${agents.length} | Activos: ${working}`,
      `Tareas: ${completedT}/${totalT} completadas`,
      `Progreso medio: ${avgP}%`,
    ]
    inProgress.slice(0, 3).forEach(t => {
      lines.push(`  - ${t.title}: ${t.progress}%`)
    })
    lines.push('Estado general: operativo')

    return { spokespersonId: spokesperson.id, lines }
  }, [allAgents])

  const startMeeting = useCallback(() => {
    if (allAgents.length === 0 || meetingPhase !== 'idle') return
    setSelectedAgent(null)
    const { spokespersonId: spId, lines } = generateReport()

    // Phase 1: Walking to meeting room (4s)
    setSpokespersonId(spId)
    setMeetingPhase('walking')

    // Phase 2: Seated (1.5s)
    meetingTimerRef.current.push(setTimeout(() => setMeetingPhase('seated'), 4000))

    // Phase 3: Discussing (3s)
    meetingTimerRef.current.push(setTimeout(() => setMeetingPhase('discussing'), 5500))

    // Phase 4: Reporting (6s)
    meetingTimerRef.current.push(setTimeout(() => {
      setReportLines(lines)
      setMeetingPhase('reporting')
    }, 8500))

    // Phase 5: Returning (4s)
    meetingTimerRef.current.push(setTimeout(() => {
      setReportLines([])
      setMeetingPhase('returning')
    }, 15000))

    // Phase 6: Back to normal
    meetingTimerRef.current.push(setTimeout(() => {
      setMeetingPhase('idle')
      setSpokespersonId('')
      meetingTimerRef.current = []
    }, 20000))
  }, [allAgents, meetingPhase, generateReport])

  // Cleanup timers on unmount
  useEffect(() => () => meetingTimerRef.current.forEach(clearTimeout), [])

  /* ---- 3D agents (ALL agents from all projects) ---- */
  const agents3D: Agent3D[] = allAgents.map(a => ({
    id: a.id, name: a.name, role: a.role, avatar: a.avatar, brain: a.brain,
    status: a.status, tasks: (a.tasks || []).map(t => ({ id: t.id, title: t.title, status: t.status, progress: t.progress, priority: t.priority })),
  }))

  /* ---- Stats ---- */
  const workingCount = currentProject?.agents.filter(a => a.status === 'working').length || 0
  const restingCount = allAgents.filter(a => a.status === 'idle').length || 0
  const totalTasks = currentProject?.tasks.length || 0
  const completedTasks = currentProject?.tasks.filter(t => t.status === 'completed').length || 0
  const avgProgress = totalTasks > 0 ? Math.round(currentProject!.tasks.reduce((s, t) => s + t.progress, 0) / totalTasks) : 0

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0d0d1a]">
      {/* ══════ 3D SCENE ══════ */}
      <div className="absolute inset-0 z-0">
        {loading && !currentProject ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
              <span className="text-zinc-400 text-sm">Cargando oficina...</span>
            </div>
          </div>
        ) : (
          <Scene3D
            agents={agents3D}
            onAgentClick={(a) => {
              if (meetingPhase === 'idle') {
                const full = allAgents.find(x => x.id === a.id)
                if (full) setSelectedAgent(full)
              }
            }}
            meetingPhase={meetingPhase}
            spokespersonId={spokespersonId}
            reportLines={reportLines}
          />
        )}
      </div>

      {/* ══════ TOP BAR ══════ */}
      <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
        <div className="flex items-center justify-between p-4">
          {/* Left - Project selector */}
          <div className="pointer-events-auto flex items-center gap-3">
            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2.5 shadow-2xl">
              <div className="w-2.5 h-2.5 rounded-full bg-violet-500 shadow-lg shadow-violet-500/50 animate-pulse" />
              <span className="text-white/90 font-semibold text-sm tracking-tight">Virtual Office</span>
            </div>

            {projects.map(p => (
              <div key={p.id} className="relative">
                <button
                  onClick={() => {
                    loadProject(p.id)
                    setTeamMenuOpenFor(prev => prev === p.id ? null : p.id)
                  }}
                  className={`pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-200 border ${
                    currentProject?.id === p.id
                      ? 'bg-white/15 border-white/20 text-white shadow-lg'
                      : 'bg-black/40 border-white/[0.06] text-white/50 hover:bg-black/60 hover:text-white/70'
                  } backdrop-blur-xl`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {p.name}
                  <ChevronDown className={`w-3 h-3 transition-transform ${teamMenuOpenFor === p.id ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {teamMenuOpenFor === p.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setTeamMenuOpenFor(null)} />
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="absolute top-full left-0 mt-2 w-64 z-50 bg-black/80 backdrop-blur-2xl border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden"
                      >
                        <div className="px-3.5 py-2.5 border-b border-white/[0.06] text-white/40 text-[10px] font-semibold uppercase tracking-wider">
                          Agentes del equipo
                        </div>
                        <ScrollArea className="max-h-72">
                          <div className="p-1.5">
                            {allAgents.map(a => (
                              <button
                                key={a.id}
                                onClick={() => { setSelectedAgent(a); setTeamMenuOpenFor(null) }}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/[0.06] transition-colors text-left"
                              >
                                <span className="text-lg flex-shrink-0">{a.avatar}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-white/90 font-medium truncate">{a.name}</span>
                                    {a.isSpokesperson && <Crown className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                                  </div>
                                  <span className="text-[10px] text-white/40 truncate block">{a.role}</span>
                                </div>
                                {!!costByAgent[a.id] && (
                                  <span className="text-[10px] text-lime-400/70 font-medium flex-shrink-0">{formatCost(costByAgent[a.id])}</span>
                                )}
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ST[a.status]?.c || '#71717a' }} />
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

          {/* Right - Stats + Simulate */}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Live stats pills */}
            <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2.5 shadow-2xl">
              <div className="flex items-center gap-1.5 text-xs">
                <Users className="w-3.5 h-3.5 text-white/40" />
                <span className="text-white/70">{currentProject?.agents.length || 0}</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-1.5 text-xs">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">{workingCount}</span>
              </div>
              {restingCount > 0 && (
                <>
                  <div className="w-px h-4 bg-white/10" />
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-sm">📺</span>
                    <span className="text-blue-300/80 font-medium">{restingCount} descanso</span>
                  </div>
                </>
              )}
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-white/70">{completedTasks}/{totalTasks}</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-1.5 text-xs min-w-[60px]">
                <span className="text-white/40">Progreso</span>
                <span className="text-white/90 font-semibold">{avgProgress}%</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-1.5 text-xs" title="Gasto total en IA">
                <DollarSign className="w-3.5 h-3.5 text-lime-400" />
                <span className="text-lime-300 font-semibold">{formatCost(totalCostUsd)}</span>
              </div>
            </div>

            {githubConnected ? (
              <div className="pointer-events-auto flex items-center gap-1.5 bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white/50">
                <Github className="w-3.5 h-3.5 text-emerald-400" />
                {githubAccount}
              </div>
            ) : (
              <a href="/api/github/connect" className="pointer-events-auto">
                <Button size="sm" className="rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white shadow-lg border-0">
                  <Github className="w-3.5 h-3.5 mr-1.5" />
                  Conectar GitHub
                </Button>
              </a>
            )}

            {allAgents.some(a => a.isSpokesperson) && (
              <Button
                onClick={() => setSelectedAgent(allAgents.find(a => a.isSpokesperson) || null)}
                size="sm"
                className="rounded-xl bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/20 border-0"
              >
                <Crown className="w-3.5 h-3.5 mr-1.5" />
                Hablar con Portavoz
              </Button>
            )}

            <Button
              onClick={simulate}
              disabled={simulating || meetingPhase !== 'idle'}
              size="sm"
              className="rounded-xl bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/20 border-0"
            >
              {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
              Simular
            </Button>

            <Button
              onClick={startMeeting}
              disabled={meetingPhase !== 'idle' || allAgents.length === 0}
              size="sm"
              className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 border-0"
            >
              {meetingPhase !== 'idle'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                : <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
              }
              {meetingPhase === 'idle' ? 'Solicitar Reporte' :
               meetingPhase === 'walking' ? 'Caminando...' :
               meetingPhase === 'seated' ? 'Sentados...' :
               meetingPhase === 'discussing' ? 'Discutiendo...' :
               meetingPhase === 'reporting' ? 'Reportando...' :
               'Volviendo...'}
            </Button>
          </div>
        </div>
      </div>

      {/* ══════ BOTTOM ACTIVITY FEED ══════ */}
      <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none">
        <div className="p-4 flex items-end justify-between gap-4">
          {/* Activity Feed */}
          <div className="pointer-events-auto flex-1 max-w-lg">
            <div className="bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-white/80 text-xs font-semibold">Actividad en tiempo real</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50" />
              </div>
              <ScrollArea className="h-36 p-2">
                {logs.length === 0 ? (
                  <div className="text-center text-white/30 text-xs py-6">Sin actividad todavia...</div>
                ) : (
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <motion.div
                        key={log.id || i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="mt-0.5">{LI[log.type] || <Sparkles className="w-3 h-3 text-zinc-400" />}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-white/70 leading-relaxed truncate">{log.message}</p>
                          {log.agent && (
                            <span className="text-[10px] text-white/30">{log.agent.name} · {ft(log.createdAt)}</span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          {/* Task progress mini panel */}
          {currentProject && currentProject.tasks.length > 0 && (
            <div className="pointer-events-auto w-72">
              <div className="bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
                  <Briefcase className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-white/80 text-xs font-semibold">Tareas</span>
                </div>
                <ScrollArea className="h-36 p-2">
                  <div className="space-y-2">
                    {currentProject.tasks.map(task => (
                      <div key={task.id} className="px-2.5 py-1.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-white/70 truncate max-w-[150px]">{task.title}</span>
                          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border ${PR[task.priority]?.c || PR.low.c}`}>
                            {PR[task.priority]?.l || task.priority}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: task.status === 'completed' ? '#22c55e' : task.status === 'in_progress' ? '#6366f1' : '#71717a' }}
                              animate={{ width: `${task.progress}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                          <span className="text-[10px] text-white/40 w-7 text-right">{task.progress}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══════ AGENT DETAIL PANEL ══════ */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute top-20 right-4 z-40 w-96"
          >
            <div className="bg-black/70 backdrop-blur-2xl border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="relative px-5 py-4 border-b border-white/[0.06]">
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center hover:bg-white/[0.12] transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-white/50" />
                </button>
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold text-white shadow-lg"
                    style={{
                      background: `linear-gradient(135deg, ${ST[selectedAgent.status]?.c || '#71717a'}, ${ST[selectedAgent.status]?.c || '#71717a'}88)`,
                      boxShadow: `0 4px 20px ${ST[selectedAgent.status]?.c || '#71717a'}40`
                    }}
                  >
                    {selectedAgent.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-white font-semibold text-sm">{selectedAgent.name}</h3>
                      {selectedAgent.isSpokesperson && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                    </div>
                    <p className="text-white/40 text-xs capitalize">{selectedAgent.role}</p>
                  </div>
                </div>
                {selectedAgent.function && (
                  <p className="text-white/50 text-xs mt-2 leading-relaxed">{selectedAgent.function}</p>
                )}
                {/* Brain type badge */}
                {selectedAgent.brain && (
                  <div className="flex items-center gap-2 mt-2">
                    <Brain className="w-3 h-3 text-violet-400" />
                    <span className="text-xs font-medium text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-lg px-2 py-0.5">
                      {selectedAgent.brain.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-2.5">
                  {ST[selectedAgent.status]?.i}
                  <span className="text-xs font-medium" style={{ color: ST[selectedAgent.status]?.c }}>
                    {ST[selectedAgent.status]?.l}
                  </span>
                </div>
              </div>

              {/* Tasks */}
              <div className="p-4">
                <h4 className="text-white/50 text-[10px] font-semibold uppercase tracking-wider mb-3">Tareas asignadas</h4>
                {(!selectedAgent.tasks || selectedAgent.tasks.length === 0) ? (
                  <p className="text-white/20 text-xs">Sin tareas</p>
                ) : (
                  <div className="space-y-2.5">
                    {selectedAgent.tasks.map(task => (
                      <div key={task.id} className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.05]">
                        <div className="flex items-start justify-between mb-1.5">
                          <span className="text-xs text-white/80 font-medium leading-tight">{task.title}</span>
                          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border flex-shrink-0 ml-2 ${PR[task.priority]?.c || PR.low.c}`}>
                            {PR[task.priority]?.l || task.priority}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: task.status === 'completed' ? '#22c55e' : task.status === 'in_progress' ? '#6366f1' : '#71717a' }}
                              animate={{ width: `${task.progress}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                          <span className="text-[10px] text-white/40 w-7 text-right">{task.progress}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* GitHub repo assignment */}
              {githubConnected && (
                <div className="border-t border-white/[0.06] p-4">
                  <h4 className="text-white/50 text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Github className="w-3 h-3" /> Repositorio
                  </h4>
                  <select
                    value={selectedAgent.githubRepo || ''}
                    onChange={e => assignRepo(selectedAgent.id, e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500/50"
                  >
                    <option value="" className="bg-zinc-900">Sin repositorio asignado</option>
                    {githubRepos.map(r => (
                      <option key={r} value={r} className="bg-zinc-900">{r}</option>
                    ))}
                  </select>
                  {selectedAgent.githubRepo && (
                    <p className="text-white/30 text-[10px] mt-1.5">
                      Puede leer/escribir archivos y abrir PRs en este repo. Solo mergea si tú lo confirmas en el chat.
                    </p>
                  )}
                </div>
              )}

              {/* Chat */}
              <div className="border-t border-white/[0.06] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-white/50 text-[10px] font-semibold uppercase tracking-wider">
                    Chat {selectedAgent.isSpokesperson && '· reportes y auditorías'}
                  </h4>
                  {!!costByAgent[selectedAgent.id] && (
                    <span className="flex items-center gap-1 text-[10px] text-lime-400/80 font-medium">
                      <DollarSign className="w-2.5 h-2.5" />
                      {formatCost(costByAgent[selectedAgent.id])}
                    </span>
                  )}
                </div>
                <ScrollArea className="h-52 pr-2">
                  <div className="space-y-2">
                    {chatLoading ? (
                      <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-white/30" /></div>
                    ) : chatMessages.length === 0 ? (
                      <p className="text-white/20 text-xs">Escribe para empezar a hablar con {selectedAgent.name}.</p>
                    ) : (
                      chatMessages.map(m => (
                        <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                          {m.attachments && m.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1 max-w-[85%] justify-end">
                              {m.attachments.map(a => (
                                <span key={a.id} className="flex items-center gap-1 bg-white/[0.08] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[9px] text-white/50">
                                  {a.mimeType.startsWith('image/') ? <ImageIcon className="w-2.5 h-2.5" /> : <FileText className="w-2.5 h-2.5" />}
                                  {a.filename}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.content && (
                            <div className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                              m.role === 'user'
                                ? 'bg-violet-600/80 text-white'
                                : 'bg-white/[0.06] text-white/80'
                            }`}>
                              {m.content}
                            </div>
                          )}
                          {m.role === 'agent' && m.model && (
                            <span className="text-[9px] text-white/25 mt-0.5 px-1">
                              {MODEL_LABEL[m.model] || m.model}
                              {!!m.costUsd && ` · ${formatCost(m.costUsd)}`}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {pendingFiles.map((f, i) => (
                      <span key={i} className="flex items-center gap-1 bg-white/[0.08] border border-white/[0.08] rounded-md pl-1.5 pr-1 py-0.5 text-[10px] text-white/60">
                        {f.mimeType.startsWith('image/') ? <ImageIcon className="w-2.5 h-2.5" /> : <FileText className="w-2.5 h-2.5" />}
                        {f.filename}
                        <button
                          onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="ml-0.5 hover:text-white"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {fileError && <p className="text-red-400 text-[10px] mt-2">{fileError}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,application/pdf,text/*,.json"
                    className="hidden"
                    onChange={e => { handleFilesSelected(e.target.files); e.target.value = '' }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={chatSending}
                    title="Adjuntar archivo"
                    className="w-8 h-8 flex-shrink-0 rounded-lg bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.1] disabled:opacity-40 flex items-center justify-center transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-white/60" />
                  </button>
                  <input
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendChatMessage() }}
                    placeholder="Escribe un mensaje..."
                    disabled={chatSending}
                    className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/25 outline-none focus:border-violet-500/50"
                  />
                  <button
                    onClick={sendChatMessage}
                    disabled={chatSending || (!chatInput.trim() && pendingFiles.length === 0)}
                    className="w-8 h-8 flex-shrink-0 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center transition-colors"
                  >
                    {chatSending ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Send className="w-3.5 h-3.5 text-white" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ MEETING STATUS BANNER ══════ */}
      <AnimatePresence>
        {meetingPhase !== 'idle' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-40"
          >
            <div className="bg-black/70 backdrop-blur-2xl border border-emerald-500/20 rounded-2xl px-5 py-3 shadow-2xl shadow-emerald-500/10 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50" />
              <span className="text-white/80 text-xs font-medium">
                {meetingPhase === 'walking' && 'Los agentes van caminando a la sala de reuniones...'}
                {meetingPhase === 'seated' && 'Agentes sentados en la sala de reuniones'}
                {meetingPhase === 'discussing' && 'Discutiendo el reporte del proyecto...'}
                {meetingPhase === 'reporting' && 'Presentando el reporte...'}
                {meetingPhase === 'returning' && 'Los agentes vuelven a sus puestos...'}
              </span>
              {meetingPhase === 'reporting' && reportLines.length > 0 && (
                <div className="w-px h-4 bg-white/10" />
              )}
              {meetingPhase === 'reporting' && reportLines.slice(0, 2).map((line, i) => (
                <span key={i} className="text-[10px] text-emerald-300/70 max-w-[200px] truncate">{line}</span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ INSTRUCTIONS HINT ══════ */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none opacity-0" id="hint">
        <div className="bg-black/50 backdrop-blur-xl border border-white/[0.06] rounded-full px-4 py-2 flex items-center gap-2">
          <span className="text-white/30 text-[11px]">Arrastra para rotar · Scroll para zoom · Click en un agente para detalles</span>
        </div>
      </div>

      {/* CSS for pulse + fadeIn animations */}
      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}