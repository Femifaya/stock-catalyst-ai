import React from 'react';
import { notFound } from 'next/navigation';
import { StockProfile } from '@/components/stock-profile.tsx';
import { normalizeSymbol } from '@/lib/market/symbols.ts';
import { getConfig } from '@/lib/config/env.ts';

export const dynamic = 'force-dynamic';

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = await params;
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) notFound();
  const config = getConfig();
  const qwenAvailability = config.demoMode
    ? { available: false, model: null, message: 'Live Qwen analysis is unavailable while Demo Mode is enabled.' }
    : config.qwen.isConfigured
      ? { available: true, model: config.qwen.model, message: '' }
      : { available: false, model: null, message: 'Qwen is not configured on this server, so live analysis is unavailable.' };
  return <StockProfile symbol={symbol} qwenAvailability={qwenAvailability}/>;
}
