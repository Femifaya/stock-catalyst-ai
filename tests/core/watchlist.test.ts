import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  addWatchlistSymbol,
  DEFAULT_WATCHLIST,
  MAX_WATCHLIST_SYMBOLS,
  parseSavedWatchlist,
  removeWatchlistSymbol,
  sanitizeWatchlist,
} from '../../src/lib/market/watchlist.ts';

describe('watchlist', () => {
  it('provides the default symbols when no saved list exists', () => {
    assert.deepEqual(parseSavedWatchlist(null), DEFAULT_WATCHLIST);
  });

  it('normalizes valid symbols, removes duplicates and invalid entries, and caps saved lists', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const longList = Array.from({ length: MAX_WATCHLIST_SYMBOLS + 5 }, (_, index) => {
      const suffix = index < letters.length
        ? letters.charAt(index)
        : `${letters.charAt(Math.floor(index / letters.length) - 1)}${letters.charAt(index % letters.length)}`;
      return `T${suffix}`;
    });
    const symbols = sanitizeWatchlist([' nvda ', 'NVDA', 'brk.b', 'not a symbol', ...longList]);

    assert.equal(symbols[0], 'NVDA');
    assert.equal(symbols[1], 'BRK.B');
    assert.equal(symbols.length, MAX_WATCHLIST_SYMBOLS);
  });

  it('uses defaults for malformed saved JSON and preserves an intentionally empty list', () => {
    assert.deepEqual(parseSavedWatchlist('{broken'), DEFAULT_WATCHLIST);
    assert.deepEqual(parseSavedWatchlist('[]'), []);
  });

  it('adds normalized valid symbols and reports invalid, duplicate, and full-list cases', () => {
    const added = addWatchlistSymbol(['NVDA'], ' msft ');
    assert.deepEqual(added, { ok: true, symbols: ['NVDA', 'MSFT'] });
    assert.deepEqual(addWatchlistSymbol(['NVDA'], 'bad ticker'), { ok: false, reason: 'invalid' });
    assert.deepEqual(addWatchlistSymbol(['NVDA'], ' nvda '), { ok: false, reason: 'duplicate' });

    const fullList = Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, index) => `T${index}`);
    assert.deepEqual(addWatchlistSymbol(fullList, 'NEW'), { ok: false, reason: 'limit' });
  });

  it('removes only the selected symbol', () => {
    assert.deepEqual(removeWatchlistSymbol(['NVDA', 'MSFT', 'AAPL'], 'MSFT'), ['NVDA', 'AAPL']);
    assert.deepEqual(removeWatchlistSymbol(['NVDA'], 'MSFT'), ['NVDA']);
  });
});
