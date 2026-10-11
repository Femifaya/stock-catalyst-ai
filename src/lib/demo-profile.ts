import type { Horizon, RiskTolerance } from './config/env.ts';

export const DEMO_PROFILE_STORAGE_KEY = 'stock-catalyst-ai.demo-profile.v1';
export const DEMO_SESSION_STORAGE_KEY = 'stock-catalyst-ai.demo-session.v1';

export type DemoProfile = {
  displayName: string;
  defaultRiskTolerance: RiskTolerance;
  defaultResearchHorizon: Horizon;
  createdDate: string;
};

export function applyPreferenceDefault<T>(current: T, preferred: T | undefined, changedThisSession: boolean): T {
  return changedThisSession || preferred === undefined ? current : preferred;
}

const riskTolerances: readonly RiskTolerance[] = ['low', 'medium', 'high'];
const horizons: readonly Horizon[] = ['days_to_2_weeks', '2_to_8_weeks', '3_to_12_weeks', '6_to_18_months'];

function isRiskTolerance(value: unknown): value is RiskTolerance {
  return typeof value === 'string' && riskTolerances.some((risk) => risk === value);
}

function isHorizon(value: unknown): value is Horizon {
  return typeof value === 'string' && horizons.some((horizon) => horizon === value);
}

export function parseDemoProfile(value: unknown): DemoProfile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('displayName' in value) || !('defaultRiskTolerance' in value) || !('defaultResearchHorizon' in value) || !('createdDate' in value)) return null;
  if (typeof value.displayName !== 'string') return null;
  const displayName = value.displayName.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 60);
  if (displayName.length < 1) return null;
  if (!isRiskTolerance(value.defaultRiskTolerance)) return null;
  if (!isHorizon(value.defaultResearchHorizon)) return null;
  if (typeof value.createdDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.createdDate)) return null;
  const timestamp = Date.parse(`${value.createdDate}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value.createdDate) return null;
  return {
    displayName,
    defaultRiskTolerance: value.defaultRiskTolerance,
    defaultResearchHorizon: value.defaultResearchHorizon,
    createdDate: value.createdDate,
  };
}

export function parseDemoSession(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'active' in value && value.active === true && 'version' in value && value.version === 1;
}

export function readStoredValue(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  try {
    const stored = storage.getItem(key);
    return stored === null ? null : JSON.parse(stored) as unknown;
  } catch {
    return null;
  }
}
