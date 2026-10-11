'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { SiteHeader } from '@/components/site-header.tsx';
import { DEFAULT_WATCHLIST, parseSavedWatchlist, WATCHLIST_STORAGE_KEY } from '@/lib/market/watchlist.ts';
import { normalizeSymbol } from '@/lib/market/symbols.ts';

export default function StocksPage() {
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<string[]>([...DEFAULT_WATCHLIST]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try { setWatchlist(parseSavedWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY))); }
    catch { setWatchlist([...DEFAULT_WATCHLIST]); }
    setReady(true);
  }, []);

  function openSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbol = normalizeSymbol(search);
    if (!symbol) { setError('Enter a valid US ticker symbol, such as NVDA or BRK.B.'); return; }
    setError('');
    router.push(`/stocks/${encodeURIComponent(symbol)}`);
  }

  return <main className="shell"><SiteHeader activeSection="stocks"/><section className="content stocks-content">
    <p className="eyebrow">US EQUITY RESEARCH</p><h1>Stock profiles</h1><p className="muted">Review available company, market, technical, fundamental, earnings, and news evidence. Calculations are informational, not recommendations.</p>
    <form className="stock-search-form" onSubmit={openSymbol} noValidate>
      <label htmlFor="stock-search">Search a symbol</label><div><input id="stock-search" value={search} onChange={(event) => { setSearch(event.target.value.toUpperCase()); setError(''); }} maxLength={10} placeholder="e.g. NVDA" autoComplete="off"/><button type="submit">View profile</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
    <section className="panel stock-directory"><div className="panel-title"><div><p className="eyebrow">SAVED LOCALLY</p><h2>Your watchlist</h2></div><span>{ready ? watchlist.length : '…'} symbols</span></div>
      {!ready ? <p role="status">Loading saved symbols…</p> : watchlist.length ? <ul>{watchlist.map((symbol) => <li key={symbol}><Link href={`/stocks/${encodeURIComponent(symbol)}`}><strong>{symbol}</strong><span>View stock profile →</span></Link></li>)}</ul> : <p className="empty">Your watchlist is empty. Add symbols from the research workspace.</p>}
    </section>
  </section></main>;
}
