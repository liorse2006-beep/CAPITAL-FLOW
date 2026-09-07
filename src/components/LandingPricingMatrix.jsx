import TierComparisonMatrix from './shared/TierComparisonMatrix';

export default function LandingPricingMatrix({ onGetStarted }) {
  return (
    <div className="cf-landing-pricing-matrix">
      <TierComparisonMatrix userTier="free" trialEnded={false} onCheckout={() => onGetStarted && onGetStarted()} />
      <div className="cf-pricing-trust" aria-label="פרטי תשלום וגישה">
        <span>תשלום מאובטח</span>
        <span className="cf-pricing-trust-separator" aria-hidden="true" />
        <span>Apple Pay / Google Pay כשנתמך</span>
        <span className="cf-pricing-trust-separator" aria-hidden="true" />
        <span>ללא חיוב חודשי</span>
      </div>
    </div>
  );
}
