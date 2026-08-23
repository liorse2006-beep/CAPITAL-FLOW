import React, { useEffect, useRef, useState } from 'react';

// Capi's persona leans on **bold** and bullets to stay scannable — a tiny
// line-based parser is enough here, no need for a full markdown library.
// Gemini doesn't always use the literal • character even when asked to
// (sometimes "*" or "-"), so every bullet marker is normalized to the
// same dot rather than trusting the model's exact character choice.
function renderCapiInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map(function (part, i) {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={keyPrefix + '-' + i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function renderCapiMessage(text) {
  return text.split('\n').map(function (line, li) {
    var bulletMatch = line.match(/^(\s*)[•*-]\s+(.*)/);
    if (bulletMatch) {
      var nested = bulletMatch[1].length > 0;
      return (
        <div key={li} className={'chat-bullet-line' + (nested ? ' nested' : '')}>
          <span className="chat-bullet-dot">•</span>
          <span>{renderCapiInline(bulletMatch[2], li)}</span>
        </div>
      );
    }
    if (line.trim() === '') return <div key={li} className="chat-line-gap" />;
    return <div key={li}>{renderCapiInline(line, li)}</div>;
  });
}

// The teaser is a permanent fixture next to the launcher, not a one-time
// intro — it's showing any time the chat is closed. "dismissed" only hides
// it for the current closed stretch: opening the chat and closing it again
// brings it right back, so a user can wave it away without killing it
// forever the way the old localStorage flag did.
var TEASER_READY_DELAY_MS = 1500;

export default function ChatWidget({
  user,
  isElite,
  trialEnded,
  getToken,
  externalPrompt,
  onExternalPromptSent,
  onRequireAuth,
  onTrialEnded,
}) {
  const [open, setOpen] = useState(false);
  const [teaserReady, setTeaserReady] = useState(false);
  const [teaserDismissed, setTeaserDismissed] = useState(false);
  const [messages, setMessages] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const historyLoadingRef = useRef(false);

  useEffect(function () {
    // Shown to everyone, signed in or not — a guest who taps it gets asked
    // to sign in (see toggleOpen) rather than never knowing Capi exists.
    var t = setTimeout(function () {
      setTeaserReady(true);
    }, TEASER_READY_DELAY_MS);
    return function () {
      clearTimeout(t);
    };
  }, []);

  useEffect(
    function () {
      if (open) setTeaserDismissed(false);
    },
    [open]
  );

  function dismissTeaser() {
    setTeaserDismissed(true);
  }

  function toggleOpen() {
    if (!user) {
      if (onRequireAuth) onRequireAuth();
      return;
    }
    if (trialEnded && !isElite) {
      if (onTrialEnded) onTrialEnded();
      return;
    }
    setOpen((o) => !o);
  }

  var showTeaser = teaserReady && !open && !teaserDismissed;

  function loadHistory() {
    if (historyLoadingRef.current) return Promise.resolve();
    historyLoadingRef.current = true;
    return fetch('/api/chat/history', { headers: { Authorization: 'Bearer ' + getToken() } })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setMessages((rows || []).map((r) => ({ role: r.role, content: r.content })));
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }

  useEffect(
    function () {
      if (!open || historyLoaded) return;
      loadHistory();
    },
    [open]
  );

  useEffect(
    function () {
      // Also keyed on `open`: the panel unmounts on close and remounts fresh
      // on reopen, so without this a reopen with unchanged history (already
      // loaded, nothing new since) would sit at the top instead of jumping
      // straight to the most recent message like a chat should.
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    },
    [messages, sending, open]
  );

  function send(overrideText) {
    var text = (typeof overrideText === 'string' ? overrideText : input).trim();
    if (!text || sending) return;
    setInput('');
    setMessages((prev) => prev.concat([{ role: 'user', content: text }]));
    setSending(true);
    fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ message: text }),
    })
      .then((r) => r.json())
      .then((d) => {
        setMessages((prev) => prev.concat([{ role: 'assistant', content: d.reply || 'Sorry, something went wrong.' }]));
      })
      .catch(() => {
        setMessages((prev) =>
          prev.concat([{ role: 'assistant', content: "Sorry, I couldn't send that — try again." }])
        );
      })
      .finally(() => setSending(false));
  }

  // Lets other parts of the app (e.g. an "Explain This" button on a scan
  // result) hand Capi a message and have it actually ask it — opens the
  // panel, makes sure existing history is loaded first so the new message
  // lands after it rather than racing it, then sends.
  useEffect(
    function () {
      if (!externalPrompt || !user) return;
      setOpen(true);
      var ready = historyLoaded ? Promise.resolve() : loadHistory();
      ready.then(function () {
        send(externalPrompt);
      });
      if (onExternalPromptSent) onExternalPromptSent();
    },
    [externalPrompt]
  );

  function clearChat() {
    setMessages([]);
    fetch('/api/chat/history', { method: 'DELETE', headers: { Authorization: 'Bearer ' + getToken() } }).catch(
      () => {}
    );
  }

  // Capi is an Elite feature, gated server-side too (requireEliteOrTrial on
  // every /chat route). Premium users still do not get the launcher, while a
  // signed-in Free user whose trial ended keeps the launcher visible so a tap
  // can reopen the existing trial-ended upgrade message. A GUEST still sees
  // it and is asked to sign in when tapping the launcher.
  if (user && !isElite && !trialEnded) return null;

  return (
    <div className="chat-widget">
      {showTeaser && (
        <div className="chat-teaser">
          <button className="chat-teaser-close" onClick={dismissTeaser} aria-label="Dismiss">
            ×
          </button>
          <span>Hi, I&apos;m Capi — your market mentor 👋</span>
        </div>
      )}

      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chat with Capi">
          <div className="chat-panel-header">
            <div className="chat-panel-title">
              <div className="chat-avatar-wrap">
                <img src="/icon-192.png" alt="" className="chat-avatar" />
              </div>
              <div className="chat-title-stack">
                <div className="chat-title-name">
                  Capi <span className="chat-title-tag">Market Mentor</span>
                </div>
                <div className="chat-title-status">
                  <span className="chat-status-dot" />
                  Ready to help
                </div>
              </div>
            </div>
            <div className="chat-panel-actions">
              <button className="chat-clear-btn" onClick={clearChat} title="Clear chat">
                Clear
              </button>
              <button className="chat-panel-close" onClick={() => setOpen(false)} aria-label="Close chat">
                ×
              </button>
            </div>
          </div>
          <div className="chat-panel-body" ref={listRef}>
            {messages.length === 0 && historyLoaded && (
              <div className="chat-empty">
                Ask me about scan types, tiers, alerts, or anything else about Capital Flow.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={'chat-bubble-row ' + m.role}>
                {m.role === 'assistant' && <img src="/icon-192.png" alt="" className="chat-msg-avatar" />}
                <div className={'chat-bubble ' + m.role}>
                  {m.role === 'assistant' ? renderCapiMessage(m.content) : m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="chat-bubble-row assistant">
                <img src="/icon-192.png" alt="" className="chat-msg-avatar" />
                <div className="chat-bubble assistant chat-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
          <div className="chat-panel-input">
            <input
              type="text"
              placeholder="Message Capi…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              maxLength={2000}
            />
            <button onClick={send} disabled={sending || !input.trim()} aria-label="Send">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="chat-disclaimer">
            Capi is AI and can make mistakes. For educational and informational purposes only — not financial advice.
          </p>
        </div>
      )}

      <button
        className={'chat-fab' + (showTeaser ? ' teaser-active' : '')}
        onClick={toggleOpen}
        aria-label={open ? 'Close chat' : 'Open chat with Capi'}
      >
        <img src="/icon-192.png" alt="" />
      </button>
    </div>
  );
}
