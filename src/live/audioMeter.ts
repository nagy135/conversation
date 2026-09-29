import { Lipsync } from '../vendor/wawa-lipsync/lipsync';
import { speechShapes, type SpeechShape, type VisemeWeights } from './visemes';

type SpeechDetector = Pick<Lipsync, 'connectSource' | 'processAudio' | 'viseme'>;

/** Analyses the received voice; the audio element remains the sole playback owner. */
export class RemoteAudioMeter {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly samples = new Float32Array(512);
  private detector: SpeechDetector | null = null;

  constructor(private readonly createDetector: (context: AudioContext) => SpeechDetector = context => new Lipsync(undefined, context)) {}

  attach(stream: MediaStream): void {
    this.close();
    try {
      const context = new AudioContext();
      this.context = context;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = this.samples.length;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.detector = this.createDetector(context);
      this.detector.connectSource(this.source);
      this.resume();
    } catch (error) {
      this.close();
      console.warn('Live lip-sync could not initialize.', error);
    }
  }

  readVisemes(): VisemeWeights | null {
    if (!this.detector || this.context?.state !== 'running') return null;
    this.detector.processAudio();
    // Upstream retains feature history when the stream becomes completely silent.
    // Gate only silence here, so a stopped WebRTC track cannot leave a stale pose.
    if ((this.read() ?? 0) < 0.002) return {};
    const shape = this.detector.viseme as SpeechShape;
    return speechShapes.includes(shape) ? { [shape]: 1 } : {};
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
    this.detector = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.source = null;
    this.analyser = null;
    this.context = null;
  }
}
