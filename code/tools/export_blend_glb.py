# Export a .blend scene to .glb for the slides (meshes + materials only).
#   Blender -b scene.blend -P export_blend_glb.py -- out.glb [--decimate 0.5] [--skip NAME_SUBSTR ...]
# Curves are converted to meshes; lights/cameras are dropped (the slide
# scene sets its own). Prints each mesh's world bounding box as JSON lines
# ("BBOX {...}") so slide code can find pivots/axes.
import bpy, sys, json, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
dec = float(argv[argv.index('--decimate') + 1]) if '--decimate' in argv else 1.0
skip = argv[argv.index('--skip') + 1:] if '--skip' in argv else []

for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or any(s in o.name for s in skip):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.data.objects):
    if o.type == 'CURVE':
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.convert(target='MESH'); o.select_set(False)
for o in bpy.data.objects:
    if o.type == 'MESH' and dec < 1 and len(o.data.vertices) > 2000:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = dec
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
    print('BBOX ' + json.dumps({'name': o.name, 'min': [round(x, 4) for x in lo], 'max': [round(x, 4) for x in hi]}))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False)
