"""Bake Blender Studio Rain v3.3 into a self-contained talking portrait.
Run: blender -b rain_v3.2.blend --disable-autoexec --python scripts/prepare-rain.py -- /tmp/rain.glb
The source rig's constraints, corrective shapes, and lattices are evaluated;
no downloaded Python text blocks are executed. See public/models/README.md.
"""
import bpy
import sys
from array import array
from pathlib import Path

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
rig = bpy.data.objects['RIG-rain']
# Relax the source's T-pose before baking the portrait.
for side, angle in [('L', -1.2), ('R', 1.2)]:
    rig.pose.bones['Properties_IKFK']['ik_arm_' + ('left' if side == 'L' else 'right')] = 0.0
    arm = rig.pose.bones['FK-Upperarm.' + side]
    arm.rotation_mode = 'XYZ'
    arm.rotation_euler.z = angle
# The source ponytail is held straight back for rigging. Let it fall behind
# the neck, with a gentle curve distributed across its original FK controls.
for name, angle in [('FK-Hair_Ponytail2', -1.0), ('FK-Hair_Ponytail3', -0.6), ('FK-Hair_Ponytail4', -0.1)]:
    rig.pose.bones[name].rotation_euler.x = angle

parts = ['head', 'body', 'eyes', 'eye_dots', 'eyebrows', 'eyelashes', 'gums_lower', 'gums_upper', 'tongue', 'hair_main', 'hair_ponytail', 'hair_strand', 'hairband', 'scarf', 'top']
sources = [bpy.data.objects['GEO-rain-' + part] for part in parts]
for obj in sources:
    for mod in obj.modifiers:
        if mod.type == 'SUBSURF':
            obj.driver_remove(mod.path_from_id('levels'))
            mod.levels = mod.render_levels = 1
            mod.show_viewport = True

# Values are local-space controller transforms from the original CloudRig.
poses = {
    'jawOpen': [('MSTR-Jaw', 'rotation_euler', 0, .28)],
    'eyeBlinkLeft': [('ACT-Eyelid_Upper.L', 'location', 1, -.027), ('ACT-Eyelid_Lower.L', 'location', 1, .006)],
    'eyeBlinkRight': [('ACT-Eyelid_Upper.R', 'location', 1, -.027), ('ACT-Eyelid_Lower.R', 'location', 1, .006)],
    'browInnerUp': [('MSTR-Eyebrow.L', 'location', 1, .009), ('MSTR-Eyebrow.R', 'location', 1, .009)],
    'headLeft': [('FK-Head', 'rotation_euler', 1, .15)],
    'headRight': [('FK-Head', 'rotation_euler', 1, -.15)],
    'headUp': [('FK-Head', 'rotation_euler', 0, -.10)],
    'headDown': [('FK-Head', 'rotation_euler', 0, .10)],
}

def update():
    rig.update_tag()
    bpy.context.view_layer.update()
    return bpy.context.evaluated_depsgraph_get()

def coords(mesh):
    data = array('f', [0.0]) * (len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', data)
    return data

graph = update()
copies = []
baselines = []
for source in sources:
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(graph), preserve_all_data_layers=True, depsgraph=graph)
    obj = bpy.data.objects.new(source.name.replace('GEO-rain-', 'Rain_'), mesh)
    mesh.name = obj.name
    obj.matrix_world = source.matrix_world.copy()
    copies.append(obj)
    baselines.append(coords(mesh))
    obj.shape_key_add(name='Basis')

for name, controls in poses.items():
    for bone, attr, axis, value in controls:
        getattr(rig.pose.bones[bone], attr)[axis] = value
    graph = update()
    for source, obj, base in zip(sources, copies, baselines):
        evaluated = source.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        data = coords(mesh)
        assert len(data) == len(base), 'Pose changed topology: ' + source.name
        difference = max(abs(a-b) for a, b in zip(data, base))
        if difference > .000001:
            key = obj.shape_key_add(name=name)
            key.data.foreach_set('co', data)
            print('SHAPE', obj.name, name, difference, flush=True)
        evaluated.to_mesh_clear()
    for bone, attr, axis, value in controls:
        getattr(rig.pose.bones[bone], attr)[axis] = 0
    update()

# Bake just material color, without studio lighting, to portable PBR textures.
scene = bpy.data.scenes.new('Rain export')
bpy.context.window.scene = scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.render.bake.margin = 8
for obj in copies:
    scene.collection.objects.link(obj)

for obj in copies:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if obj.name == 'Rain_eye_dots':
        material = bpy.data.materials.new('Rain_eye_highlights')
        material.use_nodes = True
        shader = material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (.95, .95, .95, 1)
        shader.inputs['Roughness'].default_value = .2
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for attribute in list(obj.data.color_attributes): obj.data.color_attributes.remove(attribute)
        continue
    uv_source = obj.data.uv_layers.active.name
    web_uv = obj.data.uv_layers.new(name='WebUV')
    for original, target in zip(obj.data.uv_layers[uv_source].data, web_uv.data):
        target.uv = original.uv
        if obj.name == 'Rain_head': target.uv.x -= 2
        elif obj.name == 'Rain_body': target.uv.x /= 2
    obj.data.uv_layers.active = web_uv
    web_uv.active_render = True
    size = 1024 if obj.name in ['Rain_head', 'Rain_body', 'Rain_hair_main'] else 512
    image = bpy.data.images.new(obj.name + '_color', width=size, height=size, alpha=False)
    for slot in obj.material_slots:
        material = slot.material.copy()
        slot.material = material
        nodes, links = material.node_tree.nodes, material.node_tree.links
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = uv_source
        for node in list(nodes):
            if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
                links.new(uv.outputs['UV'], node.inputs['Vector'])
            elif node.type == 'TEX_COORD':
                for link in list(node.outputs['UV'].links):
                    links.new(uv.outputs['UV'], link.to_socket)
        principled = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        emission = nodes.new('ShaderNodeEmission')
        base = principled.inputs['Base Color']
        if base.is_linked: links.new(base.links[0].from_socket, emission.inputs['Color'])
        else: emission.inputs['Color'].default_value = base.default_value
        for out in [n for n in nodes if n.type == 'OUTPUT_MATERIAL']:
            links.new(emission.outputs[0], out.inputs['Surface'])
        target = nodes.new('ShaderNodeTexImage')
        target.image = image
        nodes.active = target
    print('BAKE', obj.name, flush=True)
    bpy.ops.object.bake(type='EMIT')
    # One texture replaces the source's procedural and vertex-color graph.
    material = bpy.data.materials.new(obj.name + '_material')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .28 if obj.name == 'Rain_eyes' else .65
    texture = material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for face in obj.data.polygons:
        face.material_index = 0
        face.use_smooth = True
    for layer in list(obj.data.uv_layers):
        if layer.name != 'WebUV': obj.data.uv_layers.remove(layer)
    for attribute in list(obj.data.color_attributes): obj.data.color_attributes.remove(attribute)
    image.pack()

# Remove geometry below the portrait to reduce download and processing cost.
import bmesh
for obj in copies:
    if obj.name == 'Rain_body':
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        bmesh.ops.delete(mesh, geom=[v for v in mesh.verts if v.co.z < 1.0], context='VERTS')
        mesh.to_mesh(obj.data)
        mesh.free()

bpy.ops.object.select_all(action='SELECT')
scene['attribution'] = 'Rain Rig (CC) Blender Foundation | studio.blender.org'
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True, export_animations=False, export_skins=False, export_morph=True, export_morph_normal=True, export_extras=True, export_yup=True)
print('EXPORTED', output, flush=True)
