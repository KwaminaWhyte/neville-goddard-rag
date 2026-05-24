import type { Route } from "./+types/api.coach";
import { coachChatStream } from "../lib/coach.server";
import type { ChatMsg } from "../lib/ollama.server";

// Streams the coach reply as plain text chunks.
export async function action({ request }: Route.ActionArgs) {
  const { message, history } = (await request.json()) as {
    message: string;
    history: ChatMsg[];
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const tok of coachChatStream(message, history ?? [])) {
          controller.enqueue(encoder.encode(tok));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n[the coach fell silent: ${(e as Error).message}]`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
