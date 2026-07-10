// Checkout (Paddle) — fully opt-in, same no-op-without-a-key contract as
// src/sentry.js and src/analytics.js. Paddle.js isn't an npm package (it's
// a global script Paddle hosts), so this loads it via a <script> tag rather
// than a dynamic import, only when VITE_PADDLE_CLIENT_TOKEN is set.
const CLIENT_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN || '';
const ENV = import.meta.env.VITE_PADDLE_ENV === 'production' ? 'production' : 'sandbox';
const enabled = !!CLIENT_TOKEN;

// Paddle only accepts a single eventCallback for the whole SDK instance
// (set once at Initialize), so every open checkout's listener is fanned
// out from here rather than passed directly to Paddle.
let currentListener = null;

let loadPromise = null;
function loadPaddleScript() {
  if (!enabled) return Promise.resolve(null);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.Paddle) return resolve(window.Paddle);
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.onload = () => {
      if (ENV === 'sandbox') window.Paddle.Environment.set('sandbox');
      window.Paddle.Initialize({
        token: CLIENT_TOKEN,
        eventCallback: (event) => {
          if (currentListener) currentListener(event);
        },
      });
      resolve(window.Paddle);
    };
    script.onerror = () => reject(new Error('Failed to load Paddle.js'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

if (enabled) loadPaddleScript();

/** Opens Paddle's hosted checkout overlay against a transaction the backend
 * already created (see server/routes/checkout.js) — that's what lets a
 * coupon discount and the signed-in user both carry through to the actual
 * charge. Resolves with { completed: boolean } once the overlay closes;
 * `completed` reflects Paddle's own client-side signal only — the tier
 * upgrade itself lands via the server-side webhook a moment later, so the
 * caller should still re-check the user's tier rather than trust this
 * alone. */
async function openCheckout({ transactionId }) {
  const Paddle = await loadPaddleScript();
  if (!Paddle) throw new Error('Paddle is not configured');

  return new Promise((resolve) => {
    let completed = false;
    currentListener = (event) => {
      if (event.name === 'checkout.completed') completed = true;
      if (event.name === 'checkout.closed') {
        currentListener = null;
        resolve({ completed });
      }
    };
    Paddle.Checkout.open({ transactionId, settings: { displayMode: 'overlay' } });
  });
}

export { enabled, loadPaddleScript, openCheckout };
