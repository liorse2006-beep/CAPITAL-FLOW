import React, { useState, useMemo } from 'react'
import { NASDAQ100, SP500_TOP, SECTOR_TICKERS } from '../../data/tickers'

export default function AddTickerModal({ watchlist, onAdd, onClose }) {
  const [query, setQuery] = useState('')

  const allTickers = useMemo(() => {
    const set = new Set([...NASDAQ100, ...SP500_TOP, ...Object.values(SECTOR_TICKERS).flat()])
    return [...set].sort()
  }, [])

  const searchResults = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toUpperCase()
    return allTickers.filter((t) => t.includes(q)).slice(0, 40)
  }, [query, allTickers])

  function renderTicker(sym) {
    const already = watchlist.includes(sym)
    return (
      <button
        key={sym}
        className={'add-ticker-item' + (already ? ' added' : '')}
        onClick={() => !already && onAdd(sym)}
        disabled={already}
      >
        <img
          className="ticker-logo"
          src={'https://assets.parqet.com/logos/symbol/' + sym}
          alt=""
          width={20}
          height={20}
          onError={(e) => { e.target.style.display = 'none' }}
        />
        <span className="add-ticker-sym">{sym}</span>
        {already
          ? <span className="add-ticker-check">✓</span>
          : <span className="add-ticker-plus">+</span>
        }
      </button>
    )
  }

  return (
    <div className="atm-overlay" onClick={onClose}>
      <div className="atm-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="atm-header">
          <div className="atm-header-left">
            <div className="atm-icon-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <h3 className="atm-title">Add Ticker</h3>
          </div>
          <button className="atm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="atm-search-wrap">
          <svg className="atm-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="atm-search"
            placeholder="Search by symbol — e.g. AAPL, NVDA…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button className="atm-clear" onClick={() => setQuery('')} aria-label="Clear">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        <p className="atm-scope">Only from: S&amp;P 500 · NASDAQ 100 · Top 5 per sector</p>

        {/* Results */}
        <div className="atm-list">
          {query.trim() === '' && (
            <div className="atm-empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.3">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span>Search for a ticker to add it</span>
            </div>
          )}
          {searchResults.map(renderTicker)}
          {query.trim() !== '' && searchResults.length === 0 && (
            <div className="atm-empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.3">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span>"{query.trim().toUpperCase()}" not in our lists</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
