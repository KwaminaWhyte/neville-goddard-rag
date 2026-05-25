import type { Route } from "./+types/coach";
import { coachChatStream } from "../../lib/coach.server";
import type { ChatMsg } from "../../lib/ollama.server";
import { addChat, clearChats, getGoal } from "../../lib/db.server";
import { requireUser } from "../../lib/auth.server";
import { json, preflight } from "../../lib/api.server";

// Streams the coach reply as plain text chunks, persisting both sides of the
// exchange to the chat history.
export async function action({ request }: Route.ActionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const { goalId, message, history, clear } = (await request.json()) as {
    goalId?: number;
    message?: string;
    history?: ChatMsg[];
    clear?: boolean;
  };

  // The coach only ever operates on a goal the caller owns.
  if (typeof goalId === "number") {
    const goal = await getGoal(goalId, user.id);
    if (!goal) return json({ error: "forbidden" }, 403);
  }

  // Clearing chat history is a tiny non-streaming op.
  if (clear === true) {
    if (typeof goalId === "number") {
      try {
        await clearChats(goalId);
      } catch {
        // Don't fail the request on a DB hiccup.
      }
    }
    return new Response("", { status: 200 });
  }

  // Persist the user's message before we start streaming the reply.
  if (typeof goalId === "number" && message) {
    try {
      await addChat(goalId, "user", message);
    } catch {
      // best-effort; never block the stream on persistence
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const tok of coachChatStream(message ?? "", history ?? [])) {
          fullText += tok;
          controller.enqueue(encoder.encode(tok));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n[the coach fell silent: ${(e as Error).message}]`));
      }
      // Persist the accumulated assistant reply (best-effort).
      if (typeof goalId === "number" && fullText) {
        try {
          await addChat(goalId, "assistant", fullText);
        } catch {
          // never crash the response on a DB write failure
        }
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
