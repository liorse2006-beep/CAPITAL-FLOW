import React, { useCallback, useEffect, useRef, useState } from 'react';
import useIsMobile from '../../hooks/useIsMobile';

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

function parseCapiSseBlock(block) {
  var eventType = null;
  var dataLines = [];
  String(block || '')
    .split(/\r?\n/)
    .forEach(function (line) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    });
  if (!dataLines.length) return null;
  var raw = dataLines.join('\n').trim();
  if (raw === '[DONE]') return { eventType: 'done', data: null };
  try {
    return { eventType: eventType, data: JSON.parse(raw) };
  } catch {
    return { eventType: eventType, data: null, parseError: true };
  }
}

async function readCapiStream(response, handlers) {
  if (!response.ok) {
    var errorPayload = {};
    try {
      errorPayload = await response.json();
    } catch (_) {}
    throw new Error(errorPayload.error || 'Capi request failed');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Capi streaming is unavailable');
  }

  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  var finished = false;

  function consume(block) {
    var parsed = parseCapiSseBlock(block);
    if (!parsed || parsed.parseError) throw new Error('Invalid Capi stream');
    if (parsed.eventType === 'delta' && parsed.data && typeof parsed.data.text === 'string') {
      if (handlers.onDelta) handlers.onDelta(parsed.data.text);
    } else if (parsed.eventType === 'complete') {
      if (!parsed.data || typeof parsed.data.reply !== 'string') throw new Error('Incomplete Capi response');
      finished = true;
      if (handlers.onComplete) handlers.onComplete(parsed.data.reply);
    } else if (parsed.eventType === 'error') {
      if (!parsed.data || typeof parsed.data.reply !== 'string') throw new Error('Capi provider error');
      finished = true;
      if (handlers.onError) handlers.onError(parsed.data.reply);
    }
  }

  while (!finished) {
    var result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    var separator;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      var block = buffer.slice(0, separator);
      buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, '');
      consume(block);
      if (finished) break;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() && !finished) consume(buffer);
  if (!finished) throw new Error('Capi stream ended before completion');
}

// The teaser is a permanent fixture next to the launcher, not a one-time
// intro — it's showing any time the chat is closed. "dismissed" only hides
// it for the current closed stretch: opening the chat and closing it again
// brings it right back, so a user can wave it away without killing it
// forever the way the old localStorage flag did.
var TEASER_READY_DELAY_MS = 1500;

export default function ChatWidget({ user, isElite, trialEnded, getToken, onRequireAuth, onTrialEnded }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [teaserReady, setTeaserReady] = useState(false);
  const [teaserDismissed, setTeaserDismissed] = useState(false);
  const [messages, setMessages] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const historyPromiseRef = useRef(null);
  const messageIdRef = useRef(0);
  const conversationGenerationRef = useRef(0);
  const streamAbortRef = useRef(null);
  const mountedRef = useRef(true);
  const accountKey = user && user.id != null ? String(user.id) : null;
  const accountKeyRef = useRef(accountKey);

  useEffect(function () {
    mountedRef.current = true;
    return function () {
      mountedRef.current = false;
      if (streamAbortRef.current) streamAbortRef.current.abort();
      streamAbortRef.current = null;
    };
  }, []);

  useEffect(
    function () {
      if (accountKeyRef.current === accountKey) return;
      accountKeyRef.current = accountKey;
      conversationGenerationRef.current += 1;
      if (streamAbortRef.current) streamAbortRef.current.abort();
      streamAbortRef.current = null;
      historyPromiseRef.current = null;
      setMessages([]);
      setHistoryLoaded(false);
      setInput('');
      setSending(false);
      setOpen(false);
    },
    [accountKey]
  );

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
    if (!open) setTeaserDismissed(false);
    setOpen(!open);
  }

  var showTeaser = teaserReady && !open && !teaserDismissed;

  function nextMessageId(prefix) {
    messageIdRef.current += 1;
    return prefix + '-' + messageIdRef.current;
  }

  const loadHistory = useCallback(() => {
    if (historyPromiseRef.current) return historyPromiseRef.current;
    var generation = conversationGenerationRef.current;
    historyPromiseRef.current = fetch('/api/chat/history', {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (conversationGenerationRef.current !== generation) return;
        var historyRows = (rows || []).map((r, i) => ({
          clientId: 'history-' + (r.id || i),
          role: r.role,
          content: r.content,
          pending: false,
        }));
        // A user can send before the prefetch/open request completes. Never
        // let the late history response overwrite those optimistic bubbles,
        // including an assistant bubble that has already received its first
        // streamed delta and is no longer technically pending.
        setMessages((prev) => historyRows.concat(prev.filter((m) => m.optimistic)));
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (conversationGenerationRef.current === generation) setHistoryLoaded(true);
      })
      .finally(() => {
        if (conversationGenerationRef.current === generation) historyPromiseRef.current = null;
      });
    return historyPromiseRef.current;
  }, [getToken]);

  useEffect(
    function () {
      if (!open || historyLoaded) return;
      loadHistory();
    },
    [historyLoaded, loadHistory, open]
  );

  // Warm only the authenticated Elite/trial path. This is a cheap read, not
  // an AI call, and moves the history request out of the user's first click.
  useEffect(
    function () {
      if (!user || !isElite || trialEnded || isMobile || historyLoaded) return;
      var cancelled = false;
      var idleId = null;
      var timerId = null;
      var start = function () {
        if (!cancelled) loadHistory();
      };
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(start, { timeout: 1200 });
      } else {
        timerId = window.setTimeout(start, 250);
      }
      return function () {
        cancelled = true;
        if (idleId != null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
        if (timerId != null) window.clearTimeout(timerId);
      };
    },
    [historyLoaded, isElite, isMobile, loadHistory, trialEnded, user]
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
    var generation = conversationGenerationRef.current;
    var userMessageId = nextMessageId('user');
    var assistantMessageId = nextMessageId('assistant');
    var streamedText = '';
    setInput('');
    setMessages((prev) =>
      prev.concat([
        { clientId: userMessageId, role: 'user', content: text, pending: true, optimistic: true },
        {
          clientId: assistantMessageId,
          role: 'assistant',
          content: '',
          streaming: true,
          pending: true,
          optimistic: true,
        },
      ])
    );
    setSending(true);
    var abortController = new AbortController();
    streamAbortRef.current = abortController;
    function updateAssistant(content, streaming) {
      if (conversationGenerationRef.current !== generation) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === assistantMessageId ? { ...m, content: content, streaming: streaming, pending: false } : m
        )
      );
    }

    fetch('/api/chat/message/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ message: text }),
      signal: abortController.signal,
    })
      .then((response) =>
        readCapiStream(response, {
          onDelta: function (chunk) {
            streamedText += chunk;
            updateAssistant(streamedText, true);
          },
          onComplete: function (reply) {
            // The completion payload is the server's canonical assembled
            // answer; use it to protect against any client-side chunk issue.
            updateAssistant(reply, false);
          },
          onError: function (reply) {
            updateAssistant(reply, false);
          },
        })
      )
      .catch((error) => {
        if (error && error.name === 'AbortError') return;
        if (mountedRef.current) updateAssistant("Sorry, I couldn't send that — try again.", false);
      })
      .finally(() => {
        if (streamAbortRef.current === abortController) streamAbortRef.current = null;
        if (mountedRef.current && conversationGenerationRef.current === generation) setSending(false);
      });
  }

  function closeChat() {
    if (streamAbortRef.current) streamAbortRef.current.abort();
    streamAbortRef.current = null;
    setOpen(false);
  }

  // App also avoids mounting the widget at phone widths. Keep this guard in
  // the component as a second line of defense for direct consumers and for
  // responsive resizes after the widget was already mounted on desktop.
  if (isMobile) return null;

  function clearChat() {
    if (streamAbortRef.current) streamAbortRef.current.abort();
    streamAbortRef.current = null;
    setMessages([]);
    setSending(false);
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
              <button className="chat-panel-close" onClick={closeChat} aria-label="Close chat">
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
              <div key={m.clientId || i} className={'chat-bubble-row ' + m.role}>
                {m.role === 'assistant' && <img src="/icon-192.png" alt="" className="chat-msg-avatar" />}
                {m.streaming && !m.content ? (
                  <div className="chat-bubble assistant chat-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <div className={'chat-bubble ' + m.role}>
                    {m.role === 'assistant' ? renderCapiMessage(m.content) : m.content}
                  </div>
                )}
              </div>
            ))}
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
