import React, { useState, useEffect } from 'react';

const QUESTIONS = [
  {
    id: 'role',
    question: 'מה מתאר אותך כמשקיע?',
    subtitle: 'כך נתאים לך את ההיכרות עם הכלים',
    options: [
      { label: 'סוחר יומי', emoji: '⚡', desc: 'פעילות מסחר בכל יום' },
      { label: 'סוחר סווינג', emoji: '📈', desc: 'החזקת מניות למספר ימים או שבועות' },
      { label: 'משקיע לטווח ארוך', emoji: '🏦', desc: 'השקעה ארוכת טווח ומעקב פיננסי' },
      { label: 'לומד את עולם המסחר', emoji: '🌱', desc: 'בונה שיטת עבודה' },
    ],
  },
  {
    id: 'challenge',
    question: 'מה הכי מקשה עליך לאתר מניות?',
    subtitle: 'בחר את האתגר המרכזי שלך',
    options: [
      { label: 'מפספס תנועות בשוק', emoji: '💨', desc: 'רואה את התנועה אחרי שהיא כבר התרחשה' },
      { label: 'יותר מדי רעש', emoji: '📡', desc: 'קשה לסנן את מה שבאמת חשוב' },
      { label: 'המחקר לוקח יותר מדי זמן', emoji: '⏱️', desc: 'בדיקת גרפים ידנית גוזלת זמן' },
      { label: 'אין שיטת עבודה מסודרת', emoji: '🎲', desc: 'מסתמך על טיפים ותחושת בטן' },
    ],
  },
  {
    id: 'timing',
    question: 'באיזו תדירות אתה רואה תנועה חזקה ומרגיש שיכולת לשים לב מוקדם יותר?',
    subtitle: 'אין תשובה נכונה או לא נכונה',
    options: [
      { label: 'לעיתים רחוקות', emoji: '😎', desc: 'יש לי תהליך מחקר מסודר' },
      { label: 'לפעמים', emoji: '😐', desc: 'יש מקום לשיפור' },
      { label: 'לעיתים קרובות', emoji: '😤', desc: 'מרגיש שאני מפספס הזדמנויות למחקר' },
    ],
  },
  {
    id: 'money_flow',
    question: 'האם תרצה כלי שיעזור לזהות פעילות חריגה בשוק?',
    subtitle: 'נתוני מחיר ונפח מסחר להמשך מחקר עצמאי',
    options: [
      { label: 'כן — זה בדיוק מה שאני מחפש', emoji: '🎯', desc: 'רוצה להבין את פעילות המסחר' },
      { label: 'בהחלט — רוצה לעבוד בצורה מסודרת', emoji: '🔥', desc: 'רוצה לאתר מניות מעניינות למחקר' },
      { label: 'מסקרן אותי, הראה לי איך', emoji: '🧐', desc: 'רוצה להכיר לפני שאחליט' },
    ],
  },
];

export default function OnboardingQuiz({ onComplete }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState({});
  const [direction, setDirection] = useState('forward');

  // Mark the quiz as seen the instant it's shown — not only when the user
  // reaches the final CTA. This guarantees it appears exactly once per
  // device, ever: someone who abandons it halfway, or whose app reloads
  // mid-quiz (a deploy, a refresh), never sees it again from scratch.
  useEffect(function () {
    try {
      localStorage.setItem('vs_quiz_done', '1');
    } catch (_) {
      /* private mode — nothing we can do, but don't crash the quiz */
    }
  }, []);

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
        {isCTA ? null : step > 0 ? (
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
            חזרה
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
                שאלה {step + 1} מתוך {QUESTIONS.length}
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
                <img src="/logo-text-transparent.png" alt="Capital Flow" className="quiz-cta-logo-img" />
              </div>
              <h1 className="quiz-cta-title">
                התחל עכשיו וקבל
                <span className="quiz-cta-highlight">שבעה ימי ניסיון בחינם.</span>
              </h1>
              <ul className="quiz-cta-benefits">
                <li>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  איתור נפח מסחר חריג במניות
                </li>
                <li>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  התראות לפי התנאים שהגדרת
                </li>
                <li>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  התחל לסרוק בחינם — ללא כרטיס אשראי
                </li>
              </ul>
              <div className="quiz-cta-scan-outer">
                <button className="quiz-cta-scan-btn" onClick={handleScan}>
                  <span className="quiz-cta-scan-label">התחלת סריקה</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
