import React from 'react'
import { WhopCheckoutEmbed } from '@whop/checkout/react'

// Renders Whop's real payment form inline, in an iframe scoped to just the
// checkout fields — never a full-page redirect or a new tab/window. Whop's
// own embed terms require the processor to stay visibly attributed even
// when it's this invisible, so "Powered by Whop" stays on screen; everything
// else (the page around it, the theme, what happens on completion) is ours.
export default function EmbeddedCheckout({ sessionId, onComplete, onError }) {
  return (
    <div className="embedded-checkout">
      <WhopCheckoutEmbed
        sessionId={sessionId}
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
  )
}
