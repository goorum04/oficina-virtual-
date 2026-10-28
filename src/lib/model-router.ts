export const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-4-8',
} as const

export type ModelTier = keyof typeof MODELS

const COMPLEX_KEYWORDS = /\b(explica|por qué|compara|analiza|dise[ñn]a|planifica|estrategia|audita|auditor[ií]a|reporte|informe)\b/i
// Órdenes que cambian datos reales (GestoriaAD, el PC, Outlook).
const ACTION_KEYWORDS = /\b(borra|elimina|crea|a[ñn]ade|cambia|actualiza|modifica|mueve|env[ií]a|sube|ejecuta|marca|asigna|archiva|importa|renombra|copia|clasifica|abre|cierra|completa)\b/i

/**
 * Elige el modelo por mensaje: el rápido para preguntas y charla (la mayoría
 * de mensajes), el intermedio para órdenes que cambian datos reales y para
 * análisis o informes largos. El más caro solo para trabajar con código.
 */
export function pickModel(
  message: string,
  agent: { githubRepo: string | null; isSpokesperson: boolean },
): ModelTier {
  if (agent.githubRepo) return 'opus'
  if (ACTION_KEYWORDS.test(message) || COMPLEX_KEYWORDS.test(message) || message.trim().length > 400) return 'sonnet'
  return 'haiku'
}
