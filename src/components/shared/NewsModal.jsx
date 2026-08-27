import React, { useEffect, useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import useIsMobile from '../../hooks/useIsMobile';

function formatDate(timestamp) {
  if (!timestamp) return 'Recent';
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return 'Recent';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Sentiment({ value }) {
  if (!value) return null;
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return <span className={'news-sentiment news-sentiment-' + value}>{label}</span>;
}

export default function NewsModal({ symbol, getToken, onClose }) {
  const isMobile = useIsMobile();
  const panelRef = useModalA11y(onClose);
  const [articles, setArticles] = useState([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isMobile) return undefined;
    let cancelled = false;
    fetch('/api/news/' + encodeURIComponent(symbol), {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
      .then((response) =>
        response.ok
          ? response.json()
          : response.json().then((data) => {
              throw new Error(data.error || 'News could not be loaded');
            })
      )
      .then((data) => {
        if (cancelled) return;
        setArticles(Array.isArray(data.articles) ? data.articles : []);
        setSource(data.source || 'verified sources');
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message || 'News could not be loaded');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, getToken, isMobile]);

  if (isMobile) return null;

  return (
    <div className="news-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="news-modal" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true">
        <button className="news-modal-close" onClick={onClose} aria-label="Close news">
          ×
        </button>
        <div className="news-modal-kicker">
          <span className="news-modal-kicker-mark">N</span>
          Market context
        </div>
        <div className="news-modal-header">
          <div>
            <h2>
              {symbol} <span>news</span>
            </h2>
            <p>Recent verified headlines with grounded AI context.</p>
          </div>
          {!loading && !error && <span className="news-modal-source">Source: {source}</span>}
        </div>

        {loading && (
          <div className="news-loading" role="status" aria-live="polite">
            <span className="news-loading-spinner" />
            Pulling recent headlines…
          </div>
        )}

        {!loading && error && <div className="news-empty news-empty-error">{error}</div>}

        {!loading && !error && articles.length === 0 && (
          <div className="news-empty">
            <strong>No verified headlines found.</strong>
            <span>Try again later or check another ticker.</span>
          </div>
        )}

        {!loading && !error && articles.length > 0 && (
          <div className="news-list">
            {articles.map((article, index) => (
              <article className="news-article" key={article.url || article.headline || index}>
                <div className="news-article-meta">
                  <span>{article.source || 'Verified source'}</span>
                  <span>·</span>
                  <time>{formatDate(article.datetime)}</time>
                  <Sentiment value={article.sentiment} />
                </div>
                <h3>
                  <a href={article.url} target="_blank" rel="noopener noreferrer">
                    {article.headline}
                  </a>
                </h3>
                {article.summary && <p className="news-article-summary">{article.summary}</p>}
                {article.impact && (
                  <div className="news-article-impact">
                    <span>Context</span>
                    {article.impact}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <p className="news-modal-disclaimer">
          News and AI context are informational only and are not investment advice.
        </p>
      </div>
    </div>
  );
}
