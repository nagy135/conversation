import type { ServerEvent } from "./types";
import { validSessionId, type HistoryMessage } from '../../server/history.ts';

interface TransportCallbacks {
  onSession: (sessionId: string, forked: boolean) => void;
  onEvent: (event: ServerEvent) => void;
  onError: (message: string) => void;
  onAudioBlocked: () => void;
  onSpeaking: (speaking: boolean) => void;
}

/** Owns one WebRTC connection and every browser resource it acquires. */
export class LiveTransport {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAudio: { energy: number; duration: number } | null = null;
  private speaking = false;
  private createdSession: { id: string; forked: boolean } | null = null;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly callbacks: TransportCallbacks,
  ) {}

  async connect(history: HistoryMessage[] = [], sourceSessionId: string | null = null): Promise<void> {
    this.timer = setTimeout(
      () =>
        this.fail(
          "Connection timed out. Check microphone permission and your internet connection, then try again.",
        ),
      45_000,
    );
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access requires localhost or HTTPS and a browser with WebRTC support.",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // Permission can resolve after the user cancels or the component unmounts.
      if (this.closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      stream.getTracks().forEach((track) => {
        peer.addTrack(track, stream);
        track.onended = () =>
          this.fail("Microphone access ended. Reconnect to continue.");
      });
      peer.ontrack = ({ streams, track }) => {
        if (this.closed) return;
        this.audio.srcObject = streams[0] || new MediaStream([track]);
        void this.audio.play().catch(() => {
          if (!this.closed) this.callbacks.onAudioBlocked();
        });
      };
      peer.onconnectionstatechange = () => {
        if (
          ["failed", "disconnected", "closed"].includes(peer.connectionState)
        ) {
          this.fail(
            "The voice connection was interrupted. Press play to continue the conversation.",
          );
        }
      };
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onmessage = (message) => {
        if (this.closed) return;
        try {
          const event = JSON.parse(message.data) as ServerEvent;
          if (event.type === "session.started") {
            this.clearTimer();
            if (this.createdSession) this.callbacks.onSession(this.createdSession.id, this.createdSession.forked);
            void this.observeAudio();
          }
          this.callbacks.onEvent(event);
        } catch {
          this.fail(
            "An unexpected voice event was received. Please reconnect.",
          );
        }
      };
      channel.onclose = () =>
        this.fail("The voice session ended. Press play to continue the conversation.");
      channel.onerror = () =>
        this.fail(
          "The voice connection encountered a problem. Please try again.",
        );
      const offer = await peer.createOffer();
      if (this.closed) return;
      await peer.setLocalDescription(offer);
      await this.waitForIce(peer);
      if (this.closed) return;
      const sdpOffer = peer.localDescription?.sdp;
      if (!sdpOffer)
        throw new Error(
          "The browser did not create an audio connection offer.",
        );
      const response = await fetch("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sdp: sdpOffer, history, sourceSessionId }),
        signal: this.abort.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || "Could not connect to the voice assistant.",
        );
      }
      const result = await response.json();
      const sdp = result.transport?.sdp;
      if (typeof sdp !== "string" || !validSessionId(result.session?.id))
        throw new Error(
          "The voice service returned an invalid connection answer.",
        );
      this.createdSession = { id: result.session.id, forked: result.recovery === 'fork' };
      if (!this.closed)
        await peer.setRemoteDescription({ type: "answer", sdp });
    } catch (cause) {
      this.fail(connectionError(cause));
    }
  }

  send(event: object): void {
    if (!this.closed && this.channel?.readyState === "open")
      this.channel.send(JSON.stringify(event));
  }

  setMuted(muted: boolean): void {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  async resumeAudio(): Promise<void> {
    await this.audio.play();
  }

  silence(): void {
    this.setMuted(true);
    this.audio.pause();
  }

  private waitForIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", changed);
        this.abort.signal.removeEventListener("abort", aborted);
        if (error) reject(error);
        else resolve();
      };
      const changed = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const aborted = () => finish(new Error("Connection cancelled."));
      const timer = setTimeout(
        () =>
          finish(
            new Error("Audio network discovery timed out. Try reconnecting."),
          ),
        10_000,
      );
      peer.addEventListener("icegatheringstatechange", changed);
      this.abort.signal.addEventListener("abort", aborted, { once: true });
      if (this.abort.signal.aborted) aborted();
      else changed();
    });
  }

  /** GPT-Live has no end-of-spoken-response event; measure received audio instead. */
  private async observeAudio(): Promise<void> {
    if (this.closed || !this.peer) return;
    let speaking = false;
    try {
      const stats = await this.peer.getStats();
      stats.forEach((report) => {
        if (report.type !== "inbound-rtp" || report.kind !== "audio") return;
        if (
          typeof report.totalAudioEnergy !== "number" ||
          typeof report.totalSamplesDuration !== "number"
        )
          return;
        const sample = {
          energy: report.totalAudioEnergy,
          duration: report.totalSamplesDuration,
        };
        if (this.lastAudio && sample.duration > this.lastAudio.duration) {
          const level = Math.sqrt(
            Math.max(0, sample.energy - this.lastAudio.energy) /
              (sample.duration - this.lastAudio.duration),
          );
          speaking = level > 0.008 && !this.audio.paused;
        }
        this.lastAudio = sample;
      });
    } catch {
      /* Audio still works in browsers without usable energy statistics. */
    }
    if (this.closed) return;
    if (speaking !== this.speaking) {
      this.speaking = speaking;
      this.callbacks.onSpeaking(speaking);
    }
    this.audioTimer = setTimeout(() => void this.observeAudio(), 150);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.clearTimer();
    this.abort.abort();
    if (this.channel) {
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.onmessage = null;
      this.channel.onopen = null;
      this.channel.close();
      this.channel = null;
    }
    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
      this.peer = null;
    }
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;
    this.audio.pause();
    this.audio.srcObject = null;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.close();
    this.callbacks.onError(message);
  }
}

function connectionError(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === "NotAllowedError")
    return "Microphone access was denied. Allow microphone access in your browser, then try again.";
  if (cause instanceof DOMException && cause.name === "NotFoundError")
    return "No microphone was found. Connect a microphone and try again.";
  return cause instanceof Error
    ? cause.message
    : "Could not start the voice conversation.";
}
