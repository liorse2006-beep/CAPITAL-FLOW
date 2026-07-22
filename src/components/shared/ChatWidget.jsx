import React, { useEffect, useRef, useState } from 'react'

// Capi's persona leans on **bold** and bullets to stay scannable — a tiny
// line-based parser is enough here, no need for a full markdown library.
// Gemini doesn't always use the literal • character even when asked to
// (sometimes "*" or "-"), so every bullet marker is normalized to the
// same dot rather than trusting the model's exact character choice.
function renderCapiInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map(function (part, i) {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={keyPrefix + '-' + i}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function renderCapiMessage(text) {
  return text.split('\n').map(function (line, li) {
    var bulletMatch = line.match(/^(\s*)[•*-]\s+(.*)/)
    if (bulletMatch) {
      var nested = bulletMatch[1].length > 0
      return (
        <div key={li} className={'chat-bullet-line' + (nested ? ' nested' : '')}>
          <span className="chat-bullet-dot">•</span>
          <span>{renderCapiInline(bulletMatch[2], li)}</span>
        </div>
      )
    }
    if (line.trim() === '') return <div key={li} className="chat-line-gap" />
    return <div key={li}>{renderCapiInline(line, li)}</div>
  })
}

export default function ChatWidget({ user, getToken }) {
  const [open, setOpen] = useState(false)
  const [showTeaser, setShowTeaser] = useState(false)
  const [messages, setMessages] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef(null)

  const teaserKey = user ? 'vs_capi_teased_' + user.id : null

  useEffect(
    function () {
      if (!user || !teaserKey) return
      if (localStorage.getItem(teaserKey)) return
      var t = setTimeout(() => setShowTeaser(true), 2000)
      return () => clearTimeout(t)
    },
    [user]
  )

  function dismissTeaser() {
    setShowTeaser(false)
    if (teaserKey) localStorage.setItem(teaserKey, '1')
  }

  function toggleOpen() {
    dismissTeaser()
    setOpen((o) => !o)
  }

  useEffect(
    function () {
      if (!open || historyLoaded) return
      fetch('/api/chat/history', { headers: { Authorization: 'Bearer ' + getToken() } })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => {
          setMessages(
            (rows || []).map((r) => ({ role: r.role, content: r.content }))
          )
          setHistoryLoaded(true)
        })
        .catch(() => setHistoryLoaded(true))
    },
    [open]
  )

  useEffect(
    function () {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    },
    [messages, sending]
  )

  function send() {
    var text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages((prev) => prev.concat([{ role: 'user', content: text }]))
    setSending(true)
    fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ message: text }),
    })
      .then((r) => r.json())
      .then((d) => {
        setMessages((prev) => prev.concat([{ role: 'assistant', content: d.reply || "Sorry, something went wrong." }]))
      })
      .catch(() => {
        setMessages((prev) => prev.concat([{ role: 'assistant', content: "Sorry, I couldn't send that — try again." }]))
      })
      .finally(() => setSending(false))
  }

  function clearChat() {
    setMessages([])
    fetch('/api/chat/history', { method: 'DELETE', headers: { Authorization: 'Bearer ' + getToken() } }).catch(() => {})
  }

  if (!user) return null

  return (
    <div className="chat-widget">
      {showTeaser && !open && (
        <div className="chat-teaser">
          <button className="chat-teaser-close" onClick={dismissTeaser} aria-label="Dismiss">×</button>
          <span>Hi, I&apos;m Capi 👋 Ask me anything about Capital Flow.</span>
        </div>
      )}

      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chat with Capi">
          <div className="chat-panel-header">
            <div className="chat-panel-title">
              <img src="/icon-192.png" alt="" className="chat-avatar" />
              Capi
            </div>
            <div className="chat-panel-actions">
              <button className="chat-clear-btn" onClick={clearChat} title="Clear chat">Clear</button>
              <button className="chat-panel-close" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
            </div>
          </div>
          <div className="chat-panel-body" ref={listRef}>
            {messages.length === 0 && historyLoaded && (
              <div className="chat-empty">Ask me about scan types, tiers, alerts, or anything else about Capital Flow.</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={'chat-bubble ' + m.role}>
                {m.role === 'assistant' ? renderCapiMessage(m.content) : m.content}
              </div>
            ))}
            {sending && (
              <div className="chat-bubble assistant chat-typing">
                <span /><span /><span />
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
                if (e.key === 'Enter') send()
              }}
              maxLength={2000}
            />
            <button onClick={send} disabled={sending || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <button className="chat-fab" onClick={toggleOpen} aria-label={open ? 'Close chat' : 'Open chat with Capi'}>
        <img src="/icon-192.png" alt="" />
      </button>
    </div>
  )
}
