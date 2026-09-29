# Rain portrait

**Rain Rig (CC) Blender Foundation | studio.blender.org**

`rain.glb` is an adaptation of [Blender Studio's Rain v3](https://studio.blender.org/characters/rain/v3/), licensed under **Creative Commons Attribution 4.0 International**. See [CC-BY-4.0.txt](./CC-BY-4.0.txt) and the app's [visible credits page](./credits.html).

- Source archive: https://studio.blender.org/download-source/files/ee/a7/eea73e55dba1cea31c09848df6a794b2-4.zip
- Source archive SHA-256: `80217f163f6392dc829233d63c2cfb5e1376775bc34101ad14f39631fea70d24`
- Retrieved: 2026-09-27
- The v3.3 archive contains `Rain v3.3/rain_v3.2.blend` and its textures.

The original CloudRig controllers, constraints, lattices, and corrective shapes were evaluated in Blender and baked into portable morph targets. The portrait supports jaw movement, left/right blinks, raised brows, and small head turns/nods. The lower teeth and tongue follow the original jaw deformation, while the upper teeth stay fixed to the upper jaw. Head movement also deforms the neck and moves hair, eyes, and mouth parts together.

Modifications: arms relaxed from the source T-pose; ponytail posed downward with its original FK controls; one subdivision level baked; lower body omitted; procedural base colors baked into textures; textures converted to WebP; geometry compressed with Meshopt. The self-contained GLB is about 3.1 MB and is served locally. Blender and its rig scripts are not required at runtime.

## Reproduce

Install Blender (conversion tested with 5.2.2 LTS), download/extract the official archive with its textures, then run from the repository root:

```sh
blender -b '/path/to/Rain v3.3/rain_v3.2.blend' --disable-autoexec \
  --python scripts/prepare-rain.py -- /tmp/rain.glb
npx --yes @gltf-transform/cli@4.5.0 optimize /tmp/rain.glb public/models/rain.glb \
  --compress meshopt --texture-compress webp --texture-size 1024 \
  --simplify false --flatten false --join false --palette false
```

The converter does not execute the downloaded blend file's embedded Python scripts. Speech animation currently follows audio amplitude, not phoneme/viseme timing.
