# Avatar library

The app defaults to **Blonde** (`Female_Adult_01`). Rain remains available with its original model and animation. See [Rain's source, license, and conversion notes](./RAIN.md).

The Rocketbox variants are ready-made humans from the Microsoft Rocketbox avatar library:

| Selector | File | Original character |
| --- | --- | --- |
| Cardigan | `rocketbox.glb` | `Female_Adult_02` |
| Blonde | `rocketbox-01.glb` | `Female_Adult_01` |
| Short dark hair | `rocketbox-03.glb` | `Female_Adult_03` |
| Long brown hair | `rocketbox-08.glb` | `Female_Adult_08` |

The model, textures, skeleton, and facial poses are distributed under the [MIT license](./ROCKETBOX-LICENSE.txt). No avatar account or subscription is required.

- Repository: https://github.com/microsoft/Microsoft-Rocketbox
- Pinned commit: `0943055db6ec570bcef9f2c8b41c9e5467c808f9`
- Models: `Assets/Avatars/Adults/Female_Adult_XX/Export/Female_Adult_XX_facial.fbx` (XX = 01, 02, 03, 08)
- Textures: `Assets/Avatars/Adults/Female_Adult_XX/Textures/`
- Retrieved: 2026-09-27
- Each converted GLB embeds textures and the original skeleton. Models are fetched only when selected.

The original 15 Oculus visemes (`AA_VI_*`, including silence), ARKit, FACS, and other facial poses are preserved. The mesh already includes the mouth interior. Conversion changes the file format, texture resolution/compression, and material setup; it does not synthesize mouth shapes or bake invented facial animation. The unused FBX test action is omitted.

Rocketbox speech uses [Wawa Lipsync](https://github.com/wass08/wawa-lipsync), MIT, with its existing R3F demo's blending. The adapter maps standard viseme names to Rocketbox's original shape names. Classification is an approximate frequency-based estimate, not guaranteed phoneme recognition. WebRTC audio plays immediately through the existing audio element. Silence, pause, and reduced motion reset the mouth. There is no amplitude-driven jaw fallback or custom speech controller. See [integration notes](../../src/vendor/wawa-lipsync/README.md).

## Reproduce the model

For each character, download its pinned facial FBX and `.tga` textures into a separate local directory. The converter accepts any of these characters and preserves the authored poses. The sources use this URL prefix:

`https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/0943055db6ec570bcef9f2c8b41c9e5467c808f9/`

From the repository root (Blender 5.2):

```sh
blender -b -P scripts/prepare-rocketbox.py -- /path/to/source-dir /tmp/rocketbox.glb
npx --yes @gltf-transform/cli@4.5.0 optimize /tmp/rocketbox.glb public/models/rocketbox.glb \
  --compress meshopt --texture-compress webp --texture-size 1024 \
  --simplify false --flatten false --join false --palette false
```

The Avatar selector defaults to Blonde on every page load. Switching changes only the portrait; voice, transcript, and memory stay in the same session.
