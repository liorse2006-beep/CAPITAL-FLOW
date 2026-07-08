import { useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

// Shared push-subscribe flow — used by both the Watchlist settings toggle
// and the post-login auto-prompt, so there's exactly one place that talks
// to the Push API and /api/push/*.
function urlBase64ToUint8Array(base64String) {
  var padding = "=".repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  var raw = window.atob(base64);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function usePushSubscription() {
  const { getToken } = useAuth()
  var pushSupported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState(null)

  const checkSubscribed = useCallback(function() {
    if (!pushSupported) return Promise.resolve(false)
    return navigator.serviceWorker.ready
      .then(function(reg) { return reg.pushManager.getSubscription(); })
      .then(function(sub) { setPushEnabled(!!sub); return !!sub; })
      .catch(function() { return false; })
  }, [pushSupported])

  const enablePush = useCallback(function() {
    setPushBusy(true)
    setPushError(null)
    return Notification.requestPermission()
      .then(function(perm) {
        if (perm !== "granted") throw new Error("Notification permission denied")
        return fetch("/api/push/vapid-public-key")
      })
      .then(function(r) { return r.json(); })
      .then(function(d) { return navigator.serviceWorker.ready.then(function(reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(d.key) });
      }); })
      .then(function(sub) {
        return fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
          body: JSON.stringify(sub),
        });
      })
      .then(function() { setPushEnabled(true); })
      .catch(function(e) { setPushError(e.message || "Could not enable notifications"); throw e; })
      .finally(function() { setPushBusy(false); })
  }, [getToken])

  const disablePush = useCallback(function() {
    setPushBusy(true)
    return navigator.serviceWorker.ready
      .then(function(reg) { return reg.pushManager.getSubscription(); })
      .then(function(sub) {
        if (!sub) return
        return fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).then(function() { return sub.unsubscribe(); })
      })
      .then(function() { setPushEnabled(false); })
      .catch(function() {})
      .finally(function() { setPushBusy(false); })
  }, [getToken])

  return { pushSupported, pushEnabled, pushBusy, pushError, checkSubscribed, enablePush, disablePush }
}
