import React, { useState } from 'react';
import { loadWhop } from '@whop/elements';
import { WhopElements, Checkout, CheckoutElement } from '@whop/elements-react';
import { createWhopReturnUrl, redirectToWhopReturn } from '../../utils/checkoutReturn';
import { BILLING_COUNTRIES } from '../../utils/billingCountries';

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
  const [billingCountry, setBillingCountry] = useState('');
  const [countryConfirmed, setCountryConfirmed] = useState(false);
  const returnUrl = typeof window === 'undefined' ? undefined : createWhopReturnUrl();

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
    // Whop's returnUrl normally performs this navigation. Do it from the
    // confirmed completion callback too, so the customer reliably returns to
    // the app even if an iOS/embedded browser leaves them on Whop afterward.
    redirectToWhopReturn(returnUrl);
  }

  function handleElementError() {
    // Do not surface provider internals or raw errors in the customer UI.
    onError?.(new Error('Secure checkout is temporarily unavailable.'));
  }

  if (!countryConfirmed) {
    return (
      <form
        className="embedded-checkout"
        lang="en"
        dir="ltr"
        onSubmit={(event) => {
          event.preventDefault();
          if (billingCountry) setCountryConfirmed(true);
        }}
      >
        <label className="auth-label" htmlFor="checkout-billing-country">
          Billing country
        </label>
        <select
          id="checkout-billing-country"
          className="auth-input"
          required
          value={billingCountry}
          onChange={(event) => setBillingCountry(event.target.value)}
        >
          <option value="">Select country</option>
          {BILLING_COUNTRIES.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <p className="policy-paragraph">Select the country of your billing address.</p>
        <button className="upgrade-cta" type="submit" disabled={!billingCountry}>
          Continue to secure checkout
        </button>
      </form>
    );
  }

  return (
    <div className="embedded-checkout" dir="ltr">
      <WhopElements elements={elements} locale="en" appearance={APPEARANCE} onLoadError={handleLoadError}>
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
            defaultValues={{ billingDetails: { address: { country: billingCountry } } }}
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
