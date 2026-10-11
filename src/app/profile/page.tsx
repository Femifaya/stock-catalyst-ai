'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { SiteHeader } from '@/components/site-header.tsx';
import { DemoProfileNotice } from '@/components/demo-profile-notice.tsx';
import { useDemoProfile } from '@/components/demo-profile-provider.tsx';
import type { Horizon, RiskTolerance } from '@/lib/config/env.ts';

const horizons: ReadonlyArray<[Horizon, string]> = [
  ['days_to_2_weeks', 'Days to 2 weeks'], ['2_to_8_weeks', '2 to 8 weeks'], ['3_to_12_weeks', '3 to 12 weeks'], ['6_to_18_months', '6 to 18 months'],
];

export default function ProfilePage() {
  const router = useRouter();
  const { ready, profile, signedIn, updateProfile, signOut, deleteProfile } = useDemoProfile();
  const [displayName, setDisplayName] = useState('');
  const [risk, setRisk] = useState<RiskTolerance>('medium');
  const [horizon, setHorizon] = useState<Horizon>('3_to_12_weeks');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (ready && (!signedIn || !profile)) router.replace('/login');
  }, [ready, signedIn, profile, router]);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setRisk(profile.defaultRiskTolerance);
    setHorizon(profile.defaultResearchHorizon);
  }, [profile]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateProfile({ displayName, defaultRiskTolerance: risk, defaultResearchHorizon: horizon });
    setMessage('Demo profile preferences saved in this browser.');
  }

  function confirmDelete() {
    if (window.confirm('Delete this demo profile from this browser? This cannot be undone.')) {
      deleteProfile();
      router.replace('/signup');
    }
  }

  if (!ready || !signedIn || !profile) return <main className="shell"><SiteHeader activeSection="profile"/><section className="content auth-content" aria-live="polite"><DemoProfileNotice/>Loading browser profile…</section></main>;

  return <main className="shell"><SiteHeader activeSection="profile"/><section className="content auth-content"><p className="eyebrow">BROWSER-ONLY PROFILE</p><h1>Demo profile</h1><DemoProfileNotice />
    <p>Created date: <time dateTime={profile.createdDate}>{profile.createdDate}</time></p>
    <form className="auth-form" onSubmit={save}>
      <label>Display name<input required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="off"/></label>
      <label>Default risk tolerance<select value={risk} onChange={(event) => { const value = event.target.value; if (value === 'low' || value === 'medium' || value === 'high') setRisk(value); }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label>Default research horizon<select value={horizon} onChange={(event) => { const option = horizons.find(([candidate]) => candidate === event.target.value); if (option) setHorizon(option[0]); }}>{horizons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit">Save preferences</button>
      {message && <p role="status">{message}</p>}
    </form>
    <div className="profile-actions"><button type="button" onClick={() => { signOut(); router.push('/'); }}>Sign out</button><button className="danger-button" type="button" onClick={confirmDelete}>Delete demo profile</button></div>
    <p><Link href="/">Return to workspace</Link></p>
  </section></main>;
}
