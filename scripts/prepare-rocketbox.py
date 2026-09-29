"""Convert the existing Rocketbox facial rig, without creating or editing mouth poses.

blender -b -P scripts/prepare-rocketbox.py -- /path/to/source-dir /path/to/rocketbox.glb
Source directory: one *_facial.fbx and its original texture .tga files.
See public/models/README.md for pinned source URLs and license.
"""
import bpy
import pathlib
import sys

source, output = map(pathlib.Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
models = list(source.glob('*_facial.fbx'))
if len(models) != 1:
    raise ValueError('Source directory must contain exactly one *_facial.fbx')
bpy.ops.import_scene.fbx(filepath=str(models[0]))
# Only the authored neutral rig and facial poses are needed, not the FBX test action.
for obj in bpy.data.objects:
    obj.animation_data_clear()
    if obj.type == 'MESH' and obj.data.shape_keys:
        obj.data.shape_keys.animation_data_clear()
        for shape in obj.data.shape_keys.key_blocks:
            shape.value = 0

for material in bpy.data.materials:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    links = material.node_tree.links
    surface = nodes.new('ShaderNodeBsdfPrincipled')
    surface.inputs['Metallic'].default_value = 0
    surface.inputs['Roughness'].default_value = 0.75
    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(surface.outputs['BSDF'], out.inputs['Surface'])
    for suffix, socket in [('color', 'Base Color'), ('normal', 'Normal')]:
        path = source / f'{material.name}_{suffix}.tga'
        if not path.exists():
            continue
        image = bpy.data.images.load(str(path), check_existing=False)
        if suffix == 'normal':
            image.colorspace_settings.name = 'Non-Color'
        if max(image.size) > 1024:
            image.scale(1024, 1024)
        image.file_format = 'PNG'
        image.filepath_raw = str(source / f'{material.name}_{suffix}.png')
        image.save()
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        if suffix == 'normal':
            normal = nodes.new('ShaderNodeNormalMap')
            links.new(tex.outputs['Color'], normal.inputs['Color'])
            links.new(normal.outputs['Normal'], surface.inputs[socket])
        else:
            links.new(tex.outputs['Color'], surface.inputs[socket])
            if material.name.endswith('_opacity'):
                links.new(tex.outputs['Alpha'], surface.inputs['Alpha'])
                material.surface_render_method = 'DITHERED'
    material.use_backface_culling = False

bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
    export_animations=False, export_morph=True, export_morph_normal=True,
    export_skins=True, export_yup=True, export_image_format='AUTO')
print('Saved original facial rig:', output)
