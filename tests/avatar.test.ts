import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
