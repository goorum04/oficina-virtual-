import type { ModelTier } from './model-router'

// USD per 1M tokens (standard, non-introductory pricing)
const PRICING: Record<ModelTier, { input: number; output: number }> = {
  haiku: { input: 1.0, output: 5.0 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 5.0, output: 25.0 },
}

export function calcCostUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const p = PRICING[tier]
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}
