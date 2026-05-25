// Mirrors the server's db.server.ts shapes (JSON over the wire).
export type Goal = {
  id: number;
  title: string;
  desire: string;
  end_scene: string | null;
  status: string; // active | realised | released
  created_at: string;
  realised_at: string | null;
};

export type Entry = {
  id: number;
  goal_id: number;
  kind: string; // checkin | sats | revision | sign | reflection
  content: string;
  state: string | null;
  created_at: string;
};

export type Process = {
  id: number;
  goal_id: number;
  day: number;
  content: string; // markdown
  sources: string[] | null;
  created_at: string;
};

export type EndScene = { id: number; goal_id: number; scene: string; created_at: string };
export type Sign = { id: number; content: string; state: string | null; created_at: string };
export type TrendPoint = { date: string; state: string; kind: string };
export type ChatMsg = { role: "user" | "assistant"; content: string };
export type Streak = { current: number; longest: number; lastEntryDate: string | null };

export type Health = {
  lightrag: { ok: boolean; detail: string };
  ollama: { ok: boolean; detail: string };
  drift: { ok: boolean; message: string | null };
};

// GET /api/goals/:id bundle
export type GoalBundle = {
  goal: Goal;
  day: number;
  process: Process | null;
  streak: Streak;
  endScenes: EndScene[];
  signs: Sign[];
  trend: TrendPoint[];
  chats: ChatMsg[];
  health: Health;
};

export const ENTRY_KINDS = [
  { value: "checkin", label: "Check-in" },
  { value: "sats", label: "SATS" },
  { value: "revision", label: "Revision" },
  { value: "sign", label: "Sign / bridge of incident" },
  { value: "reflection", label: "Reflection" },
] as const;
