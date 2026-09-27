import { Component, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
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
type Orientation = { x: number; y: number; z: number };
const front: Orientation = { x: 0, y: 0, z: 0 };
const limitAngle = (angle: number) => MathUtils.clamp(angle, -45, 45);

/** Blender Studio Rain: facial shapes baked from her original CloudRig controls. */
function Face({ active, speaking, thinking, voiceActivity, reducedMotion, manuallyPosed }: TalkingFaceProps & { reducedMotion: boolean; manuallyPosed: boolean }) {
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

function FaceFallback() {
  return <div className="face-fallback"><span aria-hidden="true">◡</span></div>;
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <FaceFallback /> : this.props.children; }
}

export function TalkingFace(props: TalkingFaceProps) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [contextLost, setContextLost] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>(front);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; roll: boolean } | null>(null);
  const instructionsId = useId();
  const manuallyPosed = orientation.x !== 0 || orientation.y !== 0 || orientation.z !== 0;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (dragging || !manuallyPosed) return;
    if (reducedMotion) { setOrientation(front); return; }
    let frame = 0;
    let previous = performance.now();
    const settle = (now: number) => {
      const decay = Math.exp(-Math.min((now - previous) / 1000, 0.1) * 1.8);
      previous = now;
      setOrientation(value => {
        const next = { x: value.x * decay, y: value.y * decay, z: value.z * decay };
        return Math.max(Math.abs(next.x), Math.abs(next.y), Math.abs(next.z)) < 0.05 ? front : next;
      });
      frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [dragging, manuallyPosed, reducedMotion]);

  return (
    <div className={`talking-face${props.active ? ' is-active' : ''}`}>
      <div className="face-aura" />
      <div
        className={`avatar-rotation-surface${dragging ? ' is-dragging' : ''}`}
        role="group"
        aria-label="Rotate Rain"
        aria-describedby={instructionsId}
        tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0 || drag.current) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, roll: event.shiftKey };
          setDragging(true);
        }}
        onPointerMove={event => {
          const previous = drag.current;
          if (!previous || previous.id !== event.pointerId) return;
          const dx = (event.clientX - previous.x) * 0.25;
          const dy = (event.clientY - previous.y) * 0.25;
          previous.x = event.clientX;
          previous.y = event.clientY;
          setOrientation(value => previous.roll
            ? { ...value, z: limitAngle(value.z - dx) }
            : { ...value, x: limitAngle(value.x + dy), y: limitAngle(value.y + dx) });
        }}
        onPointerUp={event => {
          if (drag.current?.id === event.pointerId) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onDoubleClick={() => setOrientation(front)}
        onKeyUp={event => { if (event.key.startsWith('Arrow')) setDragging(false); }}
        onBlur={() => { if (!drag.current) setDragging(false); }}
        onKeyDown={event => {
          if (event.key === 'Home') { event.preventDefault(); setOrientation(front); return; }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          setDragging(true);
          const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
          const axis = event.shiftKey && horizontal ? 'z' : horizontal ? 'y' : 'x';
          const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -5 : 5;
          setOrientation(value => ({ ...value, [axis]: limitAngle(value[axis] + step) }));
        }}
      >
        <SceneBoundary>
          <Suspense fallback={<div className="scene-loading"><span /></div>}>
            {contextLost ? <FaceFallback /> : <Canvas
              aria-hidden="true"
              className="avatar-canvas"
              camera={{ position: [0, 1.43, 1.12], rotation: [0, 0, 0], fov: 30, near: 0.01, far: 10 }}
              dpr={[1, 1.75]}
              frameloop={reducedMotion ? 'demand' : 'always'}
              gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
              fallback={<FaceFallback />}
              onCreated={({ gl }) => {
                gl.domElement.addEventListener('webglcontextlost', () => setContextLost(true), { once: true });
              }}
            >
              <ambientLight intensity={0.8} />
              <hemisphereLight args={['#fff7ed', '#87917d', 1.25]} />
              <directionalLight position={[-2, 3, 4]} intensity={2.3} color="#fff4e5" />
              <directionalLight position={[3, 2, 2]} intensity={0.8} color="#e3ecff" />
              <directionalLight position={[1, 3, -2]} intensity={2} color="#fff7e9" />
              <group name="PortraitRotation" position={[0, 1.43, 0]} rotation={[orientation.x * Math.PI / 180, orientation.y * Math.PI / 180, orientation.z * Math.PI / 180]}>
                <group position={[0, -1.43, 0]}>
                  <Face {...props} reducedMotion={reducedMotion} manuallyPosed={manuallyPosed || dragging} />
                </group>
              </group>
            </Canvas>}
          </Suspense>
        </SceneBoundary>
      </div>
      <p id={instructionsId} className="sr-only">Drag or use arrow keys to rotate up to 45 degrees in each direction. Shift-drag or Shift with left and right arrows tilts Rain. Release to return to the front view. Double-click or press Home to reset.</p>

    </div>
  );
}
