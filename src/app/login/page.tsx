'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useState } from 'react';
import { SiteHeader } from '@/components/site-header.tsx';
import { DemoProfileNotice } from '@/components/demo-profile-notice.tsx';
import { useDemoProfile } from '@/components/demo-profile-provider.tsx';

export default function LoginPage() {
  const router = useRouter();
  const { ready, profile, signedIn, createProfile, signIn } = useDemoProfile();
  const [error, setError] = useState('');

  function continueAsDemoUser() {
    if (signedIn) { router.push('/'); return; }
    const continued = profile
      ? signIn()
      : Boolean(createProfile({ displayName: 'Demo User', defaultRiskTolerance: 'medium', defaultResearchHorizon: '3_to_12_weeks' }));
    if (continued) router.push('/');
    else setError('Could not start the local demo session.');
  }

  return <main className="shell"><SiteHeader activeSection="login"/><section className="content auth-content"><p className="eyebrow">BROWSER-ONLY PROFILE</p><h1>Demo login</h1><DemoProfileNotice />
    <p>This starts a local demo session in this browser. There are no passwords, email addresses, or synchronized accounts.</p>
    <button type="button" onClick={continueAsDemoUser} disabled={!ready}>Continue as Demo User</button>
    {profile && <p>Saved profile in this browser: <strong>{profile.displayName}</strong></p>}
    {error && <p role="alert" className="error">{error}</p>}
    <p>New here? <Link href="/signup">Create demo profile</Link></p>
  </section></main>;
}
