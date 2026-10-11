import TierComparisonMatrix from './shared/TierComparisonMatrix';

export default function LandingPricingMatrix({ onGetStarted }) {
  return (
    <div className="cf-landing-pricing-matrix">
      <TierComparisonMatrix userTier="free" trialEnded={false} onCheckout={() => onGetStarted()} />
      <div className="upgrade-trust-row">
        <span>תשלום מאובטח</span>
        <span className="upgrade-trust-separator" />
        <span>Apple Pay ו־Google Pay במכשירים נתמכים</span>
        <span className="upgrade-trust-separator" />
        <span>ללא חיוב חוזר</span>
      </div>
    </div>
  );
}
