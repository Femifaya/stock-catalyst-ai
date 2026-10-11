'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';

export type SiteSection = 'workspace' | 'reports' | 'settings';

const navigationItems: ReadonlyArray<{ label: string; href: string; section: SiteSection }> = [
  { label: 'Workspace', href: '/', section: 'workspace' },
  { label: 'Reports', href: '/reports', section: 'reports' },
  { label: 'Settings', href: '/settings', section: 'settings' },
];

export function SiteHeader({ activeSection }: { activeSection: SiteSection }) {
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
    <span className="research-only">RESEARCH ONLY</span>
    {isOpen && <div className="nav-drawer-layer">
      <button className="nav-overlay" type="button" aria-label="Close navigation drawer" tabIndex={-1} onClick={closeDrawer}/>
      <aside ref={drawerRef} className="nav-drawer" id="site-navigation-drawer" role="dialog" aria-modal="true" aria-labelledby="navigation-title">
        <div className="nav-drawer-heading">
          <h2 id="navigation-title">Navigation</h2>
          <button ref={closeButtonRef} className="nav-close" type="button" aria-label="Close navigation menu" onClick={closeDrawer}>×</button>
        </div>
        <nav aria-label="Main navigation">
          {navigationItems.map((item) => <Link
            key={item.section}
            className={`nav-drawer-link ${activeSection === item.section ? 'active' : ''}`}
            href={item.href}
            aria-current={activeSection === item.section ? 'page' : undefined}
            onClick={closeDrawer}
          >{item.label}</Link>)}
        </nav>
      </aside>
    </div>}
  </header>;
}
