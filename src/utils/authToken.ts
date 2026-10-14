// Single source of truth for the Fivepa session token in the browser.
// Every component/hook reads, writes and clears the token through these helpers.
const TOKEN_KEY = 'workperhour_token';
// Legacy key written by older builds. Still read (so existing sessions survive) and always cleared.
const LEGACY_TOKEN_KEY = 'token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {}
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {}
}
