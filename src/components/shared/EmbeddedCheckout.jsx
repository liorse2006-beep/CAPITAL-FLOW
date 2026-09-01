import React, { useState } from 'react';
import { WhopCheckoutEmbed, WhopExpressCheckoutButton } from '@whop/checkout/react';

// Renders Whop's real payment form inline, in an iframe scoped to just the
// checkout fields — never a full-page redirect or a new tab/window. Whop's
// own embed terms require the processor to stay visibly attributed even
// when it's this invisible, so "Powered by Whop" stays on screen; everything
// else (the page around it, the theme, what happens on completion) is ours.
export default function EmbeddedCheckout({ sessionId, promoCode, onComplete, onError, onPromoCodeChanged }) {
  // External wallet flows can leave the page for authorization (for example,
  // 3-D Secure or a native wallet sheet). Keep the return target on the same
  // origin so App.jsx can consume ?status=success|error and finish the normal
  // webhook/tier refresh flow after the customer comes back.
  const returnUrl = typeof window === 'undefined' ? '/' : `${window.location.origin}/`;
  const [expressMethod, setExpressMethod] = useState(null);
  const expressAvailable = expressMethod && expressMethod !== 'none';

  return (
    <div className="embedded-checkout">
      <div className={'embedded-express' + (expressMethod === 'none' ? ' embedded-express-hidden' : '')}>
        <WhopExpressCheckoutButton
          checkoutConfigurationId={sessionId}
          methods={['apple-pay', 'google-pay', 'whop-pay']}
          returnUrl={returnUrl}
          promoCode={promoCode || undefined}
          theme="dark"
          themeOptions={{ accentColor: '#f59e0b' }}
          onExpressMethodResolved={(info) => setExpressMethod((info && info.rendered) || 'none')}
          onComplete={onComplete}
          onPaymentError={onError}
          fallback={<div className="embedded-express-loading">Checking wallet options…</div>}
        />
        {expressAvailable && <div className="embedded-express-divider">or pay with card</div>}
      </div>
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
        onPromoCodeChanged={onPromoCodeChanged}
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
