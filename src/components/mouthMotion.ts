/** Adaptive speech envelope: preserve syllable valleys instead of holding a jaw open. */
export class MouthMotion {
  private peak = 0.2;
  private opening = 0;

  update(level: number, delta: number, enabled: boolean): number {
    if (!enabled) {
      this.peak = 0.2;
      this.opening = 0;
      return 0;
    }
    const step = Math.min(Math.max(delta, 0), 0.05);
    this.peak = Math.max(0.08, level, this.peak * Math.exp(-step * 0.6));
    const floor = this.peak * 0.22;
    const strength = Math.min(1, Math.max(0, (level - floor) / (this.peak - floor)));
    const target = Math.pow(strength, 1.15) * 0.65;
    // Fast closure exposes the short gaps between syllables and consonants.
    const speed = target > this.opening ? 45 : 60;
    this.opening += (target - this.opening) * (1 - Math.exp(-speed * step));
    return this.opening < 0.002 ? 0 : this.opening;
  }
}
