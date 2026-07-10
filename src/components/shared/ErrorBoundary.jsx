import React from 'react';
import { Sentry, enabled as sentryEnabled } from '../../sentry';

// Catches render-time crashes anywhere below it in the tree and shows a
// recoverable screen instead of a blank white page. Class component is
// required here — React has no hook equivalent for componentDidCatch.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (sentryEnabled) {
      Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    } else {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0A0A0A',
          color: '#E4E4E7',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div className="logo-mark" style={{ transform: 'scale(1.4)' }}>
          <div className="logo-bar" />
          <div className="logo-bar" />
          <div className="logo-bar" />
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
        <p style={{ fontSize: 13, color: '#A0A0A8', maxWidth: 360, margin: 0 }}>
          This screen hit an unexpected error. Reloading usually fixes it — your data is safe.
        </p>
        <button
          className="upgrade-cta"
          style={{ width: 'auto', padding: '10px 24px' }}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
