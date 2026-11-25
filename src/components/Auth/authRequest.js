export const AUTH_REQUEST_TIMEOUT_MS = 30000;

const SAFE_ERRORS = new Map([
  ['Invalid email or password', 'כתובת האימייל או הסיסמה שגויה. אפשר לנסות שוב.'],
  ['An account with this email already exists', 'כתובת האימייל כבר רשומה. אפשר להתחבר.'],
  ['Please enter a valid email address', 'יש להזין כתובת אימייל תקינה.'],
  ['Invalid email address', 'יש להזין כתובת אימייל תקינה.'],
  ['Password must be at least 8 characters', 'יש לבחור סיסמה באורך 15 תווים לפחות.'],
  ['Password must be at least 15 characters', 'יש לבחור סיסמה באורך 15 תווים לפחות.'],
  ['Password must be at most 72 UTF-8 bytes', 'הסיסמה ארוכה מדי. יש לבחור סיסמה קצרה יותר.'],
  ['Choose a less common password', 'יש לבחור סיסמה פחות נפוצה, למשל משפט ייחודי.'],
  ['Invalid or expired code', 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.'],
  ['Invalid code', 'הקוד שגוי. אפשר לנסות שוב.'],
  ['Code expired', 'פג תוקף הקוד. אפשר לבקש קוד חדש.'],
  ['No code found', 'פג תוקף הקוד. אפשר לבקש קוד חדש.'],
  ['Code already used', 'הקוד כבר שימש לאימות. יש לבקש קוד חדש.'],
  [
    'Too many code attempts. Request a new code and try again later.',
    'בוצעו ניסיונות רבים מדי. יש להמתין ולבקש קוד חדש.',
  ],
  ['CAPTCHA verification failed', 'האימות נכשל או שפג תוקפו. יש לבצע אימות מחדש.'],
]);
const REQUEST_FAILED = 'לא הצלחנו להשלים את הבקשה. אפשר לנסות שוב.';
function userError(message) {
  return Object.assign(new Error(message), { isAuthUserError: true });
}

export async function authRequest(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== 'object') {
      const message =
        response.status === 429
          ? 'בוצעו ניסיונות רבים מדי. יש להמתין כמה דקות ולנסות שוב.'
          : SAFE_ERRORS.get(data?.error) || REQUEST_FAILED;
      const error = userError(message);
      error.needsVerification = response.status === 403 && data?.needsVerification === true;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw userError('הבקשה נמשכה זמן רב מדי. אפשר לנסות שוב.');
    if (error?.isAuthUserError) throw error;
    throw userError('לא הצלחנו להתחבר. יש לבדוק את החיבור ולנסות שוב.');
  } finally {
    clearTimeout(timeout);
  }
}
