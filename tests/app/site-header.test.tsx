import React, { act, createElement } from 'react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SiteHeader } from '../../src/components/site-header.tsx';

vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...props }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
}));

let activeRoot: Root | undefined;

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(async () => {
  if (activeRoot) {
    await act(async () => activeRoot?.unmount());
    activeRoot = undefined;
  }
  document.body.innerHTML = '';
});

async function renderHeader(activeSection: 'workspace' | 'reports' | 'settings'): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  activeRoot = createRoot(container);
  await act(async () => activeRoot?.render(createElement(SiteHeader, { activeSection })));
  return container;
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return button;
}

function linkByText(container: HTMLElement, label: string): HTMLAnchorElement {
  const link = Array.from(container.querySelectorAll('a[href]')).find((item) => item.textContent?.trim() === label);
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`Link not found: ${label}`);
  return link;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function keydown(key: string, options: { shiftKey?: boolean } = {}): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  });
}

describe('SiteHeader navigation drawer', () => {
  it('opens with focus in the drawer and exposes only the working navigation links', async () => {
    const container = await renderHeader('reports');
    const menuButton = buttonByLabel(container, 'Open navigation menu');
    await click(menuButton);

    const drawer = container.querySelector('[role="dialog"]');
    expect(drawer).not.toBeNull();
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(buttonByLabel(container, 'Close navigation menu')).toBe(document.activeElement);
    const links = drawer?.querySelectorAll('a[href]');
    expect(links).toHaveLength(3);
    expect(linkByText(container, 'Workspace').getAttribute('href')).toBe('/');
    expect(linkByText(container, 'Reports').getAttribute('aria-current')).toBe('page');
    expect(linkByText(container, 'Settings').getAttribute('href')).toBe('/settings');
  });

  it('closes with the close button and returns focus to the menu button', async () => {
    const container = await renderHeader('workspace');
    const menuButton = buttonByLabel(container, 'Open navigation menu');
    await click(menuButton);
    await click(buttonByLabel(container, 'Close navigation menu'));

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(menuButton).toBe(document.activeElement);
  });

  it('closes on overlay click and Escape, restoring focus in each case', async () => {
    const container = await renderHeader('workspace');
    const menuButton = buttonByLabel(container, 'Open navigation menu');

    await click(menuButton);
    const overlay = container.querySelector('.nav-overlay');
    if (!(overlay instanceof HTMLButtonElement)) throw new Error('Navigation overlay was not rendered.');
    await click(overlay);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(menuButton).toBe(document.activeElement);

    await click(menuButton);
    await keydown('Escape');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(menuButton).toBe(document.activeElement);
  });

  it('traps tab focus and closes after selecting a link', async () => {
    const container = await renderHeader('workspace');
    const menuButton = buttonByLabel(container, 'Open navigation menu');
    await click(menuButton);
    const closeButton = buttonByLabel(container, 'Close navigation menu');

    await keydown('Tab', { shiftKey: true });
    expect(linkByText(container, 'Settings')).toBe(document.activeElement);
    await keydown('Tab');
    expect(closeButton).toBe(document.activeElement);

    const reportsLink = linkByText(container, 'Reports');
    reportsLink.addEventListener('click', (event) => event.preventDefault(), { once: true });
    await click(reportsLink);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
  });
});
