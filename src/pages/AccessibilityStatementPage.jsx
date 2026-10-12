import useSeo from '../hooks/useSeo';

export default function AccessibilityStatementPage() {
  useSeo({
    title: 'Accessibility Statement | Capital Flow',
    description:
      "Read Capital Flow's accessibility statement, available features, known limitations, and contact details.",
    path: '/accessibility',
  });
  return (
    <article className="page-content policy-page" lang="en" dir="ltr">
      <h2 className="flow-title policy-title">Accessibility Statement</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">Updated October 11, 2026</p>
        <h3 className="policy-subtitle">Our commitment</h3>
        <p className="policy-paragraph">
          We work to improve Capital Flow&#39;s accessibility so people with disabilities can use the service.
          Improvements reference Israeli Standard 5568 and WCAG Level AA, as applicable. This statement does not certify
          that a full standards-compliance assessment has been completed.
        </p>
        <h3 className="policy-subtitle">Available features</h3>
        <p className="policy-paragraph">
          The accessibility button at the bottom of the screen is available on every page, including the homepage. You
          can:
        </p>
        <ul className="policy-list">
          <li>Increase or decrease text size.</li>
          <li>Choose a dark or light appearance.</li>
          <li>Enable high contrast.</li>
          <li>Highlight links.</li>
          <li>Reset accessibility settings.</li>
        </ul>
        <p className="policy-paragraph">
          Preferences are saved on your device. Keyboard navigation is supported, and buttons and fields have
          screen-reader labels. You can also use your browser&#39;s built-in zoom.
        </p>
        <h3 className="policy-subtitle">Known limitations</h3>
        <p className="policy-paragraph">
          Charts, market-provider content and the external checkout are not fully under our control. Some components may
          still need improvement. We continue to review and address them.
        </p>
        <h3 className="policy-subtitle">Accessibility support</h3>
        <p className="policy-paragraph">
          Having difficulty? Send the page address and a brief description to{' '}
          <a className="policy-inline-link" href="mailto:liormenaiot@gmail.com" dir="ltr">
            liormenaiot@gmail.com
          </a>
          . You may include your preferred contact method. We&#39;ll review your request and try to provide an
          accessible solution.
        </p>
      </div>
    </article>
  );
}
