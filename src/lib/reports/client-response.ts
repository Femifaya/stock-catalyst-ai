import { z } from 'zod';
import { validateAiReport } from '@/lib/ai/validator.ts';
import type { ResearchRequest } from '@/lib/ai/types.ts';
import type { SavedReport } from './store.ts';

const requestSchema = z.object({
  symbol: z.string().regex(/^[A-Z][A-Z.\-]{0,9}$/),
  question: z.string().min(10).max(600),
  horizon: z.enum(['days_to_2_weeks', '2_to_8_weeks', '3_to_12_weeks', '6_to_18_months']),
  riskTolerance: z.enum(['low', 'medium', 'high']),
  entryPrice: z.number().finite().positive().nullable(),
  positionSize: z.number().finite().positive().nullable(),
}).strict();

const evidenceSchema = z.object({
  id: z.string().regex(/^EV-\d{3}$/),
  kind: z.enum(['fact', 'calculation', 'estimate', 'ai_interpretation']),
  label: z.string(),
  value: z.string().nullable(),
  source: z.string(),
  status: z.enum(['live', 'delayed', 'cached', 'uploaded', 'demo', 'unavailable']),
  asOf: z.string().nullable(),
  retrievedAt: z.string(),
  url: z.string().nullable(),
}).strict();

const catalystEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['earnings', 'news', 'macro', 'company', 'technical']),
  title: z.string(),
  detail: z.string().nullable(),
  date: z.string(),
  direction: z.enum(['positive', 'negative', 'mixed', 'unknown']),
  importance: z.enum(['high', 'medium', 'low']),
  isInPast: z.boolean(),
  evidenceId: z.string().nullable(),
  source: z.string(),
  status: z.string(),
}).strict();

const timelineSchema = z.object({
  entries: z.array(catalystEntrySchema),
  nextEarnings: catalystEntrySchema.nullable(),
  daysToNextEarnings: z.number().nullable(),
  warnings: z.array(z.string()),
  generatedAt: z.string(),
}).strict();

const envelopeSchema = z.object({
  id: z.string().regex(/^rpt_[a-z0-9]+$/i),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  generationMode: z.literal('qwen'),
  request: requestSchema,
  report: z.unknown(),
  evidence: z.array(evidenceSchema),
  catalysts: timelineSchema,
  warnings: z.array(z.string()),
}).strict();

export function parseQwenSavedReport(value: unknown, expected: ResearchRequest): SavedReport | null {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const { request } = parsed.data;
  if (request.symbol !== expected.symbol || request.question !== expected.question || request.horizon !== expected.horizon
    || request.riskTolerance !== expected.riskTolerance || request.entryPrice !== expected.entryPrice || request.positionSize !== expected.positionSize) return null;
  const validation = validateAiReport(parsed.data.report, {
    evidenceIds: new Set(parsed.data.evidence.map((item) => item.id)),
    symbol: request.symbol,
    question: request.question,
    horizon: request.horizon,
    riskTolerance: request.riskTolerance,
    entryPrice: request.entryPrice,
    positionSize: request.positionSize,
  });
  if (!validation.ok) return null;
  return { ...parsed.data, report: validation.value } satisfies SavedReport;
}
