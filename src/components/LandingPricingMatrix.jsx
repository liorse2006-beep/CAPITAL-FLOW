import TierComparisonMatrix from './shared/TierComparisonMatrix';

export default function LandingPricingMatrix({ onGetStarted }) {
  return (
    <div className="cf-landing-pricing-matrix">
      <TierComparisonMatrix
        userTier="free"
        trialEnded={false}
        onCheckout={() => onGetStarted()}
      />
      <div className="upgrade-trust-row">
        <span>Secure checkout</span>
        <span className="upgrade-trust-separator" />
        <span>Apple Pay / Google Pay when supported</span>
        <span className="upgrade-trust-separator" />
        <span>No recurring billing</span>
      </div>
    </div>
  );
}
