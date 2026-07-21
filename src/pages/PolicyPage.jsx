import React from 'react';
import { resetConsent } from '../analytics';

const PRIVACY_INTRO =
  "This Privacy Policy explains what data Capital Flow collects, why we collect it, and how you can request its deletion. We only collect the minimum data required to operate the service, and we never sell your personal data to third parties.";

const DATA_COLLECTED = [
  {
    title: 'Account information',
    body: 'Your email address and subscription tier (Free, Premium, or Elite).',
  },
  {
    title: 'Push notifications',
    body: 'If you enable push notifications (an Elite-only feature), we store a technical subscription identifier tied to your browser or device so we can deliver alerts to it. You can revoke this at any time from the Watchlist page.',
  },
  {
    title: 'Technical and analytics data (optional)',
    body: "If usage analytics is enabled, we collect general events such as page visits, scans run, or upgrade prompts viewed, to help us understand and improve the product. If error monitoring is enabled, we record technical details about browser errors (the page URL and error message) to help us fix bugs. Both services are off by default and only activate if explicitly configured on our servers.",
  },
];

const USER_RIGHTS = [
  'Request to view the data stored on your account.',
  'Request correction of inaccurate data.',
  'Permanently delete your account and all data associated with it — directly from your account settings in the app, or by contacting us.',
  'Unsubscribe from any notifications (push, alerts) at any time.',
];

function Section({ title, children }) {
  return (
    <div className="policy-section">
      <h3 className="policy-subtitle">{title}</h3>
      {children}
    </div>
  );
}

export default function PolicyPage() {
  return (
    <div className="page-content policy-page">
      <h2 className="flow-title policy-title">Privacy Policy</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">Last updated: July 20, 2026</p>
        <p className="policy-paragraph">{PRIVACY_INTRO}</p>

        <Section title="Information we collect">
          {DATA_COLLECTED.map((d, i) => (
            <p key={i} className="policy-paragraph">
              <strong>{d.title}:</strong> {d.body}
            </p>
          ))}
        </Section>

        <Section title="How long we retain your data">
          <p className="policy-paragraph">
            We retain your data for as long as your account remains active. When you delete your account, all
            associated data — account details, Watchlist, alerts, and push subscriptions — is permanently
            deleted from our servers immediately.
          </p>
        </Section>

        <Section title="Your rights">
          <ul className="policy-list">
            {USER_RIGHTS.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>

        <Section title="Cookies">
          <p className="policy-paragraph">
            We use cookies to operate and improve the service. We do not sell or share your personal data with
            third parties for advertising purposes. You can manage your cookie preferences at any time by{' '}
            <button
              type="button"
              className="policy-inline-link"
              onClick={() => {
                resetConsent();
                window.location.reload();
              }}
            >
              reopening the consent banner
            </button>
            .
          </p>
        </Section>

        <Section title="Third-party services">
          <p className="policy-paragraph">
            We rely on a small number of trusted providers to operate Capital Flow: Google, for optional sign-in
            via Google OAuth; Cloudflare Turnstile, to verify you're not a bot during sign-in; Gmail, which
            delivers our account emails (verification codes, password resets, and notifications); Whop, our
            payment processor, which handles checkout and billing (we never see or store your full card
            details); and, where enabled, the analytics and error-monitoring providers described above. Each
            provider processes data under its own privacy policy, and only to the extent necessary to provide
            its service to us.
          </p>
        </Section>

        <Section title="Data security">
          <p className="policy-paragraph">
            We apply reasonable technical and organizational measures to protect your data, including encrypted
            connections (HTTPS) and access controls on our servers. No method of electronic storage or
            transmission is completely secure, and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="Not investment advice">
          <p className="policy-paragraph">
            Capital Flow is a market-scanning and information tool only. It displays market data — such as trading
            volume, prices, and moving averages — for informational purposes only. Nothing on this site
            constitutes investment advice, a recommendation to buy or sell any security, or financial advice of
            any kind. We are not licensed investment advisors and do not act as one. Market data shown may be
            delayed, estimated, or subject to provider errors, and should not be relied on as your sole source of
            information. Every investment decision, including its financial outcome, whether profit or loss, is
            the sole responsibility of the user. We recommend consulting a licensed financial advisor before
            making investment decisions.
          </p>
        </Section>

        <Section title="Disclaimer of warranties and limitation of liability">
          <p className="policy-paragraph">
            The service is provided "as is" and "as available", without warranties of any kind, express or
            implied. We do not guarantee uninterrupted access, error-free operation, or the accuracy,
            completeness, or timeliness of any market data displayed. To the fullest extent permitted by law,
            Capital Flow and its operators are not liable for any direct, indirect, incidental, or consequential
            damages — including trading losses — arising from your use of, or inability to use, the service.
          </p>
        </Section>

        <Section title="Refund policy">
          <p className="policy-paragraph">
            Refunds are issued only in the case of a technical malfunction in the product's functionality, which
            our team attempted to fix and was unable to resolve within 14 days of being reported. Outside of
            this case, payments made are non-refundable.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p className="policy-paragraph">
            We may update this Privacy Policy from time to time to reflect changes in our practices or for legal,
            operational, or regulatory reasons. Material changes will be reflected by an updated revision date at
            the top of this page. Continued use of the service after changes take effect constitutes acceptance
            of the revised policy.
          </p>
        </Section>

        <Section title="Contact us">
          <p className="policy-paragraph">
            For any question or request regarding this policy or your data, you can reach us via Instagram at
            capital_flow555.
          </p>
        </Section>
      </div>
    </div>
  );
}
