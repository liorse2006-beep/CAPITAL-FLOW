import React from 'react';
import { Link } from 'react-router-dom';

const FEATURES = [
  {
    title: 'Capital Flow Scanner',
    desc: 'Scan the S&P 500, NASDAQ 100, or any sector for unusual volume spikes the moment they happen.',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: 'Sector Money Flow',
    desc: 'See which sectors are attracting capital right now — spot rotation before it shows up in the headlines.',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M2 12h20" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    title: 'MA Scanner',
    desc: 'Find tickers crossing key moving averages — golden crosses, breakouts, and trend reversals, automatically.',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M14 7h7v7" />
      </svg>
    ),
  },
  {
    title: 'Watchlist & Alerts',
    desc: 'Track your favorite tickers and get notified the instant volume crosses your threshold.',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
];

const STEPS = [
  { n: '01', title: 'Pick a universe', desc: 'Full market, S&P 500, NASDAQ 100, or hand-pick sectors.' },
  { n: '02', title: 'Run a scan', desc: 'See every ticker with unusual volume, ranked and ready in seconds.' },
  { n: '03', title: 'Track & get alerted', desc: 'Star what matters, set a threshold, and let the app watch it for you.' },
];

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: '$0',
    desc: 'Try every tool once, no card required.',
    features: ['1 trial scan per tool', 'Full results table', 'Basic filters'],
    cta: 'Start Free',
  },
  {
    key: 'premium',
    name: 'Premium',
    price: '$14.90',
    sub: 'one-time',
    desc: 'For active traders who scan daily.',
    features: ['5 scans / 24h', 'Advanced filters & presets', 'Float & short interest data', 'Ticker notes & charts'],
    cta: 'Get Premium',
    highlight: true,
  },
  {
    key: 'elite',
    name: 'Elite',
    price: '$29.90',
    sub: 'one-time',
    desc: 'For traders who never want to miss a move.',
    features: ['Unlimited scans', 'Everything in Premium', 'Push notifications', 'Daily scheduled scan', 'Custom watchlist alerts'],
    cta: 'Get Elite',
  },
];

export default function LandingPage({ onGetStarted }) {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-nav-logo">
          <div className="logo-mark">
            <div className="logo-bar" />
            <div className="logo-bar" />
            <div className="logo-bar" />
          </div>
          <span className="landing-nav-name">
            <strong>Capital</strong> Flow
          </span>
        </div>
        <button className="landing-nav-signin" onClick={onGetStarted}>
          Sign In
        </button>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-badge">Real-time market scanning</div>
        <h1 className="landing-hero-title">
          Find the stocks <span className="landing-accent">moving right now</span>
        </h1>
        <p className="landing-hero-sub">
          Capital Flow scans the S&amp;P 500, NASDAQ 100, and every sector for unusual volume — so you catch the move
          while it&apos;s happening, not after.
        </p>
        <div className="landing-hero-actions">
          <button className="landing-cta-primary" onClick={onGetStarted}>
            Get Started Free
          </button>
          <Link className="landing-cta-secondary" to="/scanner">
            Explore the scanner →
          </Link>
        </div>
      </section>

      <section className="landing-section">
        <h2 className="landing-section-title">Everything you need to catch the move</h2>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-feature-card">
              <div className="landing-feature-icon">{f.icon}</div>
              <h3 className="landing-feature-title">{f.title}</h3>
              <p className="landing-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-steps-section">
        <h2 className="landing-section-title">How it works</h2>
        <div className="landing-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="landing-step">
              <div className="landing-step-num">{s.n}</div>
              <h3 className="landing-step-title">{s.title}</h3>
              <p className="landing-step-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="pricing">
        <h2 className="landing-section-title">Pick a plan</h2>
        <p className="landing-section-sub">One-time payment. No subscriptions, no recurring charges.</p>
        <div className="landing-pricing-grid">
          {PLANS.map((p) => (
            <div key={p.key} className={'landing-plan-card' + (p.highlight ? ' highlight' : '')}>
              {p.highlight && <div className="landing-plan-badge">Most Popular</div>}
              <h3 className="landing-plan-name">{p.name}</h3>
              <div className="landing-plan-price">
                {p.price}
                {p.sub && <span className="landing-plan-price-sub">{' ' + p.sub}</span>}
              </div>
              <p className="landing-plan-desc">{p.desc}</p>
              <ul className="landing-plan-features">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button className={'landing-plan-cta' + (p.highlight ? ' highlight' : '')} onClick={onGetStarted}>
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-final-cta">
        <h2 className="landing-section-title">Stop missing the move</h2>
        <p className="landing-section-sub">Start with a free scan — no credit card required.</p>
        <button className="landing-cta-primary" onClick={onGetStarted}>
          Get Started Free
        </button>
      </section>

      <footer className="landing-footer">
        <span>&copy; {new Date().getFullYear()} Capital Flow</span>
        <Link to="/policy">Terms &amp; Privacy</Link>
      </footer>
    </div>
  );
}
