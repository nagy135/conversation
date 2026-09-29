import { useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { MathUtils, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MouthMotion } from './mouthMotion';

interface TalkingFaceProps {
  speaking: boolean;
  active: boolean;
  thinking: boolean;
  voiceActivity: { level: number };
}

const modelUrl = '/models/rain.glb?v=relaxed-hair';
const expressions = ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'browInnerUp', 'headLeft', 'headRight', 'headUp', 'headDown'] as const;
type Expression = typeof expressions[number];
/** Blender Studio Rain: facial shapes baked from her original CloudRig controls. */
export function RainFace({ active, speaking, thinking, voiceActivity, reducedMotion, manuallyPosed }: TalkingFaceProps & { reducedMotion: boolean; manuallyPosed: boolean }) {
  const gltf = useLoader(GLTFLoader, modelUrl, loader => loader.setMeshoptDecoder(MeshoptDecoder));
  const rig = useMemo(() => {
    // Each mounted portrait owns its morph weights; loader geometry is cached.
    const scene = clone(gltf.scene);
    const bindings: { mesh: Mesh; index: number; expression: Expression }[] = [];
    scene.traverse(object => {
      if (!(object instanceof Mesh) || !object.morphTargetDictionary || !object.morphTargetInfluences) return;
      object.morphTargetInfluences.fill(0);
      for (const expression of expressions) {
        const index = object.morphTargetDictionary[expression];
        if (index !== undefined) bindings.push({ mesh: object, index, expression });
      }
    });
    return { scene, bindings };
  }, [gltf]);
  const time = useRef(0);
  const mouth = useRef(new MouthMotion());

  useFrame(({ pointer }, delta) => {
    const step = Math.min(delta, 0.05);
    time.current += step;
    const t = time.current;
    const moving = active && !reducedMotion;
    const blinkPhase = t % 5.2;
    const blink = moving && blinkPhase > 4.94 ? Math.sin((blinkPhase - 4.94) / 0.26 * Math.PI) : 0;
    // Follow the waveform independently of the coarser speaking status.
    const jaw = mouth.current.update(voiceActivity.level, step, moving);
    const yaw = moving && !manuallyPosed ? pointer.x * 0.32 + Math.sin(t * 0.55) * 0.12 : 0;
    const pitch = moving && !manuallyPosed ? pointer.y * 0.25 + (speaking ? Math.sin(t * 2.9) * 0.10 : 0) : 0;
    const targets: Record<Expression, number> = {
      jawOpen: jaw,
      eyeBlinkLeft: blink,
      eyeBlinkRight: blink,
      browInnerUp: moving && thinking ? 0.3 : 0.04,
      headLeft: Math.max(0, yaw),
      headRight: Math.max(0, -yaw),
      headUp: Math.max(0, pitch),
      headDown: Math.max(0, -pitch),
    };
    for (const { mesh, index, expression } of rig.bindings) {
      const weights = mesh.morphTargetInfluences!;
      // Reset immediately on pause/reduced motion, including an interrupted utterance.
      const speed = expression.startsWith('eyeBlink') ? 35 : expression.startsWith('head') ? 4 : 20;
      weights[index] = !moving || expression === 'jawOpen' || (manuallyPosed && expression.startsWith('head')) ? targets[expression] : MathUtils.damp(weights[index], targets[expression], speed, step);
    }
  });

  return <primitive object={rig.scene} dispose={null} />;
}

