import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPreferenceDefault, parseDemoProfile, parseDemoSession } from '../../src/lib/demo-profile.ts';

test('demo profile validation sanitizes names and rejects invalid preference or date values', () => {
  assert.deepEqual(parseDemoProfile({
    displayName: '  <Researcher>\u0000  ',
    defaultRiskTolerance: 'medium',
    defaultResearchHorizon: '3_to_12_weeks',
    createdDate: '2026-10-11',
  }), {
    displayName: 'Researcher',
    defaultRiskTolerance: 'medium',
    defaultResearchHorizon: '3_to_12_weeks',
    createdDate: '2026-10-11',
  });
  assert.equal(parseDemoProfile({ displayName: '', defaultRiskTolerance: 'medium', defaultResearchHorizon: '3_to_12_weeks', createdDate: '2026-10-11' }), null);
  assert.equal(parseDemoProfile({ displayName: 'Test', defaultRiskTolerance: 'extreme', defaultResearchHorizon: '3_to_12_weeks', createdDate: '2026-10-11' }), null);
  assert.equal(parseDemoProfile({ displayName: 'Test', defaultRiskTolerance: 'medium', defaultResearchHorizon: '3_to_12_weeks', createdDate: '2026-02-30' }), null);
});

test('demo session validation requires the current version and active state', () => {
  assert.equal(parseDemoSession({ version: 1, active: true }), true);
  assert.equal(parseDemoSession({ version: 0, active: true }), false);
  assert.equal(parseDemoSession({ version: 1, active: false }), false);
  assert.equal(parseDemoSession('active'), false);
});

test('profile defaults apply until the user changes that preference this session', () => {
  assert.equal(applyPreferenceDefault('medium', 'high', false), 'high');
  assert.equal(applyPreferenceDefault('low', 'high', true), 'low');
  assert.equal(applyPreferenceDefault('low', undefined, false), 'low');
});
