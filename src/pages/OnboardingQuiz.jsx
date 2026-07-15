import React, { useState } from 'react';

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

export default function OnboardingQuiz({ onComplete }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState({});
  const [direction, setDirection] = useState('forward');

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
        {isQuestion && (
          <div className="quiz-progress">
            {Array.from({ length: QUESTIONS.length }).map((_, i) => (
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
                <img src="/logo-text.jpeg" alt="Capital Flow" className="quiz-cta-logo-img" />
              </div>
              <h1 className="quiz-cta-title">
                See where the money
                <span className="quiz-cta-highlight">is flowing.</span>
              </h1>
              <div className="quiz-cta-scan-outer">
                <button className="quiz-cta-scan-btn" onClick={handleScan}>
                  <span className="quiz-cta-scan-shimmer" />
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Start scanning
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
