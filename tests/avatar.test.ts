import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rocketboxShapes } from '../src/live/visemes';
import { avatars, defaultAvatar } from '../src/avatars';

for (const avatar of avatars.filter(avatar => avatar.kind === 'rocketbox')) test(`${avatar.label} retains authored mouth poses, facial bones, and embedded textures`, () => {
  const file = readFileSync(new URL(`../public${avatar.modelUrl}`, import.meta.url));
  assert.equal(file.toString('ascii', 0, 4), 'glTF');
  assert.equal(file.readUInt32LE(8), file.length);
  const model = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)));
  const parts = model.meshes.filter((mesh: { extras?: { targetNames?: string[] } }) => mesh.extras?.targetNames);
  for (const target of [...Object.values(rocketboxShapes), 'AK_09_EyeBlinkLeft', 'AK_10_EyeBlinkRight']) {
    let moves = false;
    for (const part of parts) {
      const index = part.extras.targetNames.indexOf(target);
      assert.ok(index >= 0, `Missing original shape: ${target}`);
      for (const primitive of part.primitives) {
        const accessor = model.accessors[primitive.targets[index].POSITION];
        assert.equal(accessor.count, model.accessors[primitive.attributes.POSITION].count);
        if ([...accessor.min, ...accessor.max].some(value => Math.abs(Number(value)) > 0.00001)) moves = true;
      }
    }
    assert.ok(moves, `${target} must deform geometry`);
  }
  for (const bone of ['Bip01 Head', 'Bip01 MJaw', 'Bip01 MBottomLip', 'Bip01 MUpperLip']) {
    assert.ok(model.nodes.some((node: { name: string }) => node.name === bone), `Missing original bone: ${bone}`);
  }
  assert.ok(model.skins.length);
  for (const resource of [...model.images, ...model.buffers]) assert.equal(resource.uri, undefined);
});

test('Rain retains coordinated facial shapes and embedded resources after optimization', () => {
  const file = readFileSync(new URL('../public/models/rain.glb', import.meta.url));
  assert.equal(file.toString('ascii', 0, 4), 'glTF');
  assert.equal(file.readUInt32LE(8), file.length);
  const model = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)));
  const mesh = (name: string) => {
    const node = model.nodes.find((node: { name: string }) => node.name === name);
    assert.ok(node, `Missing portrait part: ${name}`);
    return model.meshes[node.mesh];
  };
  const shape = (name: string, target: string) => {
    const part = mesh(name);
    const index = part.extras.targetNames.indexOf(target);
    assert.ok(index >= 0, `${name} must support ${target}`);
    for (const primitive of part.primitives) {
      const accessor = model.accessors[primitive.targets[index].POSITION];
      assert.equal(accessor.count, model.accessors[primitive.attributes.POSITION].count);
      assert.ok([...accessor.min, ...accessor.max].some(value => Math.abs(Number(value)) > 0.00001), `${name}/${target} must deform geometry`);
    }
  };
  for (const target of ['jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'browInnerUp', 'headLeft', 'headRight', 'headUp', 'headDown']) shape('Rain_head', target);
  for (const name of ['Rain_gums_lower', 'Rain_tongue']) shape(name, 'jawOpen');
  // The upper teeth stay attached to the upper jaw; eyelash shapes follow lids.
  assert.ok(!mesh('Rain_gums_upper').extras.targetNames.includes('jawOpen'));
  for (const target of ['eyeBlinkLeft', 'eyeBlinkRight']) shape('Rain_eyelashes', target);
  for (const name of ['Rain_eyes', 'Rain_gums_lower', 'Rain_gums_upper', 'Rain_tongue', 'Rain_hair_main']) {
    for (const target of ['headLeft', 'headRight', 'headUp', 'headDown']) shape(name, target);
  }
  for (const resource of [...model.images, ...model.buffers]) assert.equal(resource.uri, undefined, 'Avatar must load without external resource URLs');
});


test('avatar catalog defaults to Blonde and offers four distinct Rocketbox models', () => {
  assert.equal(defaultAvatar.id, 'rocketbox-01');
  assert.equal(avatars.length, 5);
  assert.equal(avatars.filter(avatar => avatar.kind === 'rocketbox').length, 4);
  assert.equal(new Set(avatars.map(avatar => avatar.modelUrl)).size, 5);
});
