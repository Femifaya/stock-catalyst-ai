'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

type Slot<T> = { data: T | null; provenance: { source: string; status: string; asOf: string | null } | null; error: { code: string; message: string } | null };
type Snapshot = {
  symbol: string;
  generatedAt: string;
  quote: Slot<{ price: number | null; changePercent: number | null; volume: number | null; marketCap: number | null }>;
  candles: Slot<{ candles: Array<{ time: string; close: number }>; adjustment: string }>;
  profile: Slot<{ name: string | null; sector: string | null; industry: string | null }>;
  earnings: Slot<Array<{ date: string; status: string; epsEstimate: number | null }>>;
  news: Slot<Array<{ headline: string; source: string; publishedAt: string; url: string }>>;
  indicators: { trend: { direction: string; strength: number } | null; rsi14: { latest: number | null } | null; warnings: string[] } | null;
};

const watchlist = ['NVDA', 'MSFT', 'AAPL', 'AMZN', 'TSLA'];
const money = (n: number | null | undefined) => n == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const label = (status?: string) => (status ?? 'unavailable').toUpperCase();

export default function Home() {
  const [symbol, setSymbol] = useState('NVDA');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(nextSymbol: string) {
    setBusy(true); setError(''); setSymbol(nextSymbol);
    try {
      const response = await fetch(`/api/snapshot?symbol=${encodeURIComponent(nextSymbol)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Could not load this symbol.');
      setSnapshot(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed.'); setSnapshot(null); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(symbol); }
  const quote = snapshot?.quote.data;
  const series = snapshot?.candles.data?.candles ?? [];
  const last = series.at(-1)?.close;
  const chartPoints = series.slice(-80).map((bar) => bar.close);
  const min = chartPoints.length ? Math.min(...chartPoints) : 0;
  const max = chartPoints.length ? Math.max(...chartPoints) : 1;
  const points = chartPoints.map((price, index) => `${chartPoints.length < 2 ? 0 : index / (chartPoints.length - 1) * 100},${36 - ((price - min) / (max - min || 1)) * 32}`).join(' ');

  return <main className="shell">
    <a className="skip" href="#main">Skip to content</a>
    <header className="topbar"><div className="brand"><span className="brand-mark">C</span><span>CATALYST <small>RESEARCH DESK</small></span></div><nav><a className="active" href="/">Workspace</a><a href="/reports">Reports</a><a href="/settings">Settings</a></nav><span className="research-only">RESEARCH ONLY</span></header>
    <div className="layout">
      <aside className="sidebar"><div className="side-title">WATCHLIST <button aria-label="Add symbol" title="Add symbol">+</button></div><p className="muted">US EQUITIES</p>{watchlist.map((item) => <button className={`watch-row ${symbol === item ? 'selected' : ''}`} key={item} onClick={() => void load(item)}><span>{item}</span><span className="watch-status">{snapshot?.symbol === item ? label(snapshot.quote.provenance?.status) : '—'}</span></button>)}<div className="side-note"><span className="dot"/> Human decision required<br/><small>No trading or order execution.</small></div></aside>
      <section id="main" className="content">
        <div className="page-heading"><div><p className="eyebrow">MARKET OVERVIEW / US EQUITIES</p><h1>Research workspace</h1><p className="muted">A clear view of market data, catalysts, and technical context.</p></div><form onSubmit={submit} className="search"><label htmlFor="symbol">SYMBOL</label><input id="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={10} placeholder="NVDA"/><button disabled={busy}>{busy ? 'Loading…' : 'Load'}</button></form></div>
        {error && <div className="error" role="alert">{error}</div>}
        {!snapshot && !busy && <div className="welcome"><div className="welcome-icon">↗</div><h2>Your research starts here</h2><p>Choose a symbol to gather market data and review its provenance. Missing data stays clearly marked as unavailable.</p><button onClick={() => void load('NVDA')}>Load NVDA snapshot</button></div>}
        {busy && <div className="loading">Gathering market data for {symbol}…</div>}
        {snapshot && <>
          <section className="quote-head"><div><p className="eyebrow">{snapshot.profile.data?.name ?? snapshot.symbol}{snapshot.profile.data?.sector ? ` · ${snapshot.profile.data.sector}` : ''}</p><h2>{snapshot.symbol} <span className="status">{label(snapshot.quote.provenance?.status)}</span></h2></div><div className="price">{money(quote?.price)}<small>{quote?.changePercent == null ? 'Change unavailable' : `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}% today`}</small></div></section>
          <section className="cards"><Metric name="LAST PRICE" value={money(quote?.price)} status={snapshot.quote.provenance?.status}/><Metric name="SESSION CHANGE" value={quote?.changePercent == null ? 'n/a' : `${quote.changePercent.toFixed(2)}%`} status={snapshot.quote.provenance?.status}/><Metric name="VOLUME" value={quote?.volume == null ? 'n/a' : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(quote.volume)} status={snapshot.quote.provenance?.status}/><Metric name="MARKET CAP" value={quote?.marketCap == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(quote.marketCap)} status={snapshot.quote.provenance?.status}/></section>
          <div className="columns"><section className="panel chart-panel"><div className="panel-title"><div><p className="eyebrow">PRICE HISTORY</p><h3>Daily close</h3></div><span className="status">{label(snapshot.candles.provenance?.status)}</span></div>{chartPoints.length > 1 ? <><svg className="chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${snapshot.symbol} daily closing prices over ${chartPoints.length} recent sessions`}><polyline points={points} fill="none" stroke="#71e0b4" strokeWidth=".7" vectorEffect="non-scaling-stroke"/></svg><div className="chart-foot"><span>{snapshot.candles.provenance?.asOf ? new Date(snapshot.candles.provenance.asOf).toLocaleDateString() : 'Period start'}</span><span>Close {money(last ?? null)} · {snapshot.candles.data?.adjustment ?? 'adjustment unknown'}</span></div></> : <div className="empty">Historical candles unavailable from configured sources.</div>}</section>
            <section className="panel"><div className="panel-title"><div><p className="eyebrow">LOCAL CALCULATIONS</p><h3>Technical context</h3></div><span className="type-tag">CALCULATION</span></div><div className="indicator-row"><span>Trend</span><strong>{snapshot.indicators?.trend?.direction ?? 'n/a'}</strong></div><div className="indicator-row"><span>Trend strength</span><strong>{snapshot.indicators?.trend ? `${(snapshot.indicators.trend.strength * 100).toFixed(0)}%` : 'n/a'}</strong></div><div className="indicator-row"><span>RSI (14)</span><strong>{snapshot.indicators?.rsi14?.latest == null ? 'n/a' : snapshot.indicators.rsi14.latest.toFixed(1)}</strong></div>{snapshot.indicators?.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}</section></div>
          <div className="columns lower"><section className="panel"><div className="panel-title"><div><p className="eyebrow">UPCOMING & RECENT</p><h3>Earnings</h3></div><span className="type-tag">DATA</span></div>{snapshot.earnings.data?.length ? snapshot.earnings.data.slice(0, 3).map((event, i) => <div className="list-row" key={`${event.date}-${i}`}><span>{new Date(event.date).toLocaleDateString()}</span><strong>{event.status}</strong></div>) : <div className="empty">Earnings calendar unavailable.</div>}</section><section className="panel"><div className="panel-title"><div><p className="eyebrow">CATALYST FEED</p><h3>Recent news</h3></div><span className="type-tag">SOURCE LINKED</span></div>{snapshot.news.data?.length ? snapshot.news.data.slice(0, 4).map((item, i) => <a className="news-row" key={`${item.url}-${i}`} href={item.url} target="_blank" rel="noreferrer"><strong>{item.headline}</strong><small>{item.source} · {new Date(item.publishedAt).toLocaleDateString()}</small></a>) : <div className="empty">News unavailable from configured sources.</div>}</section></div>
          <p className="disclaimer">Research only. Data may be delayed, cached, or unavailable. Technical indicators are local calculations, not recommendations. Human decision required.</p>
        </>}
      </section>
    </div>
  </main>;
}

function Metric({ name, value, status }: { name: string; value: string; status?: string }) { return <article className="metric"><span>{name}</span><strong>{value}</strong><small>{label(status)}</small></article>; }
