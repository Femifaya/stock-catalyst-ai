'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  DEMO_PROFILE_STORAGE_KEY,
  DEMO_SESSION_STORAGE_KEY,
  parseDemoProfile,
  parseDemoSession,
  readStoredValue,
} from '@/lib/demo-profile.ts';
import type { DemoProfile } from '@/lib/demo-profile.ts';

type NewProfile = Pick<DemoProfile, 'displayName' | 'defaultRiskTolerance' | 'defaultResearchHorizon'>;
type DemoProfileContextValue = {
  ready: boolean;
  profile: DemoProfile | null;
  signedIn: boolean;
  createProfile: (input: NewProfile) => DemoProfile;
  updateProfile: (input: Pick<DemoProfile, 'displayName' | 'defaultRiskTolerance' | 'defaultResearchHorizon'>) => void;
  signIn: () => boolean;
  signOut: () => void;
  deleteProfile: () => void;
};

const DemoProfileContext = createContext<DemoProfileContextValue | null>(null);

function safeWrite(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be disabled by browser policy; the current in-memory session still works.
  }
}

export function DemoProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<DemoProfile | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = parseDemoProfile(readStoredValue(window.localStorage, DEMO_PROFILE_STORAGE_KEY));
    const active = loaded !== null && parseDemoSession(readStoredValue(window.localStorage, DEMO_SESSION_STORAGE_KEY));
    setProfile(loaded);
    setSignedIn(active);
    try {
      if (loaded === null) window.localStorage.removeItem(DEMO_PROFILE_STORAGE_KEY);
      if (!active) window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
    } catch { /* Ignore unavailable browser storage. */ }
    setReady(true);
  }, []);

  const createProfile = useCallback((input: NewProfile) => {
    const parsed = parseDemoProfile({ ...input, createdDate: new Date().toISOString().slice(0, 10) });
    if (!parsed) throw new Error('Enter a valid display name and preferences.');
    setProfile(parsed);
    setSignedIn(true);
    safeWrite(DEMO_PROFILE_STORAGE_KEY, parsed);
    safeWrite(DEMO_SESSION_STORAGE_KEY, { version: 1, active: true });
    return parsed;
  }, []);

  const updateProfile = useCallback((input: NewProfile) => {
    setProfile((current) => {
      if (!current) return current;
      const parsed = parseDemoProfile({ ...input, createdDate: current.createdDate });
      if (!parsed) return current;
      safeWrite(DEMO_PROFILE_STORAGE_KEY, parsed);
      return parsed;
    });
  }, []);

  const signIn = useCallback(() => {
    const stored = parseDemoProfile(readStoredValue(window.localStorage, DEMO_PROFILE_STORAGE_KEY)) ?? profile;
    if (!stored) return false;
    setProfile(stored);
    setSignedIn(true);
    safeWrite(DEMO_SESSION_STORAGE_KEY, { version: 1, active: true });
    return true;
  }, [profile]);

  const signOut = useCallback(() => {
    setSignedIn(false);
    try { window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY); } catch { /* Ignore unavailable browser storage. */ }
  }, []);

  const deleteProfile = useCallback(() => {
    setSignedIn(false);
    setProfile(null);
    try {
      window.localStorage.removeItem(DEMO_PROFILE_STORAGE_KEY);
      window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
    } catch { /* Ignore unavailable browser storage. */ }
  }, []);

  const value = useMemo(() => ({ ready, profile, signedIn, createProfile, updateProfile, signIn, signOut, deleteProfile }), [ready, profile, signedIn, createProfile, updateProfile, signIn, signOut, deleteProfile]);
  return <DemoProfileContext.Provider value={value}>{children}</DemoProfileContext.Provider>;
}

export function useDemoProfile(): DemoProfileContextValue {
  const context = useContext(DemoProfileContext);
  if (!context) throw new Error('useDemoProfile must be used within DemoProfileProvider.');
  return context;
}

