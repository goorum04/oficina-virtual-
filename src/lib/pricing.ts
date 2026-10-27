import type { ModelTier } from './model-router'

// USD per 1M tokens (standard, non-introductory pricing)
const PRICING: Record<ModelTier, { input: number; output: number }> = {
  haiku: { input: 1.0, output: 5.0 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 5.0, output: 25.0 },
}

// La caché de instrucciones cobra la escritura a 1,25× y la lectura a 0,1×
// del precio de entrada.
export function calcCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number, cacheWriteTokens = 0, cacheReadTokens = 0): number {
  const p = PRICING[tier]
  return (inputTokens * p.input + cacheWriteTokens * p.input * 1.25 + cacheReadTokens * p.input * 0.1 + outputTokens * p.output) / 1_000_000
}
