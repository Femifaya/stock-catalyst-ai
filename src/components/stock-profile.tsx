'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SiteHeader } from '@/components/site-header.tsx';
import { isSnapshotResponse } from '@/lib/market/snapshot-response.ts';
import type { SnapshotResponse } from '@/lib/market/snapshot-response.ts';
import { addWatchlistSymbol, parseSavedWatchlist, removeWatchlistSymbol, WATCHLIST_STORAGE_KEY } from '@/lib/market/watchlist.ts';
import { useDemoProfile } from '@/components/demo-profile-provider.tsx';
import { applyPreferenceDefault } from '@/lib/demo-profile.ts';
import type { Horizon, RiskTolerance } from '@/lib/config/env.ts';
import { ReportView } from '@/components/report-view.tsx';
import { parseQwenSavedReport } from '@/lib/reports/client-response.ts';
import type { SavedReport } from '@/lib/reports/store.ts';
import type { ResearchRequest } from '@/lib/ai/types.ts';

const currency = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unavailable' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const percent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unavailable' : `${number(value)}%`;
const label = (value: string | null | undefined) => value?.replaceAll('_', ' ') ?? 'Unavailable';
const horizonOptions: ReadonlyArray<[Horizon, string]> = [
  ['days_to_2_weeks', 'Days to 2 weeks'], ['2_to_8_weeks', '2 to 8 weeks'], ['3_to_12_weeks', '3 to 12 weeks'], ['6_to_18_months', '6 to 18 months'],
];
const riskOptions: readonly RiskTolerance[] = ['low', 'medium', 'high'];

type QwenAvailability = { available: boolean; model: string | null; message: string };

function isRiskTolerance(value: string): value is RiskTolerance {
  return riskOptions.some((option) => option === value);
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch { return null; }
}

type EvidenceSource = Pick<SnapshotResponse['quote'], 'provenance' | 'error'>;

function evidenceStatus(slot: EvidenceSource): string {
  return slot.provenance?.status.toUpperCase() ?? (slot.error ? 'UNAVAILABLE' : 'UNAVAILABLE');
}

function StatusLine({ slot }: { slot: EvidenceSource }) {
  const source = slot.provenance?.source ?? slot.error?.source;
  const time = slot.provenance?.asOf ?? slot.provenance?.retrievedAt;
  return <p className="stock-status">{evidenceStatus(slot)}{source ? ` · ${source}` : ''}{time ? ` · as of ${time}` : ''}</p>;
}

function ValueRow({ name, value }: { name: string; value: string }) {
  return <div className="indicator-row"><span>{name}</span><strong>{value}</strong></div>;
}

export function StockProfile({ symbol, qwenAvailability }: { symbol: string; qwenAvailability: QwenAvailability }) {
  const { profile, signedIn } = useDemoProfile();
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState('');
  const [question, setQuestion] = useState('What evidence, catalysts, and risks should I consider for this stock over the selected horizon?');
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>('medium');
  const [horizon, setHorizon] = useState<Horizon>('3_to_12_weeks');
  const [entryPrice, setEntryPrice] = useState('');
  const [riskChanged, setRiskChanged] = useState(false);
  const [horizonChanged, setHorizonChanged] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [savedReport, setSavedReport] = useState<SavedReport | null>(null);
  const analysisLock = useRef(false);

  useEffect(() => {
    if (!signedIn || !profile) return;
    setRiskTolerance((current) => applyPreferenceDefault(current, profile.defaultRiskTolerance, riskChanged));
    setHorizon((current) => applyPreferenceDefault(current, profile.defaultResearchHorizon, horizonChanged));
  }, [profile, signedIn, riskChanged, horizonChanged]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetch(`/api/snapshot?symbol=${encodeURIComponent(symbol)}`)
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message = typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
            ? payload.message : 'Stock evidence could not be loaded.';
          throw new Error(message);
        }
        if (!isSnapshotResponse(payload, symbol)) throw new Error('The market snapshot response was invalid.');
        if (active) setSnapshot(payload);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Stock evidence could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [symbol]);

  useEffect(() => {
    try { setWatchlist(parseSavedWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY))); }
    catch { setWatchlist([]); }
    setWatchlistReady(true);
  }, []);

  function toggleWatchlist() {
    const exists = watchlist.includes(symbol);
    let next: string[];
    if (exists) next = removeWatchlistSymbol(watchlist, symbol);
    else {
      const added = addWatchlistSymbol(watchlist, symbol);
      if (!added.ok) {
        setWatchlistMessage(added.reason === 'limit' ? 'The watchlist is limited to 30 symbols.' : 'This symbol could not be added.');
        return;
      }
      next = added.symbols;
    }
    setWatchlist(next);
    setWatchlistMessage(exists ? `${symbol} removed from the watchlist.` : `${symbol} added to the watchlist.`);
    try { window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next)); }
    catch { setWatchlistMessage('Browser storage is unavailable; this watchlist change may not survive a refresh.'); }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!qwenAvailability.available || analysisLock.current) return;
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length < 10 || trimmedQuestion.length > 600) {
      setAnalysisError('Validation error: enter a research question between 10 and 600 characters.');
      return;
    }
    const parsedEntry = entryPrice.trim() === '' ? null : Number(entryPrice);
    if (parsedEntry !== null && (!Number.isFinite(parsedEntry) || parsedEntry <= 0 || parsedEntry > 10_000_000)) {
      setAnalysisError('Validation error: enter a positive entry price no greater than $10,000,000, or leave it blank.');
      return;
    }

    const request: ResearchRequest = { symbol, question: trimmedQuestion, horizon, riskTolerance, entryPrice: parsedEntry, positionSize: null };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 330_000);
    analysisLock.current = true;
    setAnalysisBusy(true);
    setAnalysisError('');
    setSavedReport(null);
    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      let payload: unknown;
      try { payload = await response.json(); }
      catch { payload = null; }
      if (!response.ok) {
        setAnalysisError(researchErrorMessage(response.status, payload));
        return;
      }
      const parsed = parseQwenSavedReport(payload, request);
      if (!parsed) {
        setAnalysisError('Validation error: the research service returned a malformed or non-Qwen report. It was not displayed.');
        return;
      }
      setSavedReport(parsed);
    } catch (cause) {
      setAnalysisError(isAbortError(cause)
        ? 'Timeout: the research request took too long. Try again later.'
        : `Provider/network error: ${cause instanceof Error ? cause.message : 'the research service could not be reached.'}`);
    } finally {
      window.clearTimeout(timeout);
      analysisLock.current = false;
      setAnalysisBusy(false);
    }
  }

  const company = snapshot?.profile.data;
  const quote = snapshot?.quote.data;
  const financials = snapshot?.financials.data;
  const statement = financials?.statements.at(-1);
  const ratios = financials?.ratios;
  const indicators = snapshot?.indicators;
  const usingDemo = snapshot ? [snapshot.quote, snapshot.candles, snapshot.profile, snapshot.financials, snapshot.estimates, snapshot.earnings, snapshot.news].some((slot) => slot.provenance?.status === 'demo') : false;

  return <main className="shell"><SiteHeader activeSection="stocks"/><section className="content stock-profile-content">
    <p className="eyebrow"><Link href="/stocks">STOCK PROFILES</Link> / {symbol}</p>
    {loading && <div className="loading" role="status" aria-live="polite">Loading available evidence for {symbol}…</div>}
    {!loading && error && <section className="error" role="alert"><h1>Stock data unavailable</h1><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Try again</button></section>}
    {!loading && !error && snapshot && <>
      {usingDemo && <div className="demo-banner" role="note"><strong>DEMO DATA</strong><span>Values shown from demonstration sources are synthetic and do not represent a real company or market activity.</span></div>}
      <header className="stock-profile-heading"><div><p className="eyebrow">{company?.name ?? 'Company name unavailable'}</p><h1>{symbol} <span className="status">{evidenceStatus(snapshot.quote)}</span></h1><StatusLine slot={snapshot.quote}/></div><div className="stock-profile-actions"><button type="button" onClick={toggleWatchlist} disabled={!watchlistReady}>{watchlist.includes(symbol) ? 'Remove from watchlist' : 'Add to watchlist'}</button><Link className="stock-primary-action" href={`/?symbol=${encodeURIComponent(symbol)}`}>Research this stock</Link></div></header>
      {watchlistMessage && <p role="status" className="watchlist-message">{watchlistMessage}</p>}
      <div className="stock-profile-grid">
        <section className="panel stock-panel"><PanelTitle eyebrow="COMPANY OVERVIEW" title="Company profile" status={snapshot.profile}/>
          <ValueRow name="Company name" value={company?.name ?? 'Unavailable'}/><ValueRow name="Sector" value={company?.sector ?? 'Unavailable'}/><ValueRow name="Industry" value={company?.industry ?? 'Unavailable'}/><ValueRow name="Exchange" value={company?.exchange ?? quote?.exchange ?? 'Unavailable'}/><ValueRow name="Country" value={company?.country ?? 'Unavailable'}/><ValueRow name="Employees" value={number(company?.employees)}/><ValueRow name="IPO date" value={company?.ipoDate ?? 'Unavailable'}/>
          <div className="stock-description"><h3>Description</h3><p>{company?.description ?? 'Unavailable'}</p><h3>Website</h3>{safeExternalUrl(company?.website) ? <a href={safeExternalUrl(company?.website) ?? undefined} target="_blank" rel="noopener noreferrer">{company?.website}</a> : <p>Unavailable</p>}</div>
        </section>
        <section className="panel stock-panel"><PanelTitle eyebrow="MARKET SNAPSHOT" title="Latest market data" status={snapshot.quote}/>
          <div className="stock-metrics"><Metric label="Price" value={currency(quote?.price)}/><Metric label="Daily change" value={quote?.change == null || quote.changePercent == null ? 'Unavailable' : `${quote.change >= 0 ? '+' : ''}${percent(quote.changePercent)}`}/><Metric label="Volume" value={number(quote?.volume)}/><Metric label="Market cap" value={currency(quote?.marketCap ?? company?.marketCap)}/></div>
          <ValueRow name="Open" value={currency(quote?.open)}/><ValueRow name="High" value={currency(quote?.high)}/><ValueRow name="Low" value={currency(quote?.low)}/><ValueRow name="Previous close" value={currency(quote?.previousClose)}/><ValueRow name="52-week high" value={currency(ratios?.fiftyTwoWeekHigh ?? indicators?.levels?.fiftyTwoWeekHigh)}/><ValueRow name="52-week low" value={currency(ratios?.fiftyTwoWeekLow ?? indicators?.levels?.fiftyTwoWeekLow)}/>
          <p className="stock-status">Snapshot generated at {snapshot.generatedAt}. 52-week values use reported ratios when available; otherwise they are calculated from the loaded candle history.</p>
        </section>
        <section className="panel stock-panel"><PanelTitle eyebrow="LOCAL CALCULATIONS" title="Technical analysis" status={snapshot.candles}/><p className="muted">Calculated from the available daily candle series. These are descriptive calculations, not investment recommendations.</p>
          <ValueRow name="Trend direction" value={label(indicators?.trend?.direction)}/><ValueRow name="Trend strength" value={indicators?.trend ? percent(indicators.trend.strength * 100) : 'Unavailable'}/><ValueRow name="RSI (14)" value={number(indicators?.rsi14?.latest)}/><ValueRow name="RSI state" value={label(indicators?.rsiState)}/><ValueRow name="MACD state" value={label(indicators?.macd?.latest.state)}/><ValueRow name="SMA 20 / 50" value={`${number(indicators?.sma20?.latest)} / ${number(indicators?.sma50?.latest)}`}/><ValueRow name="EMA 20 / 50" value={`${number(indicators?.ema20?.latest)} / ${number(indicators?.ema50?.latest)}`}/><ValueRow name="ATR (14)" value={number(indicators?.atr14?.latest)}/><ValueRow name="ATR as % of price" value={percent(indicators?.atrPercent)}/><ValueRow name="Bollinger position" value={label(indicators?.bollinger?.latest.position)}/><ValueRow name="Volume trend" value={label(indicators?.volume?.direction)}/><ValueRow name="Nearest support" value={currency(indicators?.levels?.nearestSupport?.price)}/><ValueRow name="Nearest resistance" value={currency(indicators?.levels?.nearestResistance?.price)}/><ValueRow name="Multi-timeframe alignment" value={label(indicators?.multiTimeframe?.alignment)}/>
          {indicators?.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
        </section>
        <section className="panel stock-panel"><PanelTitle eyebrow="REPORTED FUNDAMENTALS" title="Financials and valuation" status={snapshot.financials}/>
          {statement && <p className="muted">{label(statement.period)} period · as of {statement.asOf ?? 'date unavailable'}</p>}
          {!statement && <p className="empty">Fundamentals unavailable. No values have been estimated.</p>}
          <ValueRow name="Revenue" value={currency(statement?.revenue)}/><ValueRow name="Revenue growth YoY" value={percent(statement?.revenueGrowthYoY)}/><ValueRow name="EPS" value={currency(statement?.eps)}/><ValueRow name="EPS growth YoY" value={percent(statement?.epsGrowthYoY)}/><ValueRow name="Gross margin" value={percent(statement?.grossMargin)}/><ValueRow name="Operating margin" value={percent(statement?.operatingMargin)}/><ValueRow name="Net margin" value={percent(statement?.netMargin)}/><ValueRow name="Free cash flow" value={currency(statement?.freeCashFlow)}/><ValueRow name="Cash" value={currency(statement?.totalCash)}/><ValueRow name="Debt" value={currency(statement?.totalDebt)}/>
          <h3 className="stock-subheading">Valuation ratios</h3><ValueRow name="P/E (trailing)" value={number(ratios?.peTrailing)}/><ValueRow name="P/E (forward)" value={number(ratios?.peForward)}/><ValueRow name="PEG" value={number(ratios?.pegRatio)}/><ValueRow name="Price-to-sales" value={number(ratios?.priceToSales)}/><ValueRow name="Price-to-book" value={number(ratios?.priceToBook)}/><ValueRow name="EV/EBITDA" value={number(ratios?.evToEbitda)}/><ValueRow name="Dividend yield" value={percent(ratios?.dividendYieldPercent)}/><ValueRow name="Beta" value={number(ratios?.beta)}/>
        </section>
        <section className="panel stock-panel"><PanelTitle eyebrow="CATALYSTS" title="Earnings, estimates, and news" status={snapshot.earnings}/>
          <h3 className="stock-subheading">Earnings calendar</h3>{snapshot.earnings.data?.length ? snapshot.earnings.data.map((event, index) => <div className="list-row stock-earnings-row" key={`${event.date}-${index}`}><span>{event.date} · {label(event.timeOfDay)} · {label(event.status)}<small>EPS estimate {number(event.epsEstimate)} · actual {number(event.epsActual)} · revenue estimate {currency(event.revenueEstimate)} · actual {currency(event.revenueActual)}</small></span></div>) : <p className="empty">Earnings calendar unavailable.</p>}
          <h3 className="stock-subheading">Analyst estimates</h3><StatusLine slot={snapshot.estimates}/>{snapshot.estimates.data ? <><ValueRow name="Consensus" value={snapshot.estimates.data.ratingConsensus ?? 'Unavailable'}/><ValueRow name="Mean target" value={currency(snapshot.estimates.data.targetMean)}/><ValueRow name="Target range" value={`${currency(snapshot.estimates.data.targetLow)} – ${currency(snapshot.estimates.data.targetHigh)}`}/><ValueRow name="Analysts covering" value={number(snapshot.estimates.data.analystsCovering)}/><ValueRow name="Current / next year EPS" value={`${number(snapshot.estimates.data.epsCurrentYear)} / ${number(snapshot.estimates.data.epsNextYear)}`}/></> : <p className="empty">Analyst estimates unavailable.</p>}
          <h3 className="stock-subheading">Recent sourced news</h3><StatusLine slot={snapshot.news}/>{snapshot.news.data?.length ? snapshot.news.data.map((item) => <article className="stock-news-item" key={item.id}><h4>{safeExternalUrl(item.url) ? <a href={safeExternalUrl(item.url) ?? undefined} target="_blank" rel="noopener noreferrer">{item.headline}</a> : item.headline}</h4><p>{item.source} · {item.publishedAt}</p>{item.summary && <p>{item.summary}</p>}</article>) : <p className="empty">No sourced news items are available.</p>}
        </section>
      </div>
      <p className="disclaimer">Research only. Provider status and provenance appear with each section. Unavailable fields are not estimated. Human decision required.</p>
    </>}
    <section className="panel qwen-analysis-panel" aria-labelledby="qwen-analysis-title">
      <p className="eyebrow">ON-DEMAND AI RESEARCH</p><h2 id="qwen-analysis-title">Analyze with Qwen</h2>
      <p className="muted">A click sends this question to the server-side research pipeline. Evidence is retrieved again and strictly validated before a report is saved. No analysis runs while opening or browsing stock profiles.</p>
      {!qwenAvailability.available && <p className="analysis-unavailable" role="status">{qwenAvailability.message} No live Qwen request was made.</p>}
      <form className="research-form stock-research-form" onSubmit={(event) => void analyze(event)}>
        <label>Research question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength={10} maxLength={600} required rows={3}/></label>
        <label>Risk tolerance<select value={riskTolerance} onChange={(event) => { const value = event.target.value; if (isRiskTolerance(value)) { setRiskChanged(true); setRiskTolerance(value); } }}>{riskOptions.map((value) => <option key={value} value={value}>{value[0]?.toUpperCase()}{value.slice(1)}</option>)}</select></label>
        <label>Time horizon<select value={horizon} onChange={(event) => { const option = horizonOptions.find(([value]) => value === event.target.value); if (option) { setHorizonChanged(true); setHorizon(option[0]); } }}>{horizonOptions.map(([value, labelText]) => <option key={value} value={value}>{labelText}</option>)}</select></label>
        <label>Optional entry price (USD)<input type="number" min="0.01" max="10000000" step="0.01" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} placeholder="Not supplied"/></label>
        <button type="submit" disabled={!qwenAvailability.available || analysisBusy}>{analysisBusy ? 'Analyzing with Qwen…' : 'Analyze with Qwen'}</button>
      </form>
      {analysisBusy && <p role="status" aria-live="polite">Collecting evidence, validating citations, and waiting for Qwen…</p>}
      {analysisError && <p className="error" role="alert">{analysisError}</p>}
      {savedReport && <><p className="analysis-success" role="status">Qwen analysis saved at {new Date(savedReport.createdAt).toLocaleString()} · model {qwenAvailability.model ?? 'Qwen model unavailable'}.</p><Link className="saved-report-link" href={`/reports/${encodeURIComponent(savedReport.id)}`}>View saved report</Link><ReportView initialReport={savedReport} modelLabel={qwenAvailability.model ?? undefined}/></>}
      <p className="disclaimer">Research only. Qwen output can be incomplete or wrong. Verify citations and evidence, and make your own decision. No trades are placed.</p>
    </section>
  </section></main>;
}

function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError';
}

function researchErrorMessage(status: number, value: unknown): string {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  const code = record && 'code' in record && typeof record.code === 'string' ? record.code : '';
  const message = record && 'message' in record && typeof record.message === 'string' ? record.message : 'The research request could not be completed.';
  if (status === 429 || code === 'ai_rate_limited' || code === 'rate_limited') return `Rate limit: ${message}`;
  if (code === 'ai_not_configured' || code === 'not_configured') return `Configuration: ${message}`;
  if (code === 'timeout' || code === 'ai_timeout') return `Timeout: ${message}`;
  if (code === 'invalid_input' || code === 'invalid_json' || code === 'request_too_large' || code === 'ai_invalid_response' || code === 'invalid_payload') return `Validation error: ${message}`;
  if (code === 'unauthorized' || code === 'ai_unauthorized' || code === 'upstream_error' || code === 'ai_upstream_error' || code === 'network' || code === 'no_evidence') return `Provider error: ${message}`;
  return `Research error: ${message}`;
}

function PanelTitle({ eyebrow, title, status }: { eyebrow: string; title: string; status: EvidenceSource }) {
  return <div className="panel-title"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span className="status">{evidenceStatus(status)}</span></div>;
}

function Metric({ label: metricLabel, value }: { label: string; value: string }) {
  return <article className="metric"><span>{metricLabel}</span><strong>{value}</strong></article>;
}
