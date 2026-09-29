export interface Avatar {
  id: string;
  label: string;
  kind: 'rain' | 'rocketbox';
  modelUrl: string;
  credit: string;
}

/** Blonde is selected on every fresh page load. */
export const avatars: readonly Avatar[] = [
  { id: 'rain', label: 'Rain · Original', kind: 'rain', modelUrl: '/models/rain.glb?v=relaxed-hair', credit: 'Blender Studio' },
  { id: 'rocketbox-02', label: 'Cardigan', kind: 'rocketbox', modelUrl: '/models/rocketbox.glb', credit: 'Rocketbox' },
  { id: 'rocketbox-01', label: 'Blonde', kind: 'rocketbox', modelUrl: '/models/rocketbox-01.glb', credit: 'Rocketbox' },
  { id: 'rocketbox-03', label: 'Short dark hair', kind: 'rocketbox', modelUrl: '/models/rocketbox-03.glb', credit: 'Rocketbox' },
  { id: 'rocketbox-08', label: 'Long brown hair', kind: 'rocketbox', modelUrl: '/models/rocketbox-08.glb', credit: 'Rocketbox' },
];
export const defaultAvatar = avatars.find(avatar => avatar.id === 'rocketbox-01')!;
