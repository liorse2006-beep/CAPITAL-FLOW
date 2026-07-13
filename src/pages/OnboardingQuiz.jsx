import React, { useState, useEffect, useRef } from 'react';

const QUESTIONS = [
  {
    id: 'role',
    question: 'What best describes you as a trader?',
    subtitle: 'No judgment — helps us show you the right features',
    options: [
      { label: 'Active day trader', emoji: '⚡', desc: 'Multiple positions, daily action' },
      { label: 'Swing trader', emoji: '📈', desc: 'Hold for days or weeks' },
      { label: 'Long term investor', emoji: '🏦', desc: 'Holding for years, watching fundamentals' },
      { label: 'Learning to trade', emoji: '🌱', desc: 'Building my strategy' },
    ],
  },
  {
    id: 'challenge',
    question: "What's your biggest challenge finding trades?",
    subtitle: 'Pick the one that hurts the most',
    options: [
      { label: 'Missing breakouts', emoji: '💨', desc: "By the time I see it, it's already moved" },
      { label: 'Too much noise', emoji: '📡', desc: 'Hard to filter what actually matters' },
      { label: 'Research takes too long', emoji: '⏱️', desc: 'Manually scanning charts kills my time' },
      { label: 'No reliable system', emoji: '🎲', desc: 'Relying on tips and gut feeling' },
    ],
  },
  {
    id: 'timing',
    question: 'How often do you see a stock up 15%+ and think "I saw signs of this"?',
    subtitle: "Be honest — we won't judge",
    options: [
      { label: 'Rarely — I catch most moves', emoji: '😎', desc: 'My process is solid' },
      { label: 'Sometimes — a few per week', emoji: '😐', desc: 'Room to improve' },
      { label: "All the time — it's frustrating", emoji: '😤', desc: 'I miss more than I catch' },
    ],
  },
  {
    id: 'money_flow',
    question: 'Would you want to know where the big money is flowing — before it moves the price?',
    subtitle: 'Before it shows up on Twitter, Reddit, or your news feed',
    options: [
      { label: "Yes — that's exactly the edge I need", emoji: '🎯', desc: 'I want to follow smart money in real time' },
      { label: "Definitely — I'm tired of being last", emoji: '🔥', desc: 'Done missing moves I could have caught' },
      { label: "I'm curious, show me how", emoji: '🧐', desc: 'Tell me more before I decide' },
    ],
  },
];

const MOCK_ALERTS = [
  { sym: 'NVDA', name: 'NVIDIA Corp', change: '+6.2%', ratio: '9.1x', ago: '2 min ago', hot: true },
  { sym: 'AMD', name: 'Advanced Micro Devices', change: '+3.8%', ratio: '6.4x', ago: '5 min ago', hot: true },
  { sym: 'META', name: 'Meta Platforms', change: '+4.1%', ratio: '5.7x', ago: '11 min ago', hot: false },
];

function RevealSlide({ onNext }) {
  const [statVal, setStatVal] = useState(0);
  const [visible, setVisible] = useState([false, false, false]);
  const [delayShown, setDelayShown] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Count up 87%
    let v = 0;
    const t = setInterval(() => {
      v += 3;
      if (v >= 87) {
        v = 87;
        clearInterval(t);
      }
      setStatVal(v);
    }, 28);

    // Stagger alert cards
    setTimeout(() => setVisible((p) => [true, p[1], p[2]]), 400);
    setTimeout(() => setVisible((p) => [p[0], true, p[2]]), 700);
    setTimeout(() => setVisible((p) => [p[0], p[1], true]), 1000);
    setTimeout(() => setDelayShown(true), 1400);
  }, []);

  return (
    <div className="quiz-reveal-wrap">
      <div className="quiz-reveal-eyebrow">THE EDGE YOU&apos;VE BEEN MISSING</div>

      {/* Big stat */}
      <div className="reveal-hero">
        <div className="reveal-hero-stat">{statVal}%</div>
        <div className="reveal-hero-label">
          of major single-day moves start with a volume spike
          <br />
          <strong style={{ color: '#f4f4f5' }}>hours before the price moves</strong>
        </div>
      </div>

      {/* Live alerts preview */}
      <div className="reveal-alerts-label">
        <span className="reveal-live-dot" />
        Alerts firing right now
      </div>
      <div className="reveal-alerts">
        {MOCK_ALERTS.map((a, i) => (
          <div
            key={a.sym}
            className={`reveal-alert-card ${a.hot ? 'hot' : ''}`}
            style={{
              opacity: visible[i] ? 1 : 0,
              transform: visible[i] ? 'translateY(0)' : 'translateY(12px)',
              transition: 'opacity 0.35s ease, transform 0.35s ease',
            }}
          >
            <div className="reveal-alert-left">
              <span className="reveal-alert-sym">{a.sym}</span>
              <span className="reveal-alert-name">{a.name}</span>
            </div>
            <div className="reveal-alert-right">
              <span className={`reveal-alert-change ${a.hot ? 'hot' : ''}`}>{a.change}</span>
              <span className="reveal-alert-ratio">{a.ratio} vol</span>
              <span className="reveal-alert-ago">{a.ago}</span>
            </div>
          </div>
        ))}
      </div>

      {/* The delay callout */}
      <div
        className="reveal-delay-box"
        style={{
          opacity: delayShown ? 1 : 0,
          transform: delayShown ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}
      >
        <div className="reveal-delay-row">
          <div className="reveal-delay-col pro">
            <div className="reveal-delay-badge">PROS</div>
            <div className="reveal-delay-time">0 sec</div>
            <div className="reveal-delay-sub">Real-time scanner alert</div>
          </div>
          <div className="reveal-delay-vs">VS</div>
          <div className="reveal-delay-col retail">
            <div className="reveal-delay-badge retail">YOU (NOW)</div>
            <div className="reveal-delay-time retail">~30 min</div>
            <div className="reveal-delay-sub">Twitter, news, gut feeling</div>
          </div>
        </div>
      </div>

      <button className="quiz-cta-btn secondary" onClick={onNext} style={{ marginTop: 28 }}>
        Fix that gap →
      </button>
    </div>
  );
}

export default function OnboardingQuiz({ onComplete }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState({});
  const [direction, setDirection] = useState('forward');

  const totalSteps = QUESTIONS.length + 1;
  const isQuestion = step < QUESTIONS.length;
  const isCTA = step === QUESTIONS.length;

  function advance() {
    setDirection('forward');
    setStep((s) => s + 1);
  }

  function back() {
    if (step === 0) return;
    setDirection('back');
    setStep((s) => s - 1);
  }

  function handleOptionClick(optLabel) {
    if (isQuestion) setSelected((prev) => ({ ...prev, [QUESTIONS[step].id]: optLabel }));
    setTimeout(() => advance(), 120);
  }

  function handleScan() {
    localStorage.setItem('vs_quiz_done', '1');
    onComplete();
  }

  const q = isQuestion ? QUESTIONS[step] : null;
  const enterClass = direction === 'forward' ? 'quiz-step-enter' : 'quiz-step-enter-back';

  return (
    <div className="quiz-shell">
      {/* Header */}
      <div className="quiz-top">
        {step > 0 && !isCTA ? (
          <button className="quiz-back-btn" onClick={back}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        ) : (
          <div className="quiz-logo">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span>CAPITAL FLOW</span>
          </div>
        )}
        {!isCTA && (
          <div className="quiz-progress">
            {Array.from({ length: totalSteps - 1 }).map((_, i) => (
              <div key={i} className={`quiz-prog-dot ${i < step ? 'done' : i === step ? 'active' : ''}`} />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="quiz-body">
        <div key={step} className={enterClass}>
          {isQuestion && (
            <div className="quiz-question-wrap">
              <div className="quiz-step-label">
                Question {step + 1} of {QUESTIONS.length}
              </div>
              <h2 className="quiz-question">{q.question}</h2>
              <p className="quiz-subtitle">{q.subtitle}</p>
              <div className="quiz-options">
                {q.options.map((opt) => (
                  <button
                    key={opt.label}
                    className={`quiz-option ${selected[q.id] === opt.label ? 'selected' : ''}`}
                    onClick={() => handleOptionClick(opt.label)}
                  >
                    <span className="quiz-opt-emoji">{opt.emoji}</span>
                    <span className="quiz-opt-text">
                      <span className="quiz-opt-label">{opt.label}</span>
                      <span className="quiz-opt-desc">{opt.desc}</span>
                    </span>
                    <span className="quiz-opt-check">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {isCTA && (
            <div className="quiz-cta-wrap">
              <div className="quiz-cta-logo-wrap">
                <img src="/logo-text.png" alt="Capital Flow" className="quiz-cta-logo-img" />
              </div>
              <h1 className="quiz-cta-title">
                See what&apos;s moving
                <br />
                <span className="quiz-cta-highlight">right now</span>
              </h1>
              <p className="quiz-cta-sub">
                Live volume spikes across 6,000+ stocks —<br />before they make the news.
              </p>
              <div className="quiz-cta-trust-row">
                <span className="quiz-cta-trust-item"><span className="quiz-cta-trust-dot" />Free to start</span>
                <span className="quiz-cta-trust-item"><span className="quiz-cta-trust-dot" />No credit card</span>
                <span className="quiz-cta-trust-item"><span className="quiz-cta-trust-dot" />Live data</span>
              </div>
              <div className="quiz-cta-aurora-wrap">
                <button className="quiz-cta-aurora-btn" onClick={handleScan}>
                  <span className="quiz-cta-aurora-content">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    Scan the market now
                  </span>
                </button>
                <div className="quiz-cta-aurora-glow" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
