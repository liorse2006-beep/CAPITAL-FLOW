// Capi — the general in-app help assistant. Deliberately scoped to product
// questions only (how the app works, what each tier includes); it has no
// access to any user's account data, so it must never guess at
// account-specific answers ("how many scans do I have left") — the system
// prompt tells it to say so plainly instead of making something up, the
// same honesty rule the news feature follows.

const db = require('../db');
const { GOOGLE_AI_STUDIO_KEY } = require('../config');

const MODEL = 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

// Free-tier Gemini quota is shared across every user of the app — this cap
// stays comfortably under it so one heavy day doesn't lock everyone out.
const DAILY_CALL_CAP = 1200;
let callCount = 0;
let callCountDate = null;

function withinDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (callCountDate !== today) {
    callCountDate = today;
    callCount = 0;
  }
  return callCount < DAILY_CALL_CAP;
}

const SYSTEM_PROMPT = `You are Capi, the friendly in-app assistant for Capital Flow, a stock trading volume-scanner web app.

What Capital Flow does:
- Capital Flow: scans S&P 500 / NASDAQ 100 / by-sector for unusual trading volume (a stock trading well above its average volume).
- Hot Sectors: a sector-by-sector money-flow heatmap showing which sectors are seeing inflow/outflow.
- MA Scanner: finds stocks trading near a chosen moving average (SMA9/20/50/150), daily or weekly.
- Watchlist: users star tickers to track them, can set a volume-ratio alert threshold per ticker, and (Elite) get push notifications and a daily scheduled scan summary.
- Every result row has a Chart button (opens TradingView), an Alert button (set a volume-ratio threshold), and a News button (scans recent verified news for that specific ticker).

Tiers:
- Free: unlimited scans for the first 7 days after signup, then locked until upgrading.
- Premium ($14.90 one-time): 5 scans per rolling 24 hours across all scan types, advanced filters, charts.
- Elite ($29.90 one-time): unlimited scans, push notifications, daily scheduled scans, custom watchlist alerts, and news scanning.

Rules you must follow:
- You have NO access to any specific user's account, subscription status, scan history, or usage counts. If asked something account-specific ("how many scans do I have left", "am I on Elite"), say plainly that you can't see their account and point them to the topbar/upgrade screen or support — never guess or make up a number.
- Never give financial or investment advice, or an opinion on whether a stock is a good buy — Capital Flow is informational only. Redirect those questions back to using the scanner's own data.
- Keep answers short and conversational — this is a small chat widget, not a document.
- If you don't know something about the app, say so honestly instead of inventing an answer.`;

function extractText(data) {
  if (data.output_text) return data.output_text;
  if (!Array.isArray(data.steps)) return null;
  for (const step of data.steps) {
    if (step.type === 'model_output' && Array.isArray(step.content)) {
      for (const part of step.content) {
        if (part.type === 'text' && part.text) return part.text;
      }
    }
  }
  return null;
}

async function callGemini(userMessage, previousInteractionId) {
  const body = { model: MODEL, input: userMessage };
  if (previousInteractionId) {
    body.previous_interaction_id = previousInteractionId;
  } else {
    body.system_instruction = SYSTEM_PROMPT;
  }
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GOOGLE_AI_STUDIO_KEY,
      'Content-Type': 'application/json',
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = extractText(data);
  if (!text) return null;
  return { text, interactionId: data.id };
}

/** Never throws — always returns a user-facing string, even on failure. */
async function askCapi(userId, userMessage) {
  if (!GOOGLE_AI_STUDIO_KEY) {
    return "I'm not switched on yet — the team hasn't finished setting me up.";
  }
  if (!withinDailyCap()) {
    return "I'm getting a lot of questions right now — please try again in a bit.";
  }

  try {
    const row = await db.prepare('SELECT gemini_interaction_id FROM users WHERE id = ?').get(userId);
    const previousId = row ? row.gemini_interaction_id : null;

    callCount++;
    let result = await callGemini(userMessage, previousId);
    if (!result && previousId) {
      // The stored interaction id may have expired — retry as a fresh conversation.
      result = await callGemini(userMessage, null);
    }
    if (!result) {
      return "Sorry, I couldn't reach my brain just now — try again in a moment.";
    }

    await db.prepare('UPDATE users SET gemini_interaction_id = ? WHERE id = ?').run(result.interactionId, userId);
    return result.text;
  } catch (e) {
    return "Sorry, I couldn't reach my brain just now — try again in a moment.";
  }
}

module.exports = { askCapi };
