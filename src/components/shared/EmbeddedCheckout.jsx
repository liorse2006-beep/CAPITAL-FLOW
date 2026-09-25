import React, { useState } from 'react';
import { loadWhop } from '@whop/elements';
import { WhopElements, Checkout, CheckoutElement } from '@whop/elements-react';

const APPEARANCE = { theme: { appearance: 'dark', accentColor: 'amber', grayColor: 'slate' } };

// Whop Elements owns checkout-session creation and keeps the session
// credential inside its hosted element. The signed metadata comes from our
// server and is independently verified by our payment webhook before any
// account entitlement changes.
export default function EmbeddedCheckout({ planId, metadata, promoCode, buyerEmail, onComplete, onError }) {
  const [elements] = useState(() => loadWhop());
  const [loadFailure, setLoadFailure] = useState(false);
  const [retryLoad, setRetryLoad] = useState(null);
  const [paymentReceived, setPaymentReceived] = useState(false);
  const returnUrl =
    typeof window === 'undefined'
      ? undefined
      : (() => {
          const url = new URL(window.location.pathname, window.location.origin);
          url.searchParams.set('status', 'success');
          return url.toString();
        })();

  function handleLoadError(_error, retry) {
    setRetryLoad(() => retry);
    setLoadFailure(true);
  }

  function handleComplete(result) {
    if (result?.result !== 'payment') {
      onError?.(new Error('Payment was not completed.'));
      return;
    }
    setPaymentReceived(true);
    onComplete?.(result);
  }

  function handleElementError() {
    // Do not surface provider internals or raw errors in the customer UI.
    onError?.(new Error('Secure checkout is temporarily unavailable.'));
  }

  return (
    <div className="embedded-checkout">
      <WhopElements
        elements={elements}
        locale="en"
        appearance={APPEARANCE}
        onLoadError={handleLoadError}
      >
        <Checkout
          plan={planId}
          metadata={metadata}
          promoCode={promoCode || undefined}
          returnUrl={returnUrl}
          appearance={APPEARANCE}
          locale="en"
          analytics={false}
          onComplete={handleComplete}
        >
          <CheckoutElement
            buyerEmail={buyerEmail || ''}
            lockBuyerEmail={Boolean(buyerEmail)}
            onError={handleElementError}
            fallback={
              <div className="embedded-checkout-loading" role="status" aria-live="polite">
                <div className="spinner" />
                Loading secure checkout…
              </div>
            }
          />
        </Checkout>
      </WhopElements>
      {loadFailure && (
        <div className="embedded-checkout-error" role="alert">
          <p>We couldn’t load secure checkout. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => {
              if (!retryLoad) return;
              setLoadFailure(false);
              retryLoad();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {paymentReceived && (
        <p className="embedded-checkout-confirmation" role="status" aria-live="polite">
          Payment received. We’re confirming your access now…
        </p>
      )}
      <div className="embedded-checkout-powered-by">
        Powered by <span className="embedded-checkout-whop-mark">Whop</span>
      </div>
    </div>
  );
}
