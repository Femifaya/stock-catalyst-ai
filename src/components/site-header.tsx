'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { useDemoProfile } from '@/components/demo-profile-provider.tsx';

export type SiteSection = 'workspace' | 'reports' | 'settings' | 'stocks' | 'profile' | 'login' | 'signup';

const baseNavigationItems: ReadonlyArray<{ label: string; href: string; section: SiteSection }> = [
  { label: 'Workspace', href: '/', section: 'workspace' },
  { label: 'Reports', href: '/reports', section: 'reports' },
  { label: 'Settings', href: '/settings', section: 'settings' },
  { label: 'Stocks', href: '/stocks', section: 'stocks' },
];

export function SiteHeader({ activeSection }: { activeSection: SiteSection }) {
  const { ready, profile, signedIn, signOut } = useDemoProfile();
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!focusable?.length) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButton?.focus();
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
  }

  return <header className="topbar">
    <button
      ref={menuButtonRef}
      className="nav-menu-trigger"
      type="button"
      aria-label="Open navigation menu"
      aria-expanded={isOpen}
      aria-controls="site-navigation-drawer"
      onClick={() => setIsOpen(true)}
    >
      <span aria-hidden="true" className="menu-icon"><span/><span/><span/></span>
    </button>
    <Link className="brand" href="/" onClick={closeDrawer}>
      <span className="brand-mark">C</span><span>CATALYST <small>RESEARCH DESK</small></span>
    </Link>
    {ready && (signedIn && profile
      ? <div className="header-profile"><span>{profile.displayName}</span><Link href="/profile">Profile</Link><button type="button" onClick={signOut}>Sign out</button></div>
      : <div className="header-profile"><Link href="/login">Login</Link><Link href="/signup">Create demo profile</Link></div>)}
    <span className="research-only">RESEARCH ONLY</span>
    {isOpen && <div className="nav-drawer-layer">
      <button className="nav-overlay" type="button" aria-label="Close navigation drawer" tabIndex={-1} onClick={closeDrawer}/>
      <aside ref={drawerRef} className="nav-drawer" id="site-navigation-drawer" role="dialog" aria-modal="true" aria-labelledby="navigation-title">
        <div className="nav-drawer-heading">
          <h2 id="navigation-title">Navigation</h2>
          <button ref={closeButtonRef} className="nav-close" type="button" aria-label="Close navigation menu" onClick={closeDrawer}>×</button>
        </div>
        <nav aria-label="Main navigation">
          {baseNavigationItems.map((item) => <Link
            key={item.section}
            className={`nav-drawer-link ${activeSection === item.section ? 'active' : ''}`}
            href={item.href}
            aria-current={activeSection === item.section ? 'page' : undefined}
            onClick={closeDrawer}
          >{item.label}</Link>)}
          {ready && (signedIn && profile
            ? <><Link className="nav-drawer-link" href="/profile" aria-current={activeSection === 'profile' ? 'page' : undefined} onClick={closeDrawer}>Profile</Link><button className="nav-drawer-link nav-drawer-action" type="button" onClick={() => { signOut(); closeDrawer(); }}>Sign out</button></>
            : <><Link className="nav-drawer-link" href="/login" aria-current={activeSection === 'login' ? 'page' : undefined} onClick={closeDrawer}>Login</Link><Link className="nav-drawer-link" href="/signup" aria-current={activeSection === 'signup' ? 'page' : undefined} onClick={closeDrawer}>Create demo profile</Link></>)}
        </nav>
      </aside>
    </div>}
  </header>;
}
