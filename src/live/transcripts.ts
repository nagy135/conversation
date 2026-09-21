import type { ServerEvent, Transcript } from "./types";

/** Keep both speakers' timestamped fragments: overlapping speech is not a turn boundary. */
export class LiveTranscripts {
  private readonly fragments = new Map<string, Transcript>();
  entries: Transcript[] = [];

  append(event: ServerEvent): void {
    if (
      typeof event.delta !== "string" ||
      !Number.isFinite(event.start_ms) ||
      !Number.isFinite(event.end_ms) ||
      event.end_ms! < event.start_ms!
    )
      return;
    const role =
      event.type === "session.input_transcript.delta" ? "user" : "assistant";
    const key =
      event.event_id ||
      JSON.stringify([role, event.start_ms, event.end_ms, event.delta]);
    if (this.fragments.has(key)) return;
    this.fragments.set(key, {
      id: key,
      role,
      text: event.delta,
      startMs: event.start_ms!,
      endMs: event.end_ms!,
    });
    if (this.fragments.size > 2000)
      this.fragments.delete(this.fragments.keys().next().value!);
    const groups: Transcript[] = [];
    for (const speaker of ["user", "assistant"] as const) {
      let group: Transcript | undefined;
      const fragments = [...this.fragments.values()]
        .filter((part) => part.role === speaker)
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
      for (const part of fragments) {
        // Caption grouping never gates audio. Ambiguous same-utterance confirmations fail closed.
        if (!group || part.startMs - group.endMs > 1200) {
          group = { ...part, id: `${speaker}-${part.startMs}` };
          groups.push(group);
        } else {
          group.text += part.text;
          group.endMs = Math.max(group.endMs, part.endMs);
        }
      }
    }
    this.entries = groups.sort((a, b) => a.startMs - b.startMs).slice(-100);
  }

  latestUser() {
    const last = this.entries.filter((entry) => entry.role === "user").at(-1);
    return {
      sequence: last ? last.startMs + 1 : 0,
      text: last?.text || "",
      endMs: last?.endMs ?? -1,
    };
  }
}
