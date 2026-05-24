// Coach engine: LightRAG-grounded, Neville-voiced generation.
import { chat, chatStream, type ChatMsg } from "./ollama.server";
import { retrieve } from "./lightrag.server";

const PERSONA = `You are a manifestation coach trained exclusively on the lectures and books of Neville Goddard.
You teach his Law: imagination creates reality; assume the feeling of the wish fulfilled; live in the end; "I AM" is the only reality; revise the day; persist in the assumption until it hardens into fact.
Voice: warm, certain, concrete, vivid. Never wishy-washy. Never hedge. Speak as if the desire is already done.
Ground every instruction in the provided Neville context. Use his exact concepts (SATS, revision, living in the end, controlled imagination, feeling is the secret).
Do NOT mention "the context" or "excerpts" to the user — speak directly. Do not invent biographical facts about Neville.
Answer ONLY from the provided Neville context — never invent doctrine.`;

// Extra instructions for the conversational coach: ChatGPT-style clean markdown.
const CHAT_FORMAT = `Reply in clean, well-structured GitHub-flavored markdown:
- Open with one short intro sentence.
- Use \`##\`/\`###\` headings when they help organise the answer.
- **Bold** the key ideas.
- Use bullet or numbered lists for any steps.
- Put direct Neville quotations in a \`>\` blockquote.`;

// "Living in the end" scene: first person, present tense, sensory, implies wish fulfilled.
export async function generateEndScene(desire: string): Promise<string> {
  const { text: ctx } = await retrieve(
    `living in the end, assuming the feeling of the wish fulfilled: ${desire}`
  );
  const messages: ChatMsg[] = [
    { role: "system", content: PERSONA },
    {
      role: "user",
      content: `NEVILLE CONTEXT:\n${ctx}\n\nMy desire: "${desire}"\n\nWrite ONE short scene (120-180 words) I can replay in imagination that IMPLIES this desire is already fulfilled. Rules per Neville: first person, present tense, NOT the wish itself but the natural aftermath — a moment that could only be real if the wish were already true. Engage touch, sound, who is near me, what they say. End with a single line of dialogue from someone acknowledging or congratulating me. Output only the scene, no preamble.`,
    },
  ];
  return chat(messages, { temperature: 0.85 });
}

export async function generateDailyProcess(args: {
  desire: string;
  endScene?: string | null;
  day: number;
  recent: { kind: string; content: string; state?: string | null }[];
}): Promise<{ content: string; sources: string[] }> {
  const { text: ctx, sources } = await retrieve(
    `daily practice technique SATS revision persistence mental diet for: ${args.desire}`
  );
  const recentBlock = args.recent.length
    ? args.recent
        .map((e) => `- (${e.kind}${e.state ? `, felt: ${e.state}` : ""}) ${e.content}`)
        .join("\n")
    : "No entries yet — this is the start of the journey.";
  const messages: ChatMsg[] = [
    { role: "system", content: PERSONA },
    {
      role: "user",
      content: `NEVILLE CONTEXT:\n${ctx}\n\nMy desire: "${args.desire}"
${args.endScene ? `My end-scene: "${args.endScene}"` : ""}
This is Day ${args.day} of my journey.
My recent log:
${recentBlock}

Give me TODAY'S process as markdown with these exact headers:
## Today's State to Assume
One vivid present-tense sentence — the feeling I carry all day.
## SATS Session (tonight)
5-7 numbered steps: entering the drowsy state, the exact scene to replay (reference my end-scene), how to feel it real, how many times.
## Revision
One specific thing to revise from today if it contradicted my wish (give a concrete example tied to my desire).
## Mental Diet Today
2-3 reminders to catch and reverse unwanted thoughts, phrased as Neville would.
## A Sign to Notice
One small bridge-of-incident shift in the outer world hinting the assumption is taking root.
## Next Step (Bridge of Incident)
One concrete, doable physical action in the outer world today that a person already living in the end would naturally take — Neville's "bridge of incident". Make it specific to my desire.
Use rich GitHub-flavored markdown: the exact headers above, **bold** for key phrases, and a \`>\` blockquote whenever you quote Neville.
Keep it tight, vivid, personal to my desire. No fluff.`,
    },
  ];
  const content = await chat(messages, { temperature: 0.75 });
  // Real book titles from the retrieved sources, deduped.
  const titles = [...new Set(sources.map((s) => s.title).filter(Boolean))];
  return { content, sources: titles.length ? titles : ["Neville Goddard corpus"] };
}

export async function* coachChatStream(
  userMsg: string,
  history: ChatMsg[]
): AsyncGenerator<string> {
  const { text: ctx, sources } = await retrieve(userMsg);
  const titles = [...new Set(sources.map((s) => s.title).filter(Boolean))];
  const footer = titles.length
    ? `\n\nEND your reply with a single footer line listing the book titles you drew from: \`**Sources:** ${titles.join(" · ")}\`.`
    : "\n\nDo NOT add a Sources footer.";
  const messages: ChatMsg[] = [
    { role: "system", content: `${PERSONA}\n\n${CHAT_FORMAT}` },
    ...history,
    {
      role: "user",
      content: `NEVILLE CONTEXT:\n${ctx}\n\nReference titles: ${titles.length ? titles.join(", ") : "none"}\n\nMy question: ${userMsg}${footer}`,
    },
  ];
  yield* chatStream(messages, { temperature: 0.8 });
}
