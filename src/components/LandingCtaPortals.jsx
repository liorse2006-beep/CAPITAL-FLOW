import { createPortal } from 'react-dom';
import SpecularButton from './SpecularButton';
import LandingPricingMatrix from './LandingPricingMatrix';

const LANDING_CTA_DEFINITIONS = {
  nav: { label: 'לנסות בחינם', size: 'sm', className: 'cf-specular-cta cf-specular-cta--nav' },
  hero: { label: 'התחל בחינם', size: 'lg', className: 'cf-specular-cta cf-specular-cta--large', arrow: true },
  'pricing-free': { label: 'לנסות בחינם', size: 'md', className: 'cf-specular-cta cf-specular-cta--plan' },
  'pricing-premium': { label: 'לבחור Premium', size: 'md', className: 'cf-specular-cta cf-specular-cta--plan' },
  'pricing-elite': { label: 'לבחור Elite', size: 'md', className: 'cf-specular-cta cf-specular-cta--plan' },
  final: { label: 'התחל בחינם', size: 'lg', className: 'cf-specular-cta cf-specular-cta--large', arrow: true },
};

export default function LandingCtaPortals({ targets, pricingTarget, onGetStarted }) {
  return (
    <>
      {targets.map((target) => {
        const location = target.getAttribute('data-cta-location');
        const definition = LANDING_CTA_DEFINITIONS[location];
        if (!definition) return null;

        return createPortal(
          <SpecularButton
            size={definition.size}
            radius={18}
            tint="#ffffff"
            tintOpacity={0}
            blur={0}
            textColor="#f5f5f5"
            lineColor="#f9d27b"
            baseColor="#9b651c"
            intensity={1}
            shineSize={10}
            shineFade={40}
            thickness={1}
            speed={0.35}
            followMouse
            proximity={250}
            autoAnimate={false}
            type="button"
            className={definition.className}
            data-cta-location={location}
          >
            {definition.arrow ? (
              <>
                {definition.label}{' '}
                <span className="cf-specular-cta__arrow" aria-hidden="true">
                  ←
                </span>
              </>
            ) : (
              definition.label
            )}
          </SpecularButton>,
          target,
          location
        );
      })}
      {pricingTarget
        ? createPortal(<LandingPricingMatrix onGetStarted={onGetStarted} />, pricingTarget, 'landing-pricing-matrix')
        : null}
    </>
  );
}
