import React from 'react'
import useModalA11y from '../../hooks/useModalA11y'
import { SECTOR_ICONS } from '../../constants/sectorIcons'

// "By Sector" used to expand an inline grid on the main scan screen. Moved
// into its own modal so picking sectors is a deliberate, focused step —
// each card enters with its own staggered reveal, then Done drops the
// customer straight back onto the main screen with Run Scan ready to go.
export default function SectorPickerModal({
  allSectors,
  selectedSectors,
  toggleSector,
  setSelectedSectors,
  onDone,
  isElite,
  isPremium,
  maxFreeSectors,
  maxPremiumSectors,
  sectorLimit,
}) {
  const panelRef = useModalA11y(onDone)

  return (
    <div className="upgrade-overlay sector-modal-overlay" onClick={onDone}>
      <div
        className="upgrade-modal sector-modal-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Select sectors"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sector-modal-header">
          <h2 className="upgrade-title">Select Sectors</h2>
          {selectedSectors.length > 0 && (
            <button className="sector-clear" onClick={() => setSelectedSectors([])}>
              Clear all
            </button>
          )}
        </div>

        <div className="sector-modal-grid">
          {allSectors.map((s, i) => {
            const active = selectedSectors.indexOf(s) >= 0
            return (
              <button
                key={s}
                className={'sector-card' + (active ? ' active' : '')}
                style={{ '--sector-card-delay': i * 0.03 + 's' }}
                onClick={() => toggleSector(s)}
              >
                <div className="sector-card-glow" />
                <div className="sector-card-icon">{SECTOR_ICONS[s] || null}</div>
                <div className="sector-card-name">{s}</div>
                <div className="sector-card-count">Scans top 5 holdings</div>
                {active && <div className="sector-card-check">✓</div>}
              </button>
            )
          })}
        </div>

        {selectedSectors.length === 0 && (
          <div className="sector-hint">No sectors selected — will scan top 5 from all sectors</div>
        )}
        {!isElite && (
          <div className="sector-hint">
            {isPremium
              ? 'Premium: up to ' + maxPremiumSectors + ' sectors. Upgrade to Elite for unlimited.'
              : 'Free tier: up to ' + maxFreeSectors + ' sectors. Upgrade for more.'}
          </div>
        )}
        {!isElite && selectedSectors.length >= sectorLimit() && (
          <div className="sector-limit-badge">{selectedSectors.length + '/' + sectorLimit() + ' sectors selected'}</div>
        )}

        <div className="sector-modal-footer">
          <button className="upgrade-cta sector-modal-done" onClick={onDone}>
            {selectedSectors.length > 0
              ? 'Done — ' + selectedSectors.length + ' sector' + (selectedSectors.length === 1 ? '' : 's') + ' selected'
              : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
