import React, { useEffect, useState } from 'react'
import usePushSubscription from '../../hooks/usePushSubscription'

// Auto-prompts Elite users for push permission right after login, instead of
// only surfacing it as a toggle buried in Watchlist settings. Fires at most
// once per account per device — "Not now" is remembered the same as
// "Enable" so it never nags on every visit.
export default function PushPermissionPrompt({ user }) {
  const { pushSupported, pushBusy, enablePush } = usePushSubscription()
  const [dismissed, setDismissed] = useState(false)

  const isElite = !!(user && user.tier === 'elite')
  const storageKey = user ? 'vs_push_prompted_' + user.id : null

  const [alreadyPrompted, setAlreadyPrompted] = useState(true)
  useEffect(function() {
    if (!storageKey) return
    setAlreadyPrompted(!!localStorage.getItem(storageKey))
  }, [storageKey])

  const canShow = isElite
    && pushSupported
    && typeof Notification !== 'undefined'
    && Notification.permission === 'default'
    && !alreadyPrompted
    && !dismissed

  if (!canShow) return null

  function markPrompted() {
    if (storageKey) localStorage.setItem(storageKey, '1')
    setDismissed(true)
  }

  function handleEnable() {
    enablePush().catch(function() {}).finally(markPrompted)
  }

  return React.createElement('div', { className: 'upgrade-overlay', onClick: markPrompted },
    React.createElement('div', { className: 'upgrade-modal', onClick: function(e) { e.stopPropagation(); } },
      React.createElement('div', { className: 'push-prompt-logo' },
        React.createElement('div', { className: 'logo-mark' },
          React.createElement('div', { className: 'logo-bar' }),
          React.createElement('div', { className: 'logo-bar' }),
          React.createElement('div', { className: 'logo-bar' })
        )
      ),
      React.createElement('h2', { className: 'upgrade-title' }, 'Never miss a move'),
      React.createElement('p', { className: 'upgrade-desc' },
        'Get notified the instant a stock crosses your threshold — even with the app closed. Turn on push notifications now?'
      ),
      React.createElement('button', {
        className: 'upgrade-cta',
        onClick: handleEnable,
        disabled: pushBusy,
      }, pushBusy ? 'Enabling…' : 'Enable Notifications'),
      React.createElement('p', { className: 'upgrade-sub' },
        React.createElement('a', { href: '#', onClick: function(e) { e.preventDefault(); markPrompted(); } }, 'Not now')
      )
    )
  )
}
