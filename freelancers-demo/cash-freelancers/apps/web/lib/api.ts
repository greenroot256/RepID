/**
 * Typed fetch client for the Fastify API.
 *
 * Requests go to `/api/*` on this same origin; `next.config.js` rewrites that
 * to the API process. Going through the rewrite rather than calling the API's
 * port directly is what keeps the browser same-origin, so no CORS preflight and
 * no Access-Control headers are involved anywhere.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the session is missing, expired or rejected: sign in again. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

const TOKEN_STORAGE_KEY = "cash-freelancers:token";

/**
 * The session token is a bearer credential, so it lives in localStorage to
 * survive a reload. That is a deliberate trade-off: it is readable by any
 * script on the origin, which is why the API is the only thing that decides
 * what a token may do — the UI hides actions, but every one of them is
 * re-authorised server-side.
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token === null) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  else window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/**
 * The API returns two different error bodies and the client has to cope with
 * both: routes with a try/catch send `{ error: string }`, while Fastify's own
 * serializer (unhandled 500s, and 400/415 from the body parser) sends
 * `{ statusCode, code, error, message }`. Without this, a 415 from a missing
 * content-type would surface as a generic failure instead of something a user
 * can act on.
 */
function readErrorMessage(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string" && record.error !== "Internal Server Error") {
      return record.error;
    }
    if (typeof record.message === "string") return record.message;
  }
  return `Request failed with status ${status}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, anonymous = false, signal } = options;

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (!anonymous) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  // 204 No Content: the API uses it for the routes that only mutate state
  // (logout, RepID link, first co-signature). There is nothing to parse, and
  // calling .json() on an empty body throws.
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    // A 401 means the stored token is no longer usable. Dropping it here stops
    // every subsequent request from replaying a dead credential.
    if (response.status === 401) setToken(null);
    throw new ApiError(response.status, readErrorMessage(response.status, parsed));
  }

  return parsed as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T,>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T,>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    apiFetch<T>(path, { ...opts, method: "POST", body }),
  del: <T,>(path: string, opts: RequestOptions = {}) => apiFetch<T>(path, { ...opts, method: "DELETE" })
};
