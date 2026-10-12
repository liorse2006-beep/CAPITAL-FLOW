import { resetConsent } from '../analytics';
import useSeo from '../hooks/useSeo';

function Section({ title, children }) {
  return (
    <section className="policy-section">
      <h3 className="policy-subtitle">{title}</h3>
      {children}
    </section>
  );
}

export default function PolicyPage() {
  useSeo({
    title: 'Terms of Use and Privacy Policy | Capital Flow',
    description: "Capital Flow's terms of use, privacy, payments, refunds and contact information.",
    path: '/policy',
  });
  return (
    <article className="page-content policy-page" lang="en" dir="ltr">
      <h2 className="flow-title policy-title">Terms of Service & Privacy Policy</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">Updated October 11, 2026</p>
        <p className="policy-paragraph">
          This document explains the terms of use and how Capital Flow handles information.
        </p>
        <Section title="Not investment advice">
          <p className="policy-paragraph">
            Capital Flow provides market data and scanning tools for education and research only. Information is not
            investment advice, financial advice or a recommendation to buy or sell securities. The service does not
            provide licensed investment advice. Prices, trading volumes and moving averages may be delayed, estimated,
            partial or incorrect. Do not rely on them as your only source. You are responsible for investment decisions
            and their outcomes, and should consider consulting an appropriately licensed professional.
          </p>
        </Section>
        <Section title="Availability and responsibility">
          <p className="policy-paragraph">
            The service is provided as is and as available. Continuous operation, freedom from errors, and complete or
            current data are not guaranteed. Subject to applicable law, the operators are not responsible for damage
            resulting from use or inability to use the service, including trading losses. These terms do not exclude
            rights that cannot legally be waived.
          </p>
        </Section>
        <Section title="Payments and refund requests">
          <p className="policy-paragraph">
            Premium and Elite are one-time purchases with no recurring monthly billing. The final price is shown in
            Whop&#39;s secure checkout. We do not store full card details.
          </p>
          <p className="policy-paragraph">
            In addition to your statutory rights, you may request a refund for a product-functionality issue reported to
            us and not resolved within 14 days. This policy does not limit cancellation or refund rights under
            applicable law. Send cancellation or refund requests to the email below; you do not need to wait 14 days to
            exercise a statutory right.
          </p>
        </Section>
        <Section title="Information we store">
          <ul className="policy-list">
            <li>Email address, secured sign-in information and account plan.</li>
            <li>Watchlist stocks, saved scans, schedules and alert settings.</li>
            <li>
              If you enable push: browser or device subscription details needed for delivery. You can disable push in
              settings.
            </li>
            <li>
              Optional analytics: events such as visits and feature use, only after explicit consent. Technical error
              monitoring, when configured, is used to identify problems, not for advertising.
            </li>
          </ul>
          <p className="policy-paragraph">
            We do not sell personal information for marketing or advertising. Providing information is voluntary;
            essential information is required to create an account and operate your chosen features.
          </p>
        </Section>
        <Section title="Cookies and analytics">
          <p className="policy-paragraph">
            Essential cookies support sign-in and security. PostHog analytics are enabled only with your consent;
            declining does not affect normal use. When you consent, analytics data may be stored in the United States.
          </p>
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
        </Section>
        <Section title="Service providers and data processing">
          <ul className="policy-list">
            <li>Google — optional sign-in.</li>
            <li>Resend — essential account-verification and password-reset emails.</li>
            <li>Whop — payment processing and transaction details.</li>
            <li>
              Hosting, storage and backup services — to operate the service and recover from failures. An operational
              backup is emailed to the operator as an encrypted file; the recovery key is stored separately and is not
              sent with the file.
            </li>
            <li>PostHog and an error-monitoring provider, if enabled — according to settings and privacy choices.</li>
          </ul>
          <p className="policy-paragraph">
            Local sign-up verification does not require an external CAPTCHA service. Infrastructure providers may
            process information outside your country of residence, including in the United States and Europe, according
            to the service and provider policies.
          </p>
        </Section>
        <Section title="Retention, deletion and your rights">
          <p className="policy-paragraph">
            Active information is retained while your account is active. You may request access or corrections, disable
            notifications, and delete your account through account settings or by contacting us. Deletion removes your
            account and linked records from the active database. Earlier copies may remain in operational backups;
            payment-provider transaction data is subject to its policies and applicable law.
          </p>
        </Section>
        <Section title="Information security">
          <p className="policy-paragraph">
            We use encrypted connections and restrict access to information. No storage or transmission method
            guarantees absolute security.
          </p>
        </Section>
        <Section title="Updates and contact">
          <p className="policy-paragraph">
            Material changes to this document will be reflected in its update date. For service, cancellation, privacy
            or accessibility requests:{' '}
            <a className="policy-inline-link" href="mailto:liormenaiot@gmail.com" dir="ltr">
              liormenaiot@gmail.com
            </a>
            . You can also contact us on{' '}
            <a
              className="policy-inline-link"
              href="https://instagram.com/capital_flow555"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram
            </a>
            .
          </p>
        </Section>
      </div>
    </article>
  );
}
