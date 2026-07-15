import { useState } from 'react';
import { hasAnswered, giveConsent, revokeConsent } from '../../analytics';

const styles = `
@keyframes cc-enter {
  from { opacity: 0; transform: translateY(14px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.cc-card {
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 9999;
  max-width: 380px;
  width: calc(100vw - 48px);
  background: #161616;
  border: 1px solid rgba(255,255,255,0.09);
  border-left: 3px solid var(--accent, #f59e0b);
  border-radius: 10px;
  padding: 20px 22px 18px;
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.5),
    0 16px 48px rgba(0,0,0,0.7),
    0 4px 12px rgba(0,0,0,0.5);
  animation: cc-enter .32s cubic-bezier(.16,1,.3,1) both;
}
.cc-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.cc-dot {
  width: 5px;
  height: 5px;
  background: var(--accent, #f59e0b);
  border-radius: 50%;
  flex-shrink: 0;
}
.cc-title {
  font-size: 13px;
  font-weight: 700;
  color: #e4e4e7;
  letter-spacing: -0.15px;
}
.cc-body {
  font-size: 12px;
  color: #71717a;
  line-height: 1.6;
  margin-bottom: 16px;
}
.cc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cc-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cc-decline {
  background: none;
  border: none;
  font-size: 12px;
  color: #52525b;
  cursor: pointer;
  padding: 0;
  transition: color .15s;
  font-family: inherit;
}
.cc-decline:hover { color: #a0a0a8; }
.cc-policy {
  font-size: 11px;
  color: #3f3f46;
  text-decoration: none;
  border-bottom: 1px solid #3f3f46;
  padding-bottom: 1px;
  transition: color .15s, border-color .15s;
}
.cc-policy:hover { color: #71717a; border-color: #71717a; }
.cc-accept {
  background: var(--accent, #f59e0b);
  color: #0a0a0a;
  border: none;
  border-radius: 6px;
  padding: 8px 22px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: -0.1px;
  font-family: inherit;
  transition: background .15s, box-shadow .15s;
  box-shadow: 0 2px 8px rgba(245,158,11,0.25);
}
.cc-accept:hover {
  filter: brightness(1.1);
  box-shadow: 0 4px 16px rgba(245,158,11,0.35);
}
`;

export default function CookieConsent() {
  const [visible, setVisible] = useState(() => !hasAnswered());

  if (!visible) return null;

  function handleAccept() {
    giveConsent();
    setVisible(false);
  }

  function handleDecline() {
    revokeConsent();
    setVisible(false);
  }

  return (
    <>
      <style>{styles}</style>
      <div role="dialog" aria-label="Cookie Preferences" className="cc-card">
        <div className="cc-top">
          <div className="cc-dot" />
          <span className="cc-title">Cookie Preferences</span>
        </div>
        <p className="cc-body">
          We use cookies to deliver and improve our service. No personal data is sold or shared with third parties.
        </p>
        <div className="cc-footer">
          <div className="cc-left">
            <button className="cc-decline" onClick={handleDecline}>Decline</button>
            <a className="cc-policy" href="/policy?tab=privacy">Privacy Policy</a>
          </div>
          <button className="cc-accept" onClick={handleAccept}>Accept All</button>
        </div>
      </div>
    </>
  );
}
