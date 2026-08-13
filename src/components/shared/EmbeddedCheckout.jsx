import React, { useState } from 'react';
import { WhopCheckoutEmbed, WhopExpressCheckoutButton } from '@whop/checkout/react';

// Renders Whop's real payment form inline, in an iframe scoped to just the
// checkout fields — never a full-page redirect or a new tab/window. Whop's
// own embed terms require the processor to stay visibly attributed even
// when it's this invisible, so "Powered by Whop" stays on screen; everything
// else (the page around it, the theme, what happens on completion) is ours.
//
// Above the card form we also mount Whop's WhopExpressCheckoutButton, which
// detects the browser and offers a native one-tap wallet: Apple Pay in
// Safari/iOS, Google Pay in Chrome/Android, Whop Pay elsewhere. It renders
// nothing (onExpressMethodResolved → 'none') on a browser with no wallet
// available, so the card form below is always the reliable fallback and this
// never shows an empty/broken row. Uses planId (passed through from the
// checkout session the server already created) since the express button
// takes a plan, not a session id.
export default function EmbeddedCheckout({ sessionId, planId, promoCode, onComplete, onError }) {
  const [expressMethod, setExpressMethod] = useState(null); // 'apple-pay' | 'google-pay' | 'whop-pay' | 'none' | null
  // External wallet flows can leave the page for authorization (for example,
  // 3-D Secure or a native wallet sheet). Keep the return target on the same
  // origin so App.jsx can consume ?status=success|error and finish the normal
  // webhook/tier refresh flow after the customer comes back.
  const returnUrl = typeof window === 'undefined' ? '/' : `${window.location.origin}/`;

  const showExpress = planId && expressMethod && expressMethod !== 'none';

  return (
    <div className="embedded-checkout">
      {planId && (
        <div className={'embedded-express' + (showExpress ? '' : ' embedded-express-hidden')}>
          <WhopExpressCheckoutButton
            planId={planId}
            returnUrl={returnUrl}
            promoCode={promoCode || undefined}
            theme="dark"
            themeOptions={{ accentColor: '#f59e0b' }}
            onExpressMethodResolved={(r) => setExpressMethod((r && r.rendered) || 'none')}
            onComplete={onComplete}
            onPaymentError={onError}
            fallback={<div className="embedded-express-loading">Checking wallet options…</div>}
          />
          {showExpress && <div className="embedded-express-divider">or pay with card</div>}
        </div>
      )}

      <WhopCheckoutEmbed
        sessionId={sessionId}
        returnUrl={returnUrl}
        promoCode={promoCode || undefined}
        theme="dark"
        skipRedirect
        themeOptions={{
          accentColor: '#f59e0b',
          backgroundColor: '#141414',
          borderRadius: 8,
        }}
        onComplete={onComplete}
        onPaymentError={onError}
        fallback={
          <div className="embedded-checkout-loading">
            <div className="spinner" />
            Loading secure checkout…
          </div>
        }
      />
      <div className="embedded-checkout-powered-by">
        Powered by <span className="embedded-checkout-whop-mark">Whop</span>
      </div>
    </div>
  );
}
