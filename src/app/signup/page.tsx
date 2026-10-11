'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { SiteHeader } from '@/components/site-header.tsx';
import { DemoProfileNotice } from '@/components/demo-profile-notice.tsx';
import { useDemoProfile } from '@/components/demo-profile-provider.tsx';
import type { Horizon, RiskTolerance } from '@/lib/config/env.ts';

const horizons: ReadonlyArray<[Horizon, string]> = [
  ['days_to_2_weeks', 'Days to 2 weeks'], ['2_to_8_weeks', '2 to 8 weeks'], ['3_to_12_weeks', '3 to 12 weeks'], ['6_to_18_months', '6 to 18 months'],
];

export default function SignupPage() {
  const router = useRouter();
  const { ready, createProfile, signedIn } = useDemoProfile();
  const [displayName, setDisplayName] = useState('');
  const [risk, setRisk] = useState<RiskTolerance>('medium');
  const [horizon, setHorizon] = useState<Horizon>('3_to_12_weeks');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      createProfile({ displayName, defaultRiskTolerance: risk, defaultResearchHorizon: horizon });
      router.push('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the demo profile.'); }
  }

  return <main className="shell"><SiteHeader activeSection="signup"/><section className="content auth-content"><p className="eyebrow">BROWSER-ONLY PROFILE</p><h1>Create demo profile</h1><DemoProfileNotice />
    {signedIn ? <p>A demo profile is already active. <Link href="/profile">View profile</Link>.</p> : <form className="auth-form" onSubmit={submit}>
      <label>Display name<input required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="off"/></label>
      <label>Default risk tolerance<select value={risk} onChange={(event) => { const value = event.target.value; if (value === 'low' || value === 'medium' || value === 'high') setRisk(value); }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label>Default research horizon<select value={horizon} onChange={(event) => { const option = horizons.find(([candidate]) => candidate === event.target.value); if (option) setHorizon(option[0]); }}>{horizons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error && <p role="alert" className="error">{error}</p>}<button disabled={!ready} type="submit">Create local demo profile</button>
      <p>Already created a profile in this browser? <Link href="/login">Demo login</Link></p>
    </form>}</section></main>;
}
