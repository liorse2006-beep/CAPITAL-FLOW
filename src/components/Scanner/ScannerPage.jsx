import React, { useState, useEffect } from 'react'
import ScanLoader from '../shared/ScanLoader'
import ScheduleScan from '../shared/ScheduleScan'
import ElectricBorder from '../shared/ElectricBorder'
import SectorPickerModal from './SectorPickerModal'
import useSmoothProgress from '../../hooks/useSmoothProgress'
import { fmt, friendlyError, alertLevelLabel } from '../../utils/format'

const ALL_SECTORS = [
  'Technology',
  'Financials',
  'Health Care',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Industrials',
  'Materials',
  'Real Estate',
  'Utilities',
  'Communication Services',
  'Semiconductors',
]

const SCAN_MODE_OPTIONS = [
  {
    mode: 'all',
    color: '#06B6D4',
    label: 'Full Scan',
    desc: 'S&P 500 + NASDAQ 100 + all sectors combined',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    mode: 'sp500',
    color: '#22C55E',
    label: 'S&P 500',
    desc: "America's 500 largest public companies by market cap",
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01" />
      </svg>
    ),
  },
  {
    mode: 'nasdaq100',
    color: '#3B82F6',
    label: 'NASDAQ 100',
    desc: 'Top 100 innovative and tech-dominant companies',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    mode: 'sectors',
    color: '#F59E0B',
    label: 'By Sector',
    desc: 'Target specific industries — top 5 holdings per sector',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2v10l7 4" />
        <path d="M12 12l-7 4" />
      </svg>
    ),
  },
]

function isMarketOpenNow() {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const mins = et.getHours() * 60 + et.getMinutes()
  return day !== 0 && day !== 6 && mins >= 570 && mins < 960
}

function TH({ label, field, sortField, sortDir, isPremium, onSort, onSortReset }) {
  return (
    <th
      className={sortField === field ? 'active' : ''}
      onClick={() => isPremium && onSort(field)}
      onDoubleClick={() => isPremium && onSortReset()}
      style={isPremium ? {} : { cursor: 'default' }}
    >
      {label}
      {sortField === field && isPremium && <span className="sort-icon">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

export default function ScannerPage({
  scanning,
  progress,
  liveResults,
  error,
  setError,
  startScan,
  isPremium,
  isElite,
  setShowUpgradeModal,
  results,
  setResults,
  setScanTime,
  scanMode,
  setScanMode,
  selectedSectors,
  setSelectedSectors,
  toggleSector,
  minRatio,
  setMinRatio,
  minCap,
  setMinCap,
  minVol,
  setMinVol,
  showPresetPanel,
  setShowPresetPanel,
  presetName,
  setPresetName,
  savePreset,
  presets,
  loadPreset,
  deletePreset,
  marketClosed,
  scanTime,
  fromCache,
  cacheAge,
  restoredFromLastScan,
  sorted,
  visibleCount,
  setVisibleCount,
  sortField,
  sortDir,
  handleSort,
  handleSortDoubleClick,
  alertLevels,
  promptCreateAlert,
  explainWithCapi,
  isInWatchlist,
  toggleWatchlistTicker,
  openChart,
  scanMeta,
  maxFreeSectors,
  maxPremiumSectors,
  sectorLimit,
  user,
  onUpgrade,
  onSignIn,
}) {
  const [currentTime, setCurrentTime] = useState(null)
  const [showSectorModal, setShowSectorModal] = useState(false)

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(new Date())
    updateCurrentTime()
    const timer = window.setInterval(updateCurrentTime, 60000)
    return () => window.clearInterval(timer)
  }, [])

  const lastCount = results ? results.length : null
  const mktOpen = isMarketOpenNow()
  const rawProgressPct = progress && progress.total ? (progress.processed / progress.total) * 100 : 0
  const displayProgressPct = useSmoothProgress(rawProgressPct, scanning && !!progress)
  // Free-tier users get full filter access during their 7-day trial, same
  // as premium — only locked once the trial has actually ended.
  const trialActive = !!(scanMeta && scanMeta.free && scanMeta.free.trialActive)
  const filtersUnlocked = isPremium || trialActive
  function goToUpgrade() {
    setShowUpgradeModal(true)
  }

  // The desktop results table's per-row actions (Chart/News/Alert/AI
  // Insights) are icon-only, no text — this one-time legend explains them
  // the first time a table is ever shown, then never appears again
  // (localStorage flag, not per-session).
  const [showActionHint, setShowActionHint] = useState(function () {
    return !localStorage.getItem('vs_action_hint_seen')
  })
  function dismissActionHint() {
    localStorage.setItem('vs_action_hint_seen', '1')
    setShowActionHint(false)
  }


  return (
    <div className="page-content">
      {/* Scanning: Radar + Live Results Feed */}
      {scanning && progress && (
        <div className="scan-live-wrap">
          <div className="scan-radar-section">
            <div className="scan-radar">
              <div className="radar-ring ring-1" />
              <div className="radar-ring ring-2" />
              <div className="radar-ring ring-3" />
              <div className="radar-sweep" />
              {liveResults.length > 0 &&
                liveResults.slice(-5).map((r, i) => {
                  const angle = ((i * 72 + 30) * Math.PI) / 180
                  const dist = 25 + (i % 3) * 15
                  const x = 50 + Math.cos(angle) * dist
                  const y = 50 + Math.sin(angle) * dist
                  return (
                    <div key={r.symbol} className="radar-blip" style={{ left: x + '%', top: y + '%' }}>
                      {r.symbol}
                    </div>
                  )
                })}
            </div>
            <div className="radar-info" role="status" aria-live="polite" aria-atomic="true">
              <div className="radar-pct">{displayProgressPct + '%'}</div>
              <div className="scan-progress-mini">
                <div className="scan-progress-track">
                  <div className="scan-progress-fill" style={{ width: displayProgressPct + '%' }} />
                </div>
              </div>
              <div className="radar-stat">Scanning the market...</div>
              <div className="radar-stat accent">
                {progress.found + ' volume spike' + (progress.found !== 1 ? 's' : '') + ' detected'}
              </div>
            </div>
          </div>

          <ScanLoader
            label="FULL SCAN"
            matches={progress.found || 0}
            statusMessages={[
              'Scanning the market for unusual volume…',
              'Cross-referencing live price and volume data…',
              'Checking every sector for movement…',
              'Comparing against historical averages…',
            ]}
          />

          {liveResults.length > 0 && (
            <div className="live-feed">
              <div className="live-feed-header">
                <span className="live-dot" />
                <span>Live Results</span>
              </div>
              <div className="live-feed-list">
                {liveResults
                  .slice()
                  .reverse()
                  .map((r) => (
                    <div key={r.symbol} className="live-feed-card">
                      <div className="live-feed-left">
                        <span className="live-feed-sym">{r.symbol}</span>
                        <span className="live-feed-name">{r.name}</span>
                      </div>
                      <div className="live-feed-right">
                        <span className="live-feed-ratio">{r.volumeRatio + 'x'}</span>
                        <span className="live-feed-price">{'$' + r.price.toFixed(2)}</span>
                        <span className={r.change >= 0 ? 'live-feed-chg up' : 'live-feed-chg down'}>
                          {(r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error-bar error-bar-action">
          <div className="error-bar-content">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{friendlyError(error)}</span>
          </div>
          <div className="error-bar-actions">
            {error !== 'Scan already in progress' && (
              <button
                className="error-retry-btn"
                onClick={() => {
                  setError(null)
                  startScan()
                }}
              >
                Retry
              </button>
            )}
            <button className="error-dismiss-btn" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Scan mode selector — shown before scanning, FIRST thing user sees */}
      {!results && !scanning && (
        <div className="scan-mode-wrap">
          <div className="scan-mode-header">
            <h2 className="scan-mode-title">Select Universe</h2>
            <p className="scan-mode-sub">Choose which stocks to scan for unusual volume activity</p>
          </div>

          <div className="scan-filters-panel">
            <div
              className="scan-filter-group"
              style={{ '--filter-color': '#06B6D4' }}
              onClick={!filtersUnlocked ? goToUpgrade : undefined}
            >
              <span className="scan-filter-label">Min Ratio</span>
              <div className="scan-filter-input-row">
                <input
                  className="scan-filter-input"
                  type="number"
                  step="0.5"
                  min="1"
                  value={minRatio}
                  onChange={filtersUnlocked ? (e) => setMinRatio(e.target.value) : undefined}
                  readOnly={!filtersUnlocked}
                />
              </div>
            </div>
            <div
              className="scan-filter-group"
              style={{ '--filter-color': '#22C55E' }}
              onClick={!filtersUnlocked ? goToUpgrade : undefined}
            >
              <span className="scan-filter-label">Min Cap $B</span>
              <div className="scan-filter-input-row">
                <input
                  className="scan-filter-input"
                  type="number"
                  step="0.5"
                  min="0"
                  value={minCap}
                  onChange={filtersUnlocked ? (e) => setMinCap(e.target.value) : undefined}
                  readOnly={!filtersUnlocked}
                />
              </div>
            </div>
            <div
              className="scan-filter-group"
              style={{ '--filter-color': '#F59E0B' }}
              onClick={!filtersUnlocked ? goToUpgrade : undefined}
            >
              <span className="scan-filter-label">Min Vol</span>
              <div className="scan-filter-input-row">
                <input
                  className="scan-filter-input"
                  type="text"
                  placeholder="e.g. 1M"
                  value={minVol}
                  onChange={filtersUnlocked ? (e) => setMinVol(e.target.value) : undefined}
                  readOnly={!filtersUnlocked}
                />
              </div>
            </div>

            {scanMode && (
              <div className="scan-filters-actions">
                <button className="scan-btn scan-mode-go" onClick={startScan} disabled={scanning}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span className="scan-mode-go-label">Run Scan</span>
                </button>
                {!isPremium && scanMeta && scanMeta.tier === 'premium' && (
                  <span className="scan-limit-topbar">
                    {(scanMeta.premium ? scanMeta.premium.left : 5) + '/5 scans left today'}
                  </span>
                )}
                <ScheduleScan scanType="capitalFlow" user={user} onUpgrade={onUpgrade} onSignIn={onSignIn} />
              </div>
            )}
          </div>

          <div className="scan-mode-options">
            {SCAN_MODE_OPTIONS.map((cfg) => {
              const isActive = scanMode === cfg.mode
              return (
                <button
                  key={cfg.mode}
                  className={'scan-mode-card' + (isActive ? ' active' : '')}
                  onClick={() => {
                    setScanMode(cfg.mode)
                    if (cfg.mode === 'sectors') setShowSectorModal(true)
                    else setSelectedSectors([])
                  }}
                  style={{ '--card-color': cfg.color }}
                >
                  <div className="scan-mode-glow" />
                  <div className="scan-mode-icon-wrap">{cfg.icon}</div>
                  <div className="scan-mode-label">{cfg.label}</div>
                  <div className="scan-mode-desc">{cfg.desc}</div>
                  {(lastCount !== null || mktOpen) && (
                    <div className="scan-mode-data-strip">
                      {lastCount !== null && (
                        <div className="scan-mode-stat">
                          <span className="scan-mode-stat-label">LAST</span>
                          <span
                            className="scan-mode-stat-val"
                            style={{ color: lastCount > 0 ? 'var(--accent)' : 'var(--text-3)' }}
                          >
                            {lastCount + ' spike' + (lastCount !== 1 ? 's' : '')}
                          </span>
                        </div>
                      )}
                      {mktOpen && (
                        <div className="scan-mode-stat" style={{ marginLeft: 'auto' }}>
                          <div className="scan-mode-live-dot" />
                          <span className="scan-mode-stat-val" style={{ color: 'var(--green)' }}>
                            LIVE
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* "By Sector" opens SectorPickerModal instead of expanding this
              screen — this is just the compact after-the-fact summary. */}
          {scanMode === 'sectors' && (
            <div className="sector-summary-row">
              <span className="sector-summary-text">
                {selectedSectors.length === 0
                  ? 'No sectors selected — will scan top 5 from all sectors'
                  : selectedSectors.length + ' sector' + (selectedSectors.length === 1 ? '' : 's') + ' selected: ' + selectedSectors.join(', ')}
              </span>
              <button className="sector-clear" onClick={() => setShowSectorModal(true)}>
                Change sectors
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filter strip — only shown after scan completes */}
      {results && !scanning && (
        <div className="filter-strip">
          <div className="filter-chip" onClick={!filtersUnlocked ? goToUpgrade : undefined}>
            <label>Min Ratio</label>
            <input
              type="number"
              step="0.5"
              min="1"
              value={minRatio}
              onChange={filtersUnlocked ? (e) => setMinRatio(e.target.value) : undefined}
              readOnly={!filtersUnlocked}
              style={!filtersUnlocked ? { cursor: 'pointer' } : undefined}
            />
          </div>
          <div className="filter-chip" onClick={!filtersUnlocked ? goToUpgrade : undefined}>
            <label>Min Cap $B</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={minCap}
              onChange={filtersUnlocked ? (e) => setMinCap(e.target.value) : undefined}
              readOnly={!filtersUnlocked}
              style={!filtersUnlocked ? { cursor: 'pointer' } : undefined}
            />
          </div>
          <div className="filter-chip" onClick={!filtersUnlocked ? goToUpgrade : undefined}>
            <label>Min Vol</label>
            <input
              type="text"
              placeholder="e.g. 1M"
              value={minVol}
              onChange={filtersUnlocked ? (e) => setMinVol(e.target.value) : undefined}
              readOnly={!filtersUnlocked}
              style={{ width: 56, ...(!filtersUnlocked ? { cursor: 'pointer' } : {}) }}
            />
          </div>
          <button
            className={'filter-toggle' + (showPresetPanel ? ' active' : '')}
            onClick={filtersUnlocked ? () => setShowPresetPanel(!showPresetPanel) : goToUpgrade}
            style={{ marginLeft: 'auto' }}
          >
            Create Preset
          </button>
        </div>
      )}

      {/* Preset panel */}
      {filtersUnlocked && showPresetPanel && (
        <div className="preset-panel">
          <div className="preset-save">
            <input
              type="text"
              placeholder="Preset name..."
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') savePreset()
              }}
              className="preset-input"
            />
            <button className="preset-save-btn" onClick={savePreset}>
              Save
            </button>
          </div>
          {presets.length > 0 && (
            <div className="preset-list">
              {presets.map((p, i) => (
                <div key={i} className="preset-item">
                  <button className="preset-load" onClick={() => loadPreset(p)}>
                    {p.name}
                  </button>
                  <span className="preset-detail">{'Ratio ' + p.minRatio + ' \xb7 Cap $' + p.minCap + 'B'}</span>
                  <button className="preset-del" onClick={() => deletePreset(i)}>
                    {'\xd7'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {results && marketClosed && (
        <div className="last-session-banner">
          <span className="last-session-icon">🕐</span>
          <span>
            Market closed — showing last session data
            {scanTime &&
              ' · ' + new Date(scanTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}

      {results && (
        <>
          <div className="scanner-brand-mark">
            <span className="scanner-brand-word">CAPITAL FLOW</span>
            <ElectricBorder color="#ffd17d" speed={1.5} chaos={0.01} thickness={2} style={{ borderRadius: 16 }}>
              <img src="/home-logo.jpeg" alt="Capital Flow" className="scanner-brand-logo" />
            </ElectricBorder>
            <span className="scanner-brand-word">CAPITAL FLOW</span>
          </div>
        <div className="table-card">
          <div className="table-bar">
            <div>
              <h2>{sorted.length + ' Result' + (sorted.length !== 1 ? 's' : '')}</h2>
              {scanTime && currentTime && (() => {
                const ageMs = currentTime.getTime() - new Date(scanTime).getTime();
                const ageMins = Math.round(ageMs / 60000);

                // Shared-cache results are normal, expected behavior (see
                // scan.js's 15-min floor-scan cache) — not an error state,
                // so this always says so plainly instead of only warning
                // once the data happens to cross a staleness threshold.
                // Re-scanning inside that window intentionally returns the
                // same snapshot; without this label that looks like the
                // scanner is broken rather than just not-yet-refreshed.
                // A plain page refresh restores whatever was last scanned
                // (see App.jsx's /api/last-results effect) rather than
                // showing a blank screen — without this label that restored
                // data looks like it came from nowhere, since nothing was
                // actually re-run.
                if (restoredFromLastScan) {
                  return (
                    <span className="table-bar-sub table-bar-sub-restored" title="Restored from your last scan — click Run Scan for current results">
                      {'📋 Last scan from ' + new Date(scanTime).toLocaleString() + ' — click Run Scan to refresh'}
                    </span>
                  );
                }

                if (fromCache && !marketClosed) {
                  const remain = Math.max(0, 15 - Math.round((cacheAge || 0) / 60));
                  return (
                    <span className="table-bar-sub table-bar-sub-cached" title="Shared results, refreshed automatically every 15 minutes">
                      {'🔄 Shared scan · next refresh in ~' + (remain <= 0 ? '1' : remain) + 'm'}
                    </span>
                  );
                }

                const isStale = !marketClosed && ageMins >= 5;
                return (
                  <span
                    className="table-bar-sub"
                    style={isStale ? { color: 'var(--accent)', fontWeight: 600 } : undefined}
                    title={isStale ? 'Data may not reflect current market activity' : undefined}
                  >
                    {isStale
                      ? `⚠ Data is ${ageMins} min old`
                      : 'Scanned ' + new Date(scanTime).toLocaleString()}
                  </span>
                );
              })()}
            </div>
            <div className="table-bar-right">
              {sorted.length > 50 && (
                <span className="load-more-count">
                  {'Showing ' + Math.min(visibleCount, sorted.length) + ' of ' + sorted.length}
                </span>
              )}
              {!scanning && (
                <button
                  className="scan-btn table-new-scan-btn"
                  onClick={() => {
                    setResults(null)
                    setScanTime(null)
                  }}
                >
                  New Scan
                </button>
              )}
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="no-match">No stocks matched your filters.</div>
          ) : (
            <>
              {showActionHint && (
                <div className="action-hint-bar">
                  <span className="action-hint-item">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18" />
                      <path d="M18.7 8l-5.1 5.1-4-4L3 15.6" />
                    </svg>
                    Chart
                  </span>
                  <span className="action-hint-item">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    Volume alert
                  </span>
                  <span className="action-hint-item">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 18h.01" />
                      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    Ask Capi
                  </span>
                  <button className="action-hint-close" onClick={dismissActionHint} aria-label="Dismiss">
                    ×
                  </button>
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <TH label="Ticker" field="symbol" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <TH label="Name" field="name" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <TH label="Mkt Cap" field="marketCap" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <TH label="Price" field="price" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <TH label="Change" field="change" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <TH label="RVOL" field="volumeRatio" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <TH label="Sector" field="sector" sortField={sortField} sortDir={sortDir} isPremium={isPremium} onSort={handleSort} onSortReset={handleSortDoubleClick} />
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.slice(0, visibleCount).map((r, i) => (
                      <tr key={r.symbol}>
                        <td className="col-rank">{i + 1}</td>
                        <td className="col-ticker">
                          <div className="ticker-cell">
                            <button
                              className={'star-btn' + (isInWatchlist(r.symbol) ? ' starred' : '')}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleWatchlistTicker(r.symbol)
                              }}
                              title={isInWatchlist(r.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                              aria-label={isInWatchlist(r.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill={isInWatchlist(r.symbol) ? 'var(--accent)' : 'none'}
                                stroke={isInWatchlist(r.symbol) ? 'var(--accent)' : 'var(--text-3)'}
                                strokeWidth="2"
                              >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                            </button>
                            <img
                              className="ticker-logo"
                              src={'https://assets.parqet.com/logos/symbol/' + r.symbol}
                              alt=""
                              width={18}
                              height={18}
                              onError={(e) => {
                                e.target.style.display = 'none'
                              }}
                            />
                            {r.symbol}
                          </div>
                        </td>
                        <td className="col-name" title={r.name}>
                          {r.name}
                        </td>
                        <td style={{ color: 'var(--text-2)', fontSize: 12 }}>
                          {r.marketCap > 0 ? fmt(r.marketCap) : '—'}
                        </td>
                        <td>{'$' + r.price.toFixed(2)}</td>
                        <td className={r.change >= 0 ? 'col-pos' : 'col-neg'}>
                          {(r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%'}
                        </td>
                        <td>
                          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                            {r.rvol && r.rvol > 0 ? (
                              <>
                                <span className="vol-ratio-pill rvol-active">{r.rvol + 'x'}</span>
                                <div className="rvol-label">RVOL</div>
                              </>
                            ) : (
                              <span
                                className={
                                  'vol-hero' +
                                  (r.volumeRatio >= 5 ? ' vol-extreme' : r.volumeRatio >= 3 ? ' vol-high' : r.volumeRatio >= 2 ? ' vol-moderate' : '')
                                }
                              >
                                {r.volumeRatio.toFixed(2) + 'x'}
                              </span>
                            )}
                            <span className="vol-stack-mini" title="Avg / Current volume">
                              {fmt(r.avgVolume) + ' / ' + fmt(r.volume)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="sector-chip">{r.sector}</span>
                        </td>
                        <td style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          <a
                            className="chart-open-btn"
                            href={'https://www.tradingview.com/chart/?symbol=' + r.symbol}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in TradingView"
                            aria-label="Open in TradingView"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 3v18h18" />
                              <path d="M18.7 8l-5.1 5.1-4-4L3 15.6" />
                            </svg>
                          </a>
                          <button
                            className={'alert-create-btn' + (alertLevels && alertLevels[r.symbol] ? ' active' : '')}
                            onClick={() => promptCreateAlert(r.symbol, r.price)}
                            title={
                              alertLevels && alertLevels[r.symbol]
                                ? 'Alert set at ' + alertLevelLabel(alertLevels[r.symbol]) + ' — click to edit'
                                : 'Create an alert'
                            }
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                          </button>
                          <button
                            className="explain-capi-btn"
                            onClick={() => explainWithCapi(r)}
                            title="Ask Capi to explain this result"
                            aria-label={'Ask Capi to explain ' + r.symbol}
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 18h.01" />
                              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
                              <circle cx="12" cy="12" r="10" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sorted.length > visibleCount && (
                <div className="load-more-row">
                  <button className="load-more-btn" onClick={() => setVisibleCount((c) => c + 50)}>
                    {'Load ' + Math.min(50, sorted.length - visibleCount) + ' more'}
                  </button>
                  <span className="load-more-count">{visibleCount + ' of ' + sorted.length + ' results shown'}</span>
                </div>
              )}

              {/* Mobile cards */}
              <div className="mobile-cards">
                {sorted.map((r, i) => {
                  const ratioClass = r.volumeRatio >= 5 ? 'ratio-hot' : r.volumeRatio >= 3.5 ? 'ratio-warm' : 'ratio-ok'
                  return (
                    <div key={r.symbol} className={'mobile-card ' + ratioClass}>
                      <div className="mobile-card-top">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            className={'star-btn' + (isInWatchlist(r.symbol) ? ' starred' : '')}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleWatchlistTicker(r.symbol)
                            }}
                            title={isInWatchlist(r.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                            aria-label={isInWatchlist(r.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill={isInWatchlist(r.symbol) ? 'var(--accent)' : 'none'}
                              stroke={isInWatchlist(r.symbol) ? 'var(--accent)' : 'var(--text-3)'}
                              strokeWidth="2"
                            >
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </button>
                          <img
                            className="ticker-logo"
                            src={'https://assets.parqet.com/logos/symbol/' + r.symbol}
                            alt=""
                            width={18}
                            height={18}
                            onError={(e) => {
                              e.target.style.display = 'none'
                            }}
                          />
                          <span className="mobile-card-ticker">{r.symbol}</span>
                          <span className="mobile-card-name">{r.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <a
                            className="chart-open-btn"
                            href={'https://www.tradingview.com/chart/?symbol=' + r.symbol}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open in TradingView" aria-label="Open in TradingView"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 3v18h18" />
                              <path d="M18.7 8l-5.1 5.1-4-4L3 15.6" />
                            </svg>
                          </a>
                          <button
                            className={'alert-create-btn' + (alertLevels && alertLevels[r.symbol] ? ' active' : '')}
                            onClick={(e) => {
                              e.stopPropagation()
                              promptCreateAlert(r.symbol, r.price)
                            }}
                            title={
                              alertLevels && alertLevels[r.symbol]
                                ? 'Alert set at ' + alertLevelLabel(alertLevels[r.symbol]) + ' — click to edit'
                                : 'Create an alert'
                            }
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                          </button>
                          <button
                            className="explain-capi-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              explainWithCapi(r)
                            }}
                            title="Ask Capi to explain this result"
                            aria-label={'Ask Capi to explain ' + r.symbol}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 18h.01" />
                              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
                              <circle cx="12" cy="12" r="10" />
                            </svg>
                          </button>
                          <span className="mobile-card-rank">{'#' + (i + 1)}</span>
                        </div>
                      </div>
                      <div className="mobile-card-mid">
                        <span className="mobile-card-price">{'$' + r.price.toFixed(2)}</span>
                        <span className={'mobile-card-change ' + (r.change >= 0 ? 'pos' : 'neg')}>
                          {(r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%'}
                        </span>
                      </div>
                      <div className="mobile-card-bottom">
                        <div className="mobile-card-stat">
                          <span className="mobile-card-stat-label">RVOL</span>
                          <span className={'ratio-pill ' + (r.volumeRatio >= 5 ? 'hot' : r.volumeRatio >= 3.5 ? 'warm' : 'ok')}>
                            {r.volumeRatio + 'x'}
                          </span>
                        </div>
                        <div className="mobile-card-stat">
                          <span className="mobile-card-stat-label">Avg / Vol</span>
                          <span className="mobile-card-stat-value">{fmt(r.avgVolume) + ' / ' + fmt(r.volume)}</span>
                        </div>
                        {r.marketCap > 0 && (
                          <div className="mobile-card-stat">
                            <span className="mobile-card-stat-label">Cap</span>
                            <span className="mobile-card-stat-value">{fmt(r.marketCap)}</span>
                          </div>
                        )}
                        <span className="mobile-card-sector">
                          <span className="sector-chip">{r.sector}</span>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
        </>
      )}

      {showSectorModal && (
        <SectorPickerModal
          allSectors={ALL_SECTORS}
          selectedSectors={selectedSectors}
          toggleSector={toggleSector}
          setSelectedSectors={setSelectedSectors}
          onDone={() => setShowSectorModal(false)}
          isElite={isElite}
          isPremium={isPremium}
          maxFreeSectors={maxFreeSectors}
          maxPremiumSectors={maxPremiumSectors}
          sectorLimit={sectorLimit}
        />
      )}
    </div>
  )
}
