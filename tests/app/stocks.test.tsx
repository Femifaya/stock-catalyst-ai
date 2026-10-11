import React, { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import StocksPage from '../../src/app/stocks/page.tsx';
import StockPage from '../../src/app/stocks/[symbol]/page.tsx';
import Home from '../../src/app/page.tsx';
import { safeExternalUrl, StockProfile } from '../../src/components/stock-profile.tsx';
import { DemoProfileProvider } from '../../src/components/demo-profile-provider.tsx';
import { DEMO_PROFILE_STORAGE_KEY, DEMO_SESSION_STORAGE_KEY } from '../../src/lib/demo-profile.ts';
import { WATCHLIST_STORAGE_KEY } from '../../src/lib/market/watchlist.ts';
import { CONTEXT, EVIDENCE_IDS, mutate, validReport } from '../core/report-fixtures.ts';

const researchAvailable = { available: true, model: 'qwen-plus', message: '' };
const researchUnavailable = { available: false, model: null, message: 'Live Qwen analysis is unavailable while Demo Mode is enabled.' };

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), notFound: vi.fn(() => { throw new Error('NOT_FOUND'); }) }));
vi.mock('next/navigation', () => ({ useRouter: () => routerMock, notFound: routerMock.notFound }));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...props }: { href: string; children: ReactNode; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
}));

let roots: Root[] = [];

beforeAll(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
beforeEach(() => { window.localStorage.clear(); routerMock.push.mockClear(); routerMock.notFound.mockClear(); });
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function mount(element: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(DemoProfileProvider, null, element)));
  return container;
}

function inputByLabel(container: HTMLElement, text: string): HTMLInputElement {
  if (text === 'Search a symbol') {
    const search = container.querySelector('#stock-search');
    if (search instanceof HTMLInputElement) return search;
  }
  const label = Array.from(container.querySelectorAll('label')).find((item) => item.textContent?.includes(text));
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input: ${text}`);
  return input;
}

async function setInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function setTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function clickText(container: HTMLElement, text: string): Promise<void> {
  const element = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}; rendered content: ${container.textContent}`);
  await act(async () => element.click());
}

function emptySnapshot(symbol: string) {
  const slot = { data: null, provenance: null, error: null };
  return { symbol, generatedAt: '2026-10-11T00:00:00.000Z', quote: slot, candles: slot, profile: slot, financials: slot, estimates: slot, earnings: slot, news: slot, macro: slot, indicators: null };
}

function savedQwenReport() {
  const report = mutate(validReport(), (value) => {
    const objective = value.objective;
    if (typeof objective !== 'object' || objective === null || !('positionSize' in objective)) throw new Error('Invalid fixture objective');
    objective.positionSize = null;
  });
  return {
    id: 'rpt_stockanalysis123', createdAt: '2026-10-11T12:00:00.000Z', acknowledgedAt: null, generationMode: 'qwen',
    request: { symbol: CONTEXT.symbol, question: CONTEXT.question, horizon: CONTEXT.horizon, riskTolerance: CONTEXT.riskTolerance, entryPrice: CONTEXT.entryPrice, positionSize: null },
    report,
    evidence: EVIDENCE_IDS.map((id, index) => ({ id, kind: 'fact', label: `Evidence ${index + 1}`, value: `Verified fixture evidence ${index + 1}`, source: 'Mock source', status: 'live', asOf: '2026-10-11T11:00:00.000Z', retrievedAt: '2026-10-11T11:00:00.000Z', url: null })),
    catalysts: { entries: [], nextEarnings: null, daysToNextEarnings: null, warnings: [], generatedAt: '2026-10-11T11:00:00.000Z' }, warnings: [],
  };
}

async function loadSnapshotMock() {
  return new Response(JSON.stringify(emptySnapshot('NVDA')), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function clickSubmit(container: HTMLElement) {
  const form = container.querySelector('.stock-research-form');
  if (!(form instanceof HTMLFormElement)) throw new Error('Research form was not rendered.');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('stock directory and profile', () => {
  it('allows safe external web links and rejects script or malformed URLs', () => {
    expect(safeExternalUrl('https://news.example/story')).toBe('https://news.example/story');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a URL')).toBeNull();
  });

  it('loads the saved watchlist and routes normalized valid searches; invalid symbols show validation', async () => {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['nvda', 'MSFT']));
    const container = await mount(<StocksPage/>);
    expect(container.querySelector('a[href="/stocks/NVDA"]')?.textContent).toContain('NVDA');
    const search = inputByLabel(container, 'Search a symbol');
    await setInput(search, ' brk.b ');
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(routerMock.push).toHaveBeenCalledWith('/stocks/BRK.B');
    await setInput(search, 'bad ticker');
    await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('Enter a valid US ticker symbol');
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid route symbols through the existing US symbol rules', async () => {
    await expect(StockPage({ params: Promise.resolve({ symbol: 'BAD/TICKER' }) })).rejects.toThrow('NOT_FOUND');
    expect(routerMock.notFound).toHaveBeenCalledOnce();
    const valid = await StockPage({ params: Promise.resolve({ symbol: 'brk.b' }) });
    expect(valid).toMatchObject({ props: { symbol: 'BRK.B' } });
  });

  it('loads one snapshot, handles unavailable fields, and adds/removes the symbol locally', async () => {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, '[]');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(emptySnapshot('NVDA')), { status: 200, headers: { 'content-type': 'application/json' } }));
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/snapshot?symbol=NVDA');
    expect(container.textContent).toContain('Company profile');
    expect(container.textContent).toContain('Unavailable');
    await clickText(container, 'Add to watchlist');
    expect(window.localStorage.getItem(WATCHLIST_STORAGE_KEY)).toContain('NVDA');
    await clickText(container, 'Remove from watchlist');
    expect(window.localStorage.getItem(WATCHLIST_STORAGE_KEY)).not.toContain('NVDA');
  });

  it('shows a clear error for failed snapshot requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: 'Snapshot temporarily unavailable.' }), { status: 503, headers: { 'content-type': 'application/json' } }));
    const container = await mount(<StockProfile symbol="AAPL" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('Snapshot temporarily unavailable.');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('only calls the research API after explicit submit and renders the validated saved Qwen report', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(loadSnapshotMock)
      .mockResolvedValueOnce(new Response(JSON.stringify(savedQwenReport()), { status: 201, headers: { 'content-type': 'application/json' } }));
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const question = container.querySelector('.stock-research-form textarea');
    if (!(question instanceof HTMLTextAreaElement)) throw new Error('Research question field was not rendered.');
    await setTextarea(question, CONTEXT.question);
    const entryPrice = container.querySelector('.stock-research-form input');
    if (!(entryPrice instanceof HTMLInputElement)) throw new Error('Entry price field was not rendered.');
    await setInput(entryPrice, String(CONTEXT.entryPrice));
    await clickSubmit(container);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/research');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    const request: unknown = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(request).toMatchObject({ symbol: 'NVDA', question: CONTEXT.question, riskTolerance: 'medium', horizon: '3_to_12_weeks', entryPrice: CONTEXT.entryPrice, positionSize: null });
    expect(container.textContent).toContain('Invalidation conditions');
    expect(container.textContent).toContain('QWEN AI · qwen-plus');
    expect(container.querySelector('a[href="/reports/rpt_stockanalysis123"]')?.textContent).toBe('View saved report');
  });

  it('explains unavailable Qwen configuration and does not submit a research request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(loadSnapshotMock);
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchUnavailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain('Live Qwen analysis is unavailable while Demo Mode is enabled.');
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes('Analyze with Qwen'));
    expect(button).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed research payloads instead of displaying a report', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(loadSnapshotMock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ malformed: true }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await clickSubmit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('malformed or non-Qwen report');
    expect(container.querySelector('a[href^="/reports/"]')).toBeNull();
  });

  it('shows a clear timeout error from the mocked API request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(loadSnapshotMock)
      .mockRejectedValueOnce(new DOMException('request timed out', 'AbortError'));
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await clickSubmit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Timeout:');
  });

  it('prevents duplicate submissions while a research request is pending', async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => { finishRequest = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(loadSnapshotMock).mockReturnValueOnce(pending);
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const form = container.querySelector('.stock-research-form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Research form was not rendered.');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes('Analyzing with Qwen'));
    expect(button).toBeDisabled();
    await act(async () => finishRequest?.(new Response(JSON.stringify({ code: 'upstream_error', message: 'Mock service unavailable.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
  });

  it('uses active demo-profile preferences as defaults without making an analysis request', async () => {
    window.localStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify({ displayName: 'Demo Trader', defaultRiskTolerance: 'low', defaultResearchHorizon: '2_to_8_weeks', createdDate: '2026-10-01' }));
    window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify({ version: 1, active: true }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(loadSnapshotMock);
    const container = await mount(<StockProfile symbol="NVDA" qwenAvailability={researchAvailable}/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const selects = container.querySelectorAll('.stock-research-form select');
    const risk = selects.item(0);
    const horizon = selects.item(1);
    if (!(risk instanceof HTMLSelectElement) || !(horizon instanceof HTMLSelectElement)) throw new Error('Preference fields were not rendered.');
    expect(risk.value).toBe('low');
    expect(horizon.value).toBe('2_to_8_weeks');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads a validated stock symbol from the research link query parameter', async () => {
    window.history.replaceState({}, '', '/?symbol=MSFT');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(emptySnapshot('MSFT')), { status: 200, headers: { 'content-type': 'application/json' } }));
    const container = await mount(<Home/>);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/snapshot?symbol=MSFT');
    const symbolInput = container.querySelector('#symbol');
    if (!(symbolInput instanceof HTMLInputElement)) throw new Error('Workspace symbol input was not rendered.');
    expect(symbolInput.value).toBe('MSFT');
  });
});
