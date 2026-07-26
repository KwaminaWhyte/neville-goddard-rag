import type { Route } from "./+types/coach";
import { coachChatStream } from "../../lib/coach.server";
import type { ChatMsg } from "../../lib/ollama.server";
import { addChat, clearChats, getGoal, recentChats } from "../../lib/db.server";
import { requireUser } from "../../lib/auth.server";
import { jsonFor, preflight } from "../../lib/api.server";
import { bestEffort, log } from "../../lib/logger.server";

// How much of the stored transcript the coach may see. History is never taken
// from the request body — a client could forge `assistant` turns and talk the
// coach out of its "answer only from the provided Neville context" constraint.
// The cap also bounds the prompt so a long chat can't crowd out the retrieved
// context.
const HISTORY_TURNS = 20;

// Streams the coach reply as plain text chunks, persisting both sides of the
// exchange to the chat history.
export async function action({ request }: Route.ActionArgs) {
  const j = jsonFor(request);
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const { goalId, message, clear } = (await request.json()) as {
    goalId?: number;
    message?: string;
    clear?: boolean;
  };

  // The coach only ever operates on a goal the caller owns.
  if (typeof goalId === "number") {
    const goal = await getGoal(goalId, user.id);
    if (!goal) return j({ error: "forbidden" }, 403);
  }

  // Clearing chat history is a tiny non-streaming op.
  if (clear === true) {
    if (typeof goalId === "number") {
      await bestEffort("api/coach", "clearing chat history", clearChats(goalId), undefined);
    }
    return new Response("", { status: 200 });
  }

  // Load history before persisting this turn, otherwise the new user message
  // would appear twice in the prompt. Without a goalId there's nothing to scope
  // history to, so the coach runs stateless.
  let history: ChatMsg[] = [];
  if (typeof goalId === "number") {
    const rows = await bestEffort(
      "api/coach",
      "loading chat history",
      recentChats(goalId, HISTORY_TURNS),
      []
    );
    history = rows.flatMap((r) =>
      r.role === "user" || r.role === "assistant"
        ? [{ role: r.role, content: r.content } as ChatMsg]
        : []
    );
  }

  // Persist the user's message before we start streaming the reply.
  if (typeof goalId === "number" && message) {
    await bestEffort("api/coach", "persisting user message", addChat(goalId, "user", message), null);
  }

  const encoder = new TextEncoder();
  // Client navigated away (or cancelled the read) → stop burning local GPU on a
  // reply nobody will see.
  const upstream = new AbortController();
  const onClientAbort = () => upstream.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        // goalId also lets the coach ground answers in this user's own journal.
        // Ownership was already checked above, so this leaks nothing.
        for await (const tok of coachChatStream(message ?? "", history, {
          signal: upstream.signal,
          goalId,
        })) {
          fullText += tok;
          controller.enqueue(encoder.encode(tok));
        }
      } catch (e) {
        // A client-initiated cancel is not a failure — never write it into the
        // transcript or the wire.
        if (upstream.signal.aborted) {
          log.info("api/coach", "generation aborted by client", {
            goalId,
            chars: fullText.length,
          });
        } else {
          log.error("api/coach", "coach generation failed", { goalId, error: (e as Error).message });
          controller.enqueue(encoder.encode(`\n[the coach fell silent: ${(e as Error).message}]`));
        }
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
        // Persist whatever was produced (best-effort). A partial reply is worth
        // more than a lost turn, but it gets an italic marker so the markdown
        // transcript doesn't read as a finished answer.
        if (typeof goalId === "number" && fullText) {
          const content = upstream.signal.aborted ? `${fullText}\n\n_(interrupted)_` : fullText;
          await bestEffort(
            "api/coach",
            "persisting assistant reply",
            addChat(goalId, "assistant", content),
            null
          );
        }
        try {
          controller.close();
        } catch {
          // Already closed by a consumer cancel — nothing to do.
        }
      }
    },
    cancel() {
      upstream.abort();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
