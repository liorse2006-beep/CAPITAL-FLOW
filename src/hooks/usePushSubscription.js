import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function waitForOperation(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Notification setup was interrupted. Please try again.'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

// A browser subscription alone is not proof that this account can receive
// push: a restore, revoked registration or account switch can break that link.
export default function usePushSubscription() {
  const { user, getToken } = useAuth();
  const ownerId = user?.id ?? null;
  const ownerRef = useRef(ownerId);
  const operationRef = useRef(null);
  const pushSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const notificationApiSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [state, setState] = useState({ ownerId, enabled: false, busy: false, error: null });
  const [notificationPermission, setNotificationPermission] = useState(() =>
    notificationApiSupported ? Notification.permission : 'unsupported'
  );

  useLayoutEffect(() => {
    ownerRef.current = ownerId;
    return () => {
      ownerRef.current = null;
      operationRef.current?.controller.abort();
    };
  }, [ownerId]);

  useEffect(() => {
    // Reset account-owned delivery state; a new account must reconfirm its
    // device registration before an enabled indicator can be shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ ownerId, enabled: false, busy: false, error: null });
  }, [ownerId]);

  const beginOperation = useCallback(
    (busy = false, timeoutMs = 10000) => {
      const token = getToken();
      if (ownerId == null || ownerRef.current !== ownerId || !token)
        throw new Error('Please sign in to manage notifications.');
      operationRef.current?.controller.abort();
      const controller = new AbortController();
      const operation = { controller, token };
      operationRef.current = operation;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const current = () =>
        ownerRef.current === ownerId && operationRef.current === operation && !controller.signal.aborted;
      setState((previous) => ({
        ownerId,
        enabled: busy && previous.ownerId === ownerId && previous.enabled,
        busy,
        error: null,
      }));
      return {
        token,
        signal: controller.signal,
        current,
        assertCurrent() {
          if (!current()) throw new Error('Notification setup was interrupted. Please try again.');
        },
        finish() {
          clearTimeout(timer);
        },
        update(next) {
          if (ownerRef.current === ownerId && operationRef.current === operation) {
            setState((previous) => ({ ...previous, ownerId, ...next }));
          }
        },
      };
    },
    [getToken, ownerId]
  );

  const checkSubscribed = useCallback(async () => {
    if (notificationApiSupported) setNotificationPermission(Notification.permission);
    if (!pushSupported || !notificationApiSupported || Notification.permission !== 'granted' || ownerId == null) {
      operationRef.current?.controller.abort();
      setState({ ownerId, enabled: false, busy: false, error: null });
      return false;
    }
    let operation;
    try {
      operation = beginOperation();
      const registration = await waitForOperation(navigator.serviceWorker.ready, operation.signal);
      operation.assertCurrent();
      const subscription = await waitForOperation(registration.pushManager.getSubscription(), operation.signal);
      operation.assertCurrent();
      if (!subscription) return false;
      const response = await waitForOperation(
        fetch('/api/push/subscription-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + operation.token },
          body: JSON.stringify(subscription),
          signal: operation.signal,
        }),
        operation.signal
      );
      if (!response.ok) return false;
      const data = await waitForOperation(response.json(), operation.signal);
      operation.assertCurrent();
      const enabled = data?.enabled === true;
      operation.update({ enabled });
      return enabled;
    } catch {
      operation?.update({ enabled: false });
      return false;
    } finally {
      operation?.finish();
    }
  }, [beginOperation, notificationApiSupported, ownerId, pushSupported]);

  const enablePush = useCallback(async () => {
    if (!pushSupported || !notificationApiSupported)
      throw new Error('Push notifications are not supported in this browser.');
    let operation;
    try {
      operation = beginOperation(true, 30000);
      const permission = await waitForOperation(Notification.requestPermission(), operation.signal);
      operation.assertCurrent();
      setNotificationPermission(permission);
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable push.');
      const response = await waitForOperation(
        fetch('/api/push/vapid-public-key', { signal: operation.signal }),
        operation.signal
      );
      if (!response.ok) throw new Error('Push notifications are temporarily unavailable.');
      const data = await waitForOperation(response.json(), operation.signal);
      operation.assertCurrent();
      if (typeof data?.key !== 'string' || !data.key.trim())
        throw new Error('Push notifications are temporarily unavailable.');
      const registration = await waitForOperation(navigator.serviceWorker.ready, operation.signal);
      operation.assertCurrent();
      const subscription = await waitForOperation(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.key),
        }),
        operation.signal
      );
      operation.assertCurrent();
      const saved = await waitForOperation(
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + operation.token },
          body: JSON.stringify(subscription),
          signal: operation.signal,
        }),
        operation.signal
      );
      operation.assertCurrent();
      if (!saved.ok) throw new Error('Could not save notification access. Please try again.');
      operation.update({ enabled: true });
    } catch (error) {
      const message =
        error?.message?.startsWith('Allow notifications') ||
        error?.message?.startsWith('Push notifications') ||
        error?.message?.startsWith('Could not save')
          ? error.message
          : 'Could not enable notifications. Please try again.';
      operation?.update({ enabled: false, error: message });
      throw new Error(message);
    } finally {
      operation?.update({ busy: false });
      operation?.finish();
    }
  }, [beginOperation, notificationApiSupported, pushSupported]);

  const disablePush = useCallback(async () => {
    let operation;
    try {
      operation = beginOperation(true);
      const registration = await waitForOperation(navigator.serviceWorker.ready, operation.signal);
      operation.assertCurrent();
      const subscription = await waitForOperation(registration.pushManager.getSubscription(), operation.signal);
      operation.assertCurrent();
      if (!subscription) {
        operation.update({ enabled: false });
        return;
      }
      const response = await waitForOperation(
        fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + operation.token },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          signal: operation.signal,
        }),
        operation.signal
      );
      operation.assertCurrent();
      if (!response.ok) throw new Error('Could not disable notifications. Please try again.');
      await waitForOperation(subscription.unsubscribe(), operation.signal);
      operation.assertCurrent();
      operation.update({ enabled: false });
    } catch {
      const message = 'Could not disable notifications. Please try again.';
      operation?.update({ error: message });
      throw new Error(message);
    } finally {
      operation?.update({ busy: false });
      operation?.finish();
    }
  }, [beginOperation]);

  const currentState = state.ownerId === ownerId ? state : { enabled: false, busy: false, error: null };
  return {
    pushSupported,
    notificationApiSupported,
    notificationPermission,
    pushEnabled: currentState.enabled,
    pushBusy: currentState.busy,
    pushError: currentState.error,
    checkSubscribed,
    enablePush,
    disablePush,
  };
}
