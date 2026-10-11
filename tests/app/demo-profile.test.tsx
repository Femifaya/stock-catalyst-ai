import React, { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from '../../src/app/login/page.tsx';
import ProfilePage from '../../src/app/profile/page.tsx';
import SignupPage from '../../src/app/signup/page.tsx';
import { DemoProfileProvider } from '../../src/components/demo-profile-provider.tsx';
import { SiteHeader } from '../../src/components/site-header.tsx';
import { DEMO_PROFILE_STORAGE_KEY, DEMO_SESSION_STORAGE_KEY } from '../../src/lib/demo-profile.ts';

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...props }: { href: string; children: ReactNode; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
}));

const validProfile = {
  displayName: 'Demo Researcher',
  defaultRiskTolerance: 'low',
  defaultResearchHorizon: '2_to_8_weeks',
  createdDate: '2026-10-11',
};
let roots: Root[] = [];

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

async function mount(children: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(DemoProfileProvider, null, children)));
  return container;
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

async function fillInput(container: HTMLElement, labelText: string, value: string): Promise<void> {
  const label = Array.from(container.querySelectorAll('label')).find((element) => element.textContent?.includes(labelText));
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${labelText}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('local demo profile flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    routerMock.push.mockClear();
    routerMock.replace.mockClear();
  });

  it('creates a local profile without collecting credentials and signs in as a demo user', async () => {
    const container = await mount(<SignupPage/>);
    await fillInput(container, 'Display name', '  Demo Analyst  ');
    await clickButton(container, 'Create local demo profile');
    expect(routerMock.push).toHaveBeenCalledWith('/');
    const saved = window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY) ?? '';
    expect(saved).toContain('"displayName":"Demo Analyst"');
    expect(saved).toContain('"defaultRiskTolerance":"medium"');
    expect(window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY)).toContain('"version":1');
    expect(window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY)).not.toContain('email');
  });

  it('continues the existing profile from demo login and signs out without deleting it', async () => {
    window.localStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify(validProfile));
    const container = await mount(<><LoginPage/><SiteHeader activeSection="workspace"/></>);
    await clickButton(container, 'Continue as Demo User');
    expect(routerMock.push).toHaveBeenCalledWith('/');
    expect(window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY)).toContain('"active":true');
    expect(container.textContent).toContain('Demo Researcher');
    await clickButton(container, 'Sign out');
    expect(window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY)).not.toBeNull();
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('edits preferences and requires confirmation before deleting the profile', async () => {
    window.localStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify(validProfile));
    window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, active: true }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = await mount(<ProfilePage/>);
    await fillInput(container, 'Display name', 'Updated Analyst');
    await clickButton(container, 'Save preferences');
    expect(window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY)).toContain('Updated Analyst');
    await clickButton(container, 'Delete demo profile');
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY)).not.toBeNull();
    confirm.mockReturnValue(true);
    await clickButton(container, 'Delete demo profile');
    expect(window.localStorage.getItem(DEMO_PROFILE_STORAGE_KEY)).toBeNull();
    expect(routerMock.replace).toHaveBeenCalledWith('/signup');
  });

  it('redirects unauthenticated profile access and changes navigation by session state', async () => {
    const unauthenticated = await mount(<ProfilePage/>);
    expect(routerMock.replace).toHaveBeenCalledWith('/login');
    expect(unauthenticated.textContent).toContain('Loading browser profile');

    await act(async () => { for (const root of roots) root.unmount(); });
    roots = [];
    document.body.innerHTML = '';
    const signedOutHeader = await mount(<SiteHeader activeSection="workspace"/>);
    expect(signedOutHeader.querySelector('a[href="/signup"]')).not.toBeNull();
    await act(async () => {
      window.localStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify(validProfile));
      window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, active: true }));
    });
    await act(async () => { for (const root of roots) root.unmount(); });
    roots = [];
    document.body.innerHTML = '';
    const signedInHeader = await mount(<SiteHeader activeSection="workspace"/>);
    expect(signedInHeader.textContent).toContain('Demo Researcher');
    expect(signedInHeader.querySelector('a[href="/profile"]')?.textContent).toBe('Profile');
    expect(signedInHeader.textContent).toContain('Sign out');
    expect(signedInHeader.querySelector('a[href="/login"]')).toBeNull();
  });
});
