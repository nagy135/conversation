/** Reads short windows of the received voice without changing audible playback. */
export class RemoteAudioMeter {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly samples = new Float32Array(512);

  attach(stream: MediaStream): void {
    this.close();
    try {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = this.samples.length;
      this.source = this.context.createMediaStreamSource(stream);
      // No connection to destination: the existing audio element owns playback.
      this.source.connect(this.analyser);
      this.resume();
    } catch {
      this.close();
    }
  }

  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  }

  read(): number | null {
    if (!this.analyser || this.context?.state !== 'running') return null;
    this.analyser.getFloatTimeDomainData(this.samples);
    let energy = 0;
    for (const sample of this.samples) energy += sample * sample;
    return Math.sqrt(energy / this.samples.length);
  }

  close(): void {
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.source = null;
    this.analyser = null;
    this.context = null;
  }
}
