// HTTP client for the Neville web server's JSON API (routes/api/*).
//
// Set EXPO_PUBLIC_API_URL to your dev machine's LAN address, e.g.
//   EXPO_PUBLIC_API_URL=http://192.168.1.20:5173
// A phone cannot reach "localhost" — that points at the phone itself.
import type {
  Goal,
  Entry,
  Process,
  GoalBundle,
  ChatMsg,
} from "./types";

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:5173";

// --- Auth token (module-level) ---
// The auth provider hydrates this from SecureStore on launch and updates it on
// sign in / sign out. Every request below attaches it as a Bearer header.
let authToken: string | null = null;

export function setAuthToken(t: string | null) {
  authToken = t;
}

// Shape returned by the auth/profile endpoints. Defined in lib/auth.tsx and
// re-imported here to keep a single source of truth.
import type { User } from "./auth";
export type { User };

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra as Record<string, string> | undefined),
  };
  if (authToken) h["Authorization"] = `Bearer ${authToken}`;
  return h;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: authHeaders(init?.headers),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `HTTP ${res.status}`);
  return data as T;
}

// --- Goals ---
export const listGoals = () => req<Goal[]>("/api/goals");

export const createGoal = (title: string, desire: string) =>
  req<Goal>("/api/goals", { method: "POST", body: JSON.stringify({ title, desire }) });

export const getGoalBundle = (id: number) => req<GoalBundle>(`/api/goals/${id}`);

export const generateProcess = (id: number) =>
  req<Process>(`/api/goals/${id}`, {
    method: "POST",
    body: JSON.stringify({ intent: "process" }),
  });

export const regenerateEndScene = (id: number) =>
  req<{ ok: boolean; scene: string }>(`/api/goals/${id}`, {
    method: "POST",
    body: JSON.stringify({ intent: "endscene" }),
  });

export const setGoalStatus = (id: number, status: string) =>
  req<{ ok: boolean }>(`/api/goals/${id}`, {
    method: "POST",
    body: JSON.stringify({ intent: "status", status }),
  });

export const deleteGoal = (id: number) =>
  req<{ ok: boolean }>(`/api/goals/${id}`, { method: "DELETE" });

// --- Entries ---
export const listEntries = (goalId: number, q = "", kind = "") => {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (kind) qs.set("kind", kind);
  const suffix = qs.toString() ? `?${qs}` : "";
  return req<Entry[]>(`/api/goals/${goalId}/entries${suffix}`);
};

export const addEntry = (goalId: number, kind: string, content: string, state?: string) =>
  req<Entry>(`/api/goals/${goalId}/entries`, {
    method: "POST",
    body: JSON.stringify({ kind, content, state }),
  });

export const updateEntry = (
  goalId: number,
  entryId: number,
  content: string,
  state?: string | null
) =>
  req<Entry>(`/api/goals/${goalId}/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ content, state }),
  });

export const deleteEntry = (goalId: number, entryId: number) =>
  req<{ ok: boolean }>(`/api/goals/${goalId}/entries/${entryId}`, { method: "DELETE" });

// --- Coach chat (streaming) ---
// Streams plain-text tokens. expo/fetch (the SDK 56 default global fetch)
// supports response.body as a ReadableStream.
export async function* streamCoach(
  goalId: number,
  message: string,
  history: ChatMsg[]
): AsyncGenerator<string> {
  const res = await fetch(`${API_URL}/api/coach`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ goalId, message, history }),
  });
  if (!res.body) {
    // Fallback: no streaming available — yield the whole body once.
    yield await res.text();
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield dec.decode(value, { stream: true });
  }
}

export const clearChat = (goalId: number) =>
  fetch(`${API_URL}/api/coach`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ goalId, clear: true }),
  });

// --- Auth ---
export const signup = (email: string, password: string, name?: string) =>
  req<{ user: User; token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
  });

export const login = (email: string, password: string) =>
  req<{ user: User; token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logout = () =>
  req<{ ok: true }>("/api/auth/logout", { method: "POST" });

export const me = () => req<{ user: User }>("/api/auth/me");

// --- Profile ---
export const updateProfile = (patch: { name?: string; avatar?: string }) =>
  req<{ user: User }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const changePassword = (current: string, next: string) =>
  req<{ ok: true }>("/api/profile/password", {
    method: "POST",
    body: JSON.stringify({ current, next }),
  });

export { ApiError };
