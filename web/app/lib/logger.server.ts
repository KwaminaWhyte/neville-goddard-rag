// Minimal structured logger. Everything runs locally, so stdout is the sink —
// the point is that swallowed failures (chat persistence, drift checks, cache
// writes) leave a trace instead of vanishing into an empty `catch {}`.
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) || "info"] ?? LEVELS.info;

function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const line: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...extra,
  };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (scope: string, msg: string, extra?: Record<string, unknown>) =>
    emit("debug", scope, msg, extra),
  info: (scope: string, msg: string, extra?: Record<string, unknown>) =>
    emit("info", scope, msg, extra),
  warn: (scope: string, msg: string, extra?: Record<string, unknown>) =>
    emit("warn", scope, msg, extra),
  error: (scope: string, msg: string, extra?: Record<string, unknown>) =>
    emit("error", scope, msg, extra),
};

// For the many best-effort paths: log the failure, return a fallback, never throw.
export async function bestEffort<T>(
  scope: string,
  what: string,
  p: Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await p;
  } catch (e) {
    log.warn(scope, `${what} failed`, { error: (e as Error).message });
    return fallback;
  }
}
