/** The standard Oculus viseme names used by Wawa Lipsync. */
export const speechShapes = [
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
  'viseme_PP', 'viseme_SS', 'viseme_TH', 'viseme_DD', 'viseme_FF',
  'viseme_kk', 'viseme_nn', 'viseme_RR', 'viseme_CH',
] as const;
export type SpeechShape = typeof speechShapes[number];
export type VisemeWeights = Partial<Record<SpeechShape, number>>;
export interface VoiceActivity {
  level: number;
  /** null means unavailable; {} means silence; otherwise Wawa's selected pose. */
  visemes: VisemeWeights | null;
}

/** Names of the existing, unmodified poses in Microsoft Rocketbox's facial rig. */
export const rocketboxShapes: Record<SpeechShape, string> = {
  viseme_PP: 'AA_VI_01_PP', viseme_FF: 'AA_VI_02_FF', viseme_TH: 'AA_VI_03_TH',
  viseme_DD: 'AA_VI_04_DD', viseme_kk: 'AA_VI_05_KK', viseme_CH: 'AA_VI_06_CH',
  viseme_SS: 'AA_VI_07_SS', viseme_nn: 'AA_VI_08_nn', viseme_RR: 'AA_VI_09_RR',
  viseme_aa: 'AA_VI_10_aa', viseme_E: 'AA_VI_11_E', viseme_I: 'AA_VI_12_I',
  viseme_O: 'AA_VI_13_O', viseme_U: 'AA_VI_14_U',
};
export const vowelShapes: readonly string[] = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'];
