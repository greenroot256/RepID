/**
 * Server-side fetch for the public, unauthenticated reads.
 *
 * Server Components cannot use the browser's `/api/*` rewrite (that is a
 * browser-facing path) and have no access to the session token in
 * localStorage, so they talk to the API process directly. Only the routes that
 * need no session belong here; anything authenticated must run on the client
 * through `lib/api.ts`.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ServerApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ServerApiError";
    this.status = status;
  }
}

export async function serverGet<T>(path: string, init: { next?: { revalidate?: number } } = {}): Promise<T> {
  const response = await fetch(`${API_INTERNAL_URL}${path}`, {
    // Job listings change as people post, but not by the second; a short
    // revalidation window keeps the board fresh without hammering Postgres.
    next: init.next ?? { revalidate: 15 },
    headers: { accept: "application/json" }
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Request failed with status ${response.status}`;
    throw new ServerApiError(response.status, message);
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
