import React from 'react';

const STATUS_LABELS = {
  complete: 'Complete',
  partial: 'Partial',
  unavailable: 'Unavailable',
  stale: 'Stale',
  ready: 'Ready',
  waiting: 'Waiting',
  in_progress: 'In progress',
  unknown: 'Unknown',
};

function formatUtc(value) {
  if (!value) return 'Unavailable from provider';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable from provider';
  return (
    date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }) + ' UTC'
  );
}

function statusLabel(value) {
  return STATUS_LABELS[String(value || 'unknown').toLowerCase()] || 'Unknown';
}

/**
 * A deliberately collapsed provenance disclosure. It keeps scanner screens
 * compact while making source, timestamp, freshness, and limitations
 * available at the point where a financial result is consumed.
 */
export default function FinancialDataProvenance({
  provenance,
  dataStatus,
  dataAsOf,
  capturedAt,
  fallbackSources = [],
}) {
  const sourceRows =
    Array.isArray(provenance?.sources) && provenance.sources.length
      ? provenance.sources
      : fallbackSources.map((provider) => ({
          provider,
          role: 'financial data',
          fields: [],
          asOf: dataAsOf,
          status: dataStatus,
        }));
  const providers = [...new Set(sourceRows.map((source) => source.provider).filter(Boolean))];
  const effectiveStatus = provenance?.status || dataStatus || 'unknown';
  const effectiveAsOf = provenance?.asOf || dataAsOf || null;
  const effectiveCapturedAt = provenance?.capturedAt || capturedAt || null;

  if (!effectiveAsOf && !effectiveCapturedAt && sourceRows.length === 0) return null;

  return (
    <details className="financial-provenance">
      <summary>
        <span>Data provenance</span>
        <span className="financial-provenance-status">{statusLabel(effectiveStatus)}</span>
      </summary>
      <div className="financial-provenance-body">
        <div className="financial-provenance-row">
          <span>Sources</span>
          <strong>{providers.length ? providers.join(' · ') : 'Unknown provider'}</strong>
        </div>
        <div className="financial-provenance-row">
          <span>Source data as of</span>
          <strong>{formatUtc(effectiveAsOf)}</strong>
        </div>
        <div className="financial-provenance-row">
          <span>Response captured</span>
          <strong>{formatUtc(effectiveCapturedAt)}</strong>
        </div>
        {sourceRows.length > 0 && (
          <ul className="financial-provenance-sources">
            {sourceRows.map((source, index) => (
              <li key={`${source.provider || 'provider'}-${source.role || 'data'}-${index}`}>
                <span>
                  {source.provider || 'Unknown provider'} · {source.role || 'financial data'}
                </span>
                <span>{source.timestampAvailable === false ? 'Timestamp unavailable' : formatUtc(source.asOf)}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          Timestamps are UTC. A complete result means the required fields passed validation; it does not guarantee live
          execution or data accuracy beyond the disclosed source timestamp.
        </p>
      </div>
    </details>
  );
}
