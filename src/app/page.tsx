'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SavedReport } from '@/lib/reports/store.ts';
import { ReportView } from '@/components/report-view.tsx';
import { isSnapshotResponse } from '@/lib/market/snapshot-response.ts';
import type { SnapshotResponse } from '@/lib/market/snapshot-response.ts';
import { normalizeSymbol } from '@/lib/market/symbols.ts';
import { SiteHeader } from '@/components/site-header.tsx';
import { useDemoProfile } from '@/components/demo-profile-provider.tsx';
import { applyPreferenceDefault } from '@/lib/demo-profile.ts';
import {
  addWatchlistSymbol,
  DEFAULT_WATCHLIST,
  MAX_WATCHLIST_SYMBOLS,
  parseSavedWatchlist,
  removeWatchlistSymbol,
  WATCHLIST_STORAGE_KEY,
} from '@/lib/market/watchlist.ts';

const horizonOptions = [
  ['days_to_2_weeks', 'Days to 2 weeks'], ['2_to_8_weeks', '2 to 8 weeks'], ['3_to_12_weeks', '3 to 12 weeks'], ['6_to_18_months', '6 to 18 months'],
] as const;

const money = (value: number | null | undefined) => value == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const label = (status?: string) => (status ?? 'unavailable').toUpperCase();

export default function Home() {
  const { ready: profileReady, profile } = useDemoProfile();
  const [symbol, setSymbol] = useState('NVDA');
  const [question, setQuestion] = useState('What evidence and risks should I review before considering this stock over the selected swing-trading horizon?');
  const [horizon, setHorizon] = useState('3_to_12_weeks');
  const [riskTolerance, setRiskTolerance] = useState('medium');
  const [riskChanged, setRiskChanged] = useState(false);
  const [horizonChanged, setHorizonChanged] = useState(false);
  const [entryPrice, setEntryPrice] = useState('');
  const [watchlist, setWatchlist] = useState<string[]>([...DEFAULT_WATCHLIST]);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [newWatchSymbol, setNewWatchSymbol] = useState('');
  const [watchlistMessage, setWatchlistMessage] = useState('');
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [savedReport, setSavedReport] = useState<SavedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('');

  async function load(nextSymbol: string) {
    const normalized = normalizeSymbol(nextSymbol);
    if (!normalized) { setError('Enter a valid US ticker symbol.'); setSnapshot(null); return; }
    setBusy(true); setError(''); setStage('Loading available market evidence…'); setSymbol(normalized);
    try {
      const response = await fetch(`/api/snapshot?symbol=${encodeURIComponent(normalized)}`);
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(payload, 'Could not load this symbol.'));
      if (!isSnapshotResponse(payload, normalized)) throw new Error('The market snapshot response was invalid.');
      setSnapshot(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.'); setSnapshot(null); }
    finally { setBusy(false); setStage(''); }
  }

  async function research(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSavedReport(null);
    try {
      setStage('Collecting market evidence and calculating technical indicators…');
      const response = await fetch('/api/research', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol, question, horizon, riskTolerance, entryPrice: entryPrice ? Number(entryPrice) : null, positionSize: null }) });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readMessage(payload, 'Research could not be completed.'));
      if (!isSavedReport(payload)) throw new Error('The report response was invalid.');
      setSavedReport(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Research request failed.'); }
    finally { setBusy(false); setStage(''); }
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('symbol');
    if (requested === null) { void load('NVDA'); return; }
    const normalized = normalizeSymbol(requested);
    if (!normalized) { setError('The symbol in this link is invalid. Enter a valid US ticker symbol.'); return; }
    void load(normalized);
  }, []);

  useEffect(() => {
    if (!profileReady || !profile) return;
    setRiskTolerance((current) => applyPreferenceDefault(current, profile.defaultRiskTolerance, riskChanged));
    setHorizon((current) => applyPreferenceDefault(current, profile.defaultResearchHorizon, horizonChanged));
  }, [profileReady, profile, riskChanged, horizonChanged]);

  useEffect(() => {
    try {
      setWatchlist(parseSavedWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY)));
    } catch {
      setWatchlist([...DEFAULT_WATCHLIST]);
    }
    setWatchlistReady(true);
  }, []);

  useEffect(() => {
    if (!watchlistReady) return;
    try {
      window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
    } catch {
      setWatchlistMessage('Browser storage is unavailable; watchlist changes will not survive a refresh.');
    }
  }, [watchlist, watchlistReady]);

  function addToWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = addWatchlistSymbol(watchlist, newWatchSymbol);
    if (!result.ok) {
      setWatchlistMessage(result.reason === 'invalid'
        ? 'Enter a valid US ticker symbol.'
        : result.reason === 'duplicate'
          ? 'That symbol is already in the watchlist.'
          : `The watchlist is limited to ${MAX_WATCHLIST_SYMBOLS} symbols.`);
      return;
    }
    setWatchlist(result.symbols);
    setNewWatchSymbol('');
    setWatchlistMessage(`${result.symbols[result.symbols.length - 1]} added. Select it to load its data.`);
  }

  function removeFromWatchlist(removedSymbol: string) {
    setWatchlist((current) => removeWatchlistSymbol(current, removedSymbol));
    setWatchlistMessage(`${removedSymbol} removed from the watchlist.`);
  }

  const quote = snapshot?.quote.data;
  const series = snapshot?.candles.data?.candles ?? [];
  const last = series.at(-1)?.close;
  const chartPoints = series.slice(-80).map((bar) => bar.close);
  const min = chartPoints.length ? Math.min(...chartPoints) : 0;
  const max = chartPoints.length ? Math.max(...chartPoints) : 1;
  const points = chartPoints.map((price, index) => `${chartPoints.length < 2 ? 0 : index / (chartPoints.length - 1) * 100},${36 - ((price - min) / (max - min || 1)) * 32}`).join(' ');

  return <main className="shell">
    <a className="skip" href="#main">Skip to content</a>
    <SiteHeader activeSection="workspace" />
    <div className="layout">
      <aside className="sidebar" aria-label="Research watchlist">
        <div className="side-title"><span>WATCHLIST</span><span className="watchlist-count">{watchlist.length}/{MAX_WATCHLIST_SYMBOLS}</span></div>
        <p className="muted">US EQUITIES</p>
        <form className="watchlist-add" onSubmit={addToWatchlist}>
          <label htmlFor="watchlist-symbol">Add symbol</label>
          <div><input id="watchlist-symbol" value={newWatchSymbol} onChange={(event) => setNewWatchSymbol(event.target.value.toUpperCase())} maxLength={10} placeholder="e.g. GOOGL"/><button type="submit" disabled={watchlist.length >= MAX_WATCHLIST_SYMBOLS}>Add</button></div>
        </form>
        {watchlistMessage && <p className="watchlist-message" role="status" aria-live="polite">{watchlistMessage}</p>}
        <div className="watchlist-items">
          {watchlist.map((item) => <div className={`watch-row ${symbol === item ? 'selected' : ''}`} key={item}>
            <button className="watch-select" type="button" onClick={() => void load(item)} disabled={busy} aria-current={symbol === item ? 'true' : undefined}>
              <span>{item}</span><span className="watch-status">{snapshot?.symbol === item ? label(snapshot.quote.provenance?.status ?? (snapshot.quote.error ? 'unavailable' : undefined)) : 'SELECT'}</span>
            </button>
            <button className="watch-remove" type="button" onClick={() => removeFromWatchlist(item)} aria-label={`Remove ${item} from watchlist`} title={`Remove ${item}`}>×</button>
          </div>)}
          {watchlist.length === 0 && <p className="watchlist-empty">No symbols saved. Add one above.</p>}
        </div>
        <div className="side-note"><span className="dot"/> Human decision required<br/><small>No trading or brokerage connections.</small></div>
      </aside>
      <section id="main" className="content">
        <div className="page-heading"><div><p className="eyebrow">AI TRADING DESK / INFORMATION EXTRACTION & SIGNAL GENERATION</p><h1>Research workspace</h1><p className="muted">Evidence, provenance, and local calculations for US swing research.</p></div><form onSubmit={(event) => { event.preventDefault(); void load(symbol); }} className="search"><label htmlFor="symbol">SYMBOL</label><input id="symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} maxLength={10} placeholder="NVDA"/><button disabled={busy}>Load data</button></form></div>
        {error && <div className="error" role="alert">{error}</div>}
        {stage && <div className="loading" role="status" aria-live="polite">{stage}</div>}
        {snapshot && <>
          {snapshot.quote.provenance?.status === 'demo' && <div className="demo-banner"><strong>DEMO MODE — SYNTHETIC DATA</strong><span>All demonstration prices, company details, calendars, and reports are generated locally and do not represent real market information.</span></div>}
          <section className="quote-head"><div><p className="eyebrow">{snapshot.profile.data?.name ?? snapshot.symbol}{snapshot.profile.data?.sector ? ` · ${snapshot.profile.data.sector}` : ''}</p><h2>{snapshot.symbol} <span className="status">{label(snapshot.quote.provenance?.status ?? (snapshot.quote.error ? 'unavailable' : undefined))}</span></h2>{snapshot.quote.provenance && <small>{snapshot.quote.provenance.source} · as of {snapshot.quote.provenance.asOf ?? 'unknown'}</small>}</div><div className="price">{money(quote?.price)}<small>{quote?.changePercent == null ? 'Change unavailable' : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}% today`}</small></div></section>
          <section className="cards"><Metric name="LAST PRICE" value={money(quote?.price)} status={snapshot.quote.provenance?.status}/><Metric name="SESSION CHANGE" value={quote?.changePercent == null ? 'n/a' : `${quote.changePercent.toFixed(2)}%`} status={snapshot.quote.provenance?.status}/><Metric name="VOLUME" value={quote?.volume == null ? 'n/a' : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(quote.volume)} status={snapshot.quote.provenance?.status}/><Metric name="MARKET CAP" value={quote?.marketCap == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(quote.marketCap)} status={snapshot.quote.provenance?.status}/></section>
          <div className="columns"><section className="panel chart-panel"><div className="panel-title"><div><p className="eyebrow">PRICE HISTORY</p><h3>Daily close</h3></div><span className="status">{label(snapshot.candles.provenance?.status)}</span></div>{chartPoints.length > 1 ? <><svg className="chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${snapshot.symbol} daily closing prices over ${chartPoints.length} sessions`}><polyline points={points} fill="none" stroke="#71e0b4" strokeWidth=".7" vectorEffect="non-scaling-stroke"/></svg><div className="chart-foot"><span>As of {snapshot.candles.provenance?.asOf ?? 'unknown'}</span><span>Close {money(last ?? null)} · {snapshot.candles.data?.adjustment ?? 'adjustment unknown'}</span></div></> : <Unavailable name="Historical candles" code={snapshot.candles.error?.code}/>}</section>
            <section className="panel"><div className="panel-title"><div><p className="eyebrow">LOCAL CALCULATIONS</p><h3>Technical context</h3></div><span className="type-tag">CALCULATION</span></div><div className="indicator-row"><span>Trend</span><strong>{snapshot.indicators?.trend?.direction ?? 'unavailable'}</strong></div><div className="indicator-row"><span>Trend strength</span><strong>{snapshot.indicators?.trend ? `${(snapshot.indicators.trend.strength * 100).toFixed(0)}%` : 'unavailable'}</strong></div><div className="indicator-row"><span>RSI (14)</span><strong>{snapshot.indicators?.rsi14?.latest == null ? 'unavailable' : snapshot.indicators.rsi14.latest.toFixed(1)}</strong></div>{snapshot.indicators?.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}</section></div>
          <div className="columns lower"><section className="panel"><div className="panel-title"><div><p className="eyebrow">UPCOMING & RECENT</p><h3>Earnings</h3></div><span className="type-tag">{label(snapshot.quote.provenance?.status)}</span></div>{snapshot.earnings.data?.length ? snapshot.earnings.data.slice(0, 3).map((event, index) => <div className="list-row" key={`${event.date}-${index}`}><span>{new Date(event.date).toLocaleDateString()}</span><strong>{event.status}</strong></div>) : <Unavailable name="Earnings calendar" code={snapshot.earnings.error?.code}/>}</section><section className="panel"><div className="panel-title"><div><p className="eyebrow">CATALYST FEED</p><h3>Recent news</h3></div><span className="type-tag">SOURCE LINKED</span></div>{snapshot.news.data?.length ? snapshot.news.data.slice(0, 4).map((item, index) => item.url ? <a className="news-row" key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer"><strong>{item.headline}</strong><small>{item.source} · {new Date(item.publishedAt).toLocaleDateString()}</small></a> : <div className="news-row" key={`${item.headline}-${index}`}><strong>{item.headline}</strong><small>{item.source} · {new Date(item.publishedAt).toLocaleDateString()}</small></div>) : <Unavailable name="News" code={snapshot.news.error?.code}/>}</section></div>
          <section className="panel research-form-panel"><p className="eyebrow">RESEARCH QUESTION</p><h3>Generate a structured evidence report</h3><form onSubmit={research} className="research-form"><label>Risk level<select value={riskTolerance} onChange={(event) => { setRiskChanged(true); setRiskTolerance(event.target.value); }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Time horizon<select value={horizon} onChange={(event) => { setHorizonChanged(true); setHorizon(event.target.value); }}>{horizonOptions.map(([value, labelText]) => <option value={value} key={value}>{labelText}</option>)}</select></label><label>Optional entry price (USD)<input type="number" min="0.01" step="0.01" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} placeholder="Not supplied"/></label><label className="question-field">Research question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength={10} maxLength={600} required rows={3}/></label><button disabled={busy}>{busy ? 'Researching…' : 'Generate research report'}</button></form><p className="muted">Qwen reports require a server-side key. In Demo Mode the report is a deterministic rule-based template, clearly labelled as not AI output.</p></section>
          {savedReport && <ReportView initialReport={savedReport}/>}
          <p className="disclaimer">Research only. Data may be live, delayed, cached, synthetic, or unavailable; status and provenance are shown per evidence item. Human decision required.</p>
        </>}
        {!snapshot && !busy && <div className="welcome"><div className="welcome-icon">↗</div><h2>Snapshot unavailable</h2><p>Market data could not be loaded. Check the selected provider and try again.</p></div>}
      </section>
    </div>
  </main>;
}

function Metric({ name, value, status }: { name: string; value: string; status?: string }) { return <article className="metric"><span>{name}</span><strong>{value}</strong><small>{label(status)}</small></article>; }
function Unavailable({ name, code }: { name: string; code?: string }) { return <div className="empty" role="status">{name} unavailable{code ? ` (${code})` : ''}. No value has been estimated.</div>; }
function readMessage(payload: unknown, fallback: string): string { return typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string' ? payload.message : fallback; }

function isSavedReport(value: unknown): value is SavedReport {
  if (typeof value !== 'object' || value === null) return false;
  return 'id' in value && typeof value.id === 'string' && 'createdAt' in value && typeof value.createdAt === 'string'
    && 'acknowledgedAt' in value && (typeof value.acknowledgedAt === 'string' || value.acknowledgedAt === null)
    && 'generationMode' in value && (value.generationMode === 'demo-template' || value.generationMode === 'qwen')
    && 'request' in value && typeof value.request === 'object' && value.request !== null
    && 'report' in value && typeof value.report === 'object' && value.report !== null && 'executiveSummary' in value.report && typeof value.report.executiveSummary === 'string'
    && 'evidence' in value && Array.isArray(value.evidence)
    && 'catalysts' in value && typeof value.catalysts === 'object' && value.catalysts !== null
    && 'warnings' in value && Array.isArray(value.warnings);
}
