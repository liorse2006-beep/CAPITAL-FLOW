import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import useModalA11y from '../../hooks/useModalA11y';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'; // test key

function OTPInput({ length = 6, value, onChange }) {
  const inputs = useRef([]);

  function handleKey(i, e) {
    if (e.key === 'Backspace' && !e.target.value && i > 0) {
      inputs.current[i - 1].focus();
    }
  }

  function handleChange(i, e) {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    const chars = value.split('');
    chars[i] = digit;
    const next = chars.join('');
    onChange(next);
    if (digit && i < length - 1) {
      inputs.current[i + 1].focus();
    }
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted) {
      onChange(pasted.padEnd(length, '').slice(0, length));
      const focusIdx = Math.min(pasted.length, length - 1);
      inputs.current[focusIdx].focus();
    }
    e.preventDefault();
  }

  return (
    <div className="otp-input-row">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          className="otp-digit"
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  );
}

function Turnstile({ onVerify, onExpire }) {
  const containerRef = useRef(null);
  const widgetId = useRef(null);

  const render = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetId.current != null) return;
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => onVerify(token),
      'expired-callback': () => { onExpire(); widgetId.current = null; },
      theme: 'dark',
    });
  }, [onVerify, onExpire]);

  useEffect(() => {
    if (window.turnstile) {
      render();
      return;
    }
    if (document.getElementById('cf-turnstile-script')) {
      const interval = setInterval(() => {
        if (window.turnstile) { clearInterval(interval); render(); }
      }, 100);
      return () => clearInterval(interval);
    }
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [render]);

  useEffect(() => {
    return () => {
      if (widgetId.current != null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} />;
}

function decodeJwtEmail(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.email || '';
  } catch {
    return '';
  }
}

export default function AuthModal({ onClose }) {
  const { login, pendingGoogleToken, confirmGoogleLogin, cancelGoogleLogin } = useAuth();
  const [screen, setScreen] = useState(pendingGoogleToken ? 'google_confirm' : 'login'); // login | signup | otp | forgot | reset | google_confirm
  const [pendingEmail, setPendingEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const panelRef = useModalA11y(onClose);

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');

  function startResendCooldown() {
    setResendCooldown(60);
    const t = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) {
          clearInterval(t);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function handleErr(msg) {
    setError(msg);
    setLoading(false);
  }

  async function api(path, body) {
    const res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const inviteCode = localStorage.getItem('vs_pilot_invite') || undefined;
      await api('signup', { email, password, captchaToken, inviteCode });
      if (inviteCode) localStorage.removeItem('vs_pilot_invite');
      setPendingEmail(email);
      setOtp('');
      setScreen('otp');
      startResendCooldown();
    } catch (err) {
      handleErr(err.message);
      setCaptchaToken('');
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await api('login', { email, password });
      login(data.token, data.user);
      onClose();
    } catch (err) {
      if (err.message.includes('not verified')) {
        setPendingEmail(email);
        setScreen('otp');
        startResendCooldown();
      } else {
        handleErr(err.message);
      }
    }
  }

  async function handleVerifyOTP(e) {
    e.preventDefault();
    if (otp.length < 6) return handleErr('Enter the full 6-digit code');
    setLoading(true);
    setError('');
    try {
      const path = screen === 'reset' ? 'reset-password' : 'verify-otp';
      const body =
        screen === 'reset' ? { email: pendingEmail, code: otp, newPassword } : { email: pendingEmail, code: otp };
      const data = await api(path, body);
      login(data.token, data.user);
      onClose();
    } catch (err) {
      handleErr(err.message);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('forgot-password', { email });
      setPendingEmail(email);
      setOtp('');
      setScreen('reset');
      startResendCooldown();
    } catch (err) {
      handleErr(err.message);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setError('');
    try {
      const type = screen === 'reset' ? 'reset_password' : 'verify_email';
      await api('resend-otp', { email: pendingEmail, type });
      startResendCooldown();
    } catch (err) {
      setError(err.message);
    }
  }

  function goToGoogle() {
    setScreen('google_consent');
  }

  function confirmGoogle() {
    sessionStorage.setItem('google_auth_pending', '1');
    window.location.href = '/api/auth/google';
  }

  function switchScreen(s) {
    setScreen(s);
    setError('');
    setPassword('');
    setOtp('');
    setCaptchaToken('');
  }

  return (
    <div
      className="auth-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="auth-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Sign in">
        {/* Close */}
        <button className="auth-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Logo */}
        <div className="auth-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          CAPITAL FLOW
        </div>

        {/* ── Sign Up / Log In ── */}
        {(screen === 'login' || screen === 'signup') && (
          <>
            <div className="auth-tabs">
              <button
                className={`auth-tab ${screen === 'login' ? 'active' : ''}`}
                onClick={() => switchScreen('login')}
              >
                Log In
              </button>
              <button
                className={`auth-tab ${screen === 'signup' ? 'active' : ''}`}
                onClick={() => switchScreen('signup')}
              >
                Sign Up
              </button>
            </div>

            <button className="auth-google-btn" onClick={confirmGoogle}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <form onSubmit={screen === 'signup' ? handleSignUp : handleLogin}>
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="auth-field">
                <label className="auth-label">Password</label>
                <input
                  className="auth-input"
                  type="password"
                  placeholder={screen === 'signup' ? 'Min 8 characters' : 'Your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={screen === 'signup' ? 'new-password' : 'current-password'}
                />
              </div>

              {screen === 'signup' && (
                <div className="auth-captcha-wrap">
                  <Turnstile
                    onVerify={(token) => setCaptchaToken(token)}
                    onExpire={() => setCaptchaToken('')}
                  />
                </div>
              )}

              {error && <div className="auth-error">{error}</div>}

              <button className="auth-submit-btn" type="submit" disabled={loading}>
                {loading ? 'Please wait…' : screen === 'signup' ? 'Create Account' : 'Log In'}
              </button>

              {screen === 'login' && (
                <button type="button" className="auth-link-btn" onClick={() => switchScreen('forgot')}>
                  Forgot password?
                </button>
              )}
            </form>
          </>
        )}

        {/* ── OTP Verify ── */}
        {screen === 'otp' && (
          <form onSubmit={handleVerifyOTP}>
            <div className="auth-otp-header">
              <div className="auth-otp-icon">✉️</div>
              <h2 className="auth-otp-title">Check your email</h2>
              <p className="auth-otp-sub">
                We sent a 6-digit code to
                <br />
                <strong>{pendingEmail}</strong>
              </p>
            </div>
            <OTPInput length={6} value={otp} onChange={setOtp} />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit-btn" type="submit" disabled={loading || otp.length < 6}>
              {loading ? 'Verifying…' : 'Verify →'}
            </button>
            <button type="button" className="auth-link-btn" onClick={handleResend} disabled={resendCooldown > 0}>
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </form>
        )}

        {/* ── Forgot Password ── */}
        {screen === 'forgot' && (
          <form onSubmit={handleForgot}>
            <h2 className="auth-otp-title">Reset password</h2>
            <p className="auth-otp-sub">Enter your email and we&apos;ll send a reset code.</p>
            <div className="auth-field">
              <label className="auth-label">Email</label>
              <input
                className="auth-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit-btn" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send Reset Code'}
            </button>
            <button type="button" className="auth-link-btn" onClick={() => switchScreen('login')}>
              ← Back to Log In
            </button>
          </form>
        )}

        {/* ── Google Confirm (shown after Google account selection) ── */}
        {screen === 'google_confirm' && pendingGoogleToken && (
          <div className="auth-google-consent">
            <div className="auth-google-consent-logo">
              <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            </div>
            <h2 className="auth-otp-title" style={{ marginTop: 12 }}>
              Continue as
            </h2>
            <p className="auth-otp-sub" style={{ marginBottom: 8 }}>
              <strong style={{ color: 'var(--text-1)' }}>{decodeJwtEmail(pendingGoogleToken)}</strong>
            </p>
            <div className="auth-consent-permissions">
              <div className="auth-consent-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span>Your name and profile picture</span>
              </div>
              <div className="auth-consent-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>Your email address</span>
              </div>
            </div>
            <p className="auth-consent-note">
              We will not share your data with third parties or post anything on your behalf.
            </p>
            <div className="auth-consent-actions">
              <button
                className="auth-consent-cancel"
                onClick={() => {
                  cancelGoogleLogin();
                  onClose();
                }}
              >
                Cancel
              </button>
              <button
                className="auth-consent-allow"
                disabled={googleLoading}
                onClick={async () => {
                  setGoogleLoading(true);
                  await confirmGoogleLogin();
                  onClose();
                }}
              >
                {googleLoading ? 'Signing in…' : 'Allow'}
                {!googleLoading && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Reset Password (OTP + new password) ── */}
        {screen === 'reset' && (
          <form onSubmit={handleVerifyOTP}>
            <div className="auth-otp-header">
              <div className="auth-otp-icon">🔑</div>
              <h2 className="auth-otp-title">Enter reset code</h2>
              <p className="auth-otp-sub">
                Code sent to <strong>{pendingEmail}</strong>
              </p>
            </div>
            <OTPInput length={6} value={otp} onChange={setOtp} />
            <div className="auth-field" style={{ marginTop: 16 }}>
              <label className="auth-label">New password</label>
              <input
                className="auth-input"
                type="password"
                placeholder="Min 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-submit-btn" type="submit" disabled={loading || otp.length < 6 || !newPassword}>
              {loading ? 'Resetting…' : 'Set New Password'}
            </button>
            <button type="button" className="auth-link-btn" onClick={handleResend} disabled={resendCooldown > 0}>
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
