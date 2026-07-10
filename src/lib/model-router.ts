export const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-4-8',
} as const

export type ModelTier = keyof typeof MODELS

const COMPLEX_KEYWORDS = /\b(explica|por qué|porque|compara|analiza|dise[ñn]a|planifica|plan|estrategia|revisa|audita|arquitectura|refactor|optimiza|debug|soluciona)\b/i
const REPORT_KEYWORDS = /\b(reporte|auditor[ií]a|resume|resumen|estado de|c[oó]mo va|actualizaci[oó]n)\b/i

/**
 * Picks a model tier per-message based on how demanding the task looks,
 * so simple chit-chat uses the cheap/fast model and only real work pays
 * for the expensive one.
 */
export function pickModel(message: string, agent: { githubRepo: string | null; isSpokesperson: boolean }): ModelTier {
  // Touching a real repo (reading/writing code, opening PRs) needs the strongest model.
  if (agent.githubRepo) return 'opus'

  if (agent.isSpokesperson && REPORT_KEYWORDS.test(message)) return 'sonnet'

  const isShort = message.trim().length < 60
  const looksComplex = COMPLEX_KEYWORDS.test(message)

  if (!looksComplex && isShort) return 'haiku'
  if (looksComplex) return 'opus'
  return 'sonnet'
}
