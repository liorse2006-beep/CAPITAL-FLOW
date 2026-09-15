import React from 'react';
import { WhopCheckoutEmbed } from '@whop/checkout/react';

// Renders Whop's real payment form inline, in an iframe scoped to just the
// checkout fields — never a full-page redirect or a new tab/window. Whop's
// own embed terms require the processor to stay visibly attributed even
// when it's this invisible, so "Powered by Whop" stays on screen; everything
// else (the page around it, the theme, what happens on completion) is ours.
export default function EmbeddedCheckout({ sessionId, onComplete, onError }) {
  // External wallet flows can leave the page for authorization (for example,
  // 3-D Secure or a native wallet sheet). Keep the return target on the same
  // origin so App.jsx can consume ?status=success|error and finish the normal
  // webhook/tier refresh flow after the customer comes back.
  const returnUrl = typeof window === 'undefined' ? '/' : `${window.location.origin}/`;

  return (
    <div className="embedded-checkout">
      <WhopCheckoutEmbed
        sessionId={sessionId}
        returnUrl={returnUrl}
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
