import React from 'react';
import useSeo from '../hooks/useSeo';

function Part({ number, title, children }) {
  return (
    <div className="policy-part">
      <h3 className="policy-part-title">
        {number}. {title}
      </h3>
      {children}
    </div>
  );
}

const MEASURES = [
  'The ability to increase and decrease the site’s text size.',
  'A light/dark theme switch, so you can pick whichever is easier to read.',
  'A high-contrast mode to improve readability.',
  'Link highlighting (underline and outline) for easier identification.',
  'Full keyboard navigation and page routing support (Tab / Enter / Escape).',
  'Text labels (aria-label) on buttons and icons, for use with screen readers.',
  'Carefully chosen color contrast between text and background across the site.',
  'Semantic structure (headings, buttons, forms) that supports assistive technologies.',
];

const LIMITATIONS = [
  'Some content comes from external data providers (such as market data and news) that is not fully within our control and may not meet every accessibility requirement.',
  'The site is under continuous accessibility improvement, and a small number of individual components may not yet be fully adapted.',
];

export default function AccessibilityStatementPage() {
  useSeo({
    title: 'Accessibility Statement | Capital Flow',
    description:
      "Read Capital Flow's accessibility statement, available features, known limitations, and contact details.",
    path: '/accessibility',
  });

  return (
    <div className="page-content policy-page">
      <h2 className="flow-title policy-title">Accessibility Statement</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">Last updated: August 1, 2026</p>

        <Part number={1} title="Our Commitment to Accessibility">
          <p className="policy-paragraph">
            At Capital Flow, we place great importance on providing an equal and accessible service to all users,
            including people with disabilities. We act in accordance with the Equal Rights for Persons with Disabilities
            Regulations (Service Accessibility Adjustments), and the Israeli Standard IS 5568, based on WCAG 2.0 Level
            AA guidelines, to the extent applicable and relevant to the nature of the site.
          </p>
        </Part>

        <Part number={2} title="Accessibility Features on the Site">
          <p className="policy-paragraph">
            In addition to the floating accessibility menu (the icon in the bottom-left corner of the screen), the site
            includes:
          </p>
          <ul className="policy-list">
            {MEASURES.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Part>

        <Part number={3} title="Known Limitations">
          <ul className="policy-list">
            {LIMITATIONS.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Part>

        <Part number={4} title="Contact Us About Accessibility">
          <p className="policy-paragraph">
            If you encounter an accessibility issue on the site, or have a suggestion for improvement, we&apos;d be glad
            to hear from you by email at{' '}
            <a className="policy-inline-link" href="mailto:liormenaiot@gmail.com">
              liormenaiot@gmail.com
            </a>
            . We will do our best to address your inquiry as soon as possible.
          </p>
        </Part>
      </div>
    </div>
  );
}
