const STEPS: { title: string; body: string }[] = [
  {
    title: "Name a desire",
    body: "Describe it as already done. The app composes your “living in the end” scene from Neville's own corpus — a moment to inhabit until it feels natural.",
  },
  {
    title: "Receive today's process",
    body: "Each day, a fresh practice is drawn for you: a state to assume, a SATS bedtime session, a revision, mental-diet reminders, a sign to watch for, and one concrete next step. Personalised to your desire and recent log, with sources cited from Neville's books.",
  },
  {
    title: "Log your inner work",
    body: "Record your sessions, felt states, and the signs you notice. Bridges of incident surface on their own timeline, and a streak keeps your daily consistency in view.",
  },
  {
    title: "Ask the coach",
    body: "Question anything — it answers only from Neville's teaching, never beyond it.",
  },
  {
    title: "Mark it realised",
    body: "When the world rearranges to match your assumption and it comes to pass, claim it as done.",
  },
];

export default function Onboarding({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
      <h3 className="serif text-lg text-[var(--color-gold)]">How it works</h3>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Assume the feeling of the wish fulfilled — and be guided, in Neville's own teaching, until
        it is realised.
      </p>

      <ol className={`relative ml-1 border-l border-[var(--color-line)] pl-5 ${compact ? "mt-4 space-y-3" : "mt-6 space-y-5"}`}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative">
            <span className="absolute -left-[1.6rem] top-1 grid h-5 w-5 place-items-center rounded-full border border-[var(--color-base)] bg-[var(--color-gold)] text-[0.7rem] font-medium text-[var(--color-base)] shadow-[0_0_8px_var(--color-gold)]">
              {i + 1}
            </span>
            <p className="serif text-[var(--color-accent)]">{step.title}</p>
            {!compact && (
              <p className="mt-0.5 text-sm leading-relaxed text-[#ddd8ef]">{step.body}</p>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-6 border-t border-[var(--color-line)] pt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        <span className="text-[var(--color-gold-dim)]">Daily rhythm:</span> read the practice at
        night — SATS is a bedtime exercise — then log the next morning and generate a fresh process.
        One process per day; it rolls at midnight.
      </p>

      <p className="mt-4 text-sm text-[var(--color-muted)]">Name your first desire above to begin.</p>
    </div>
  );
}
