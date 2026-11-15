# Build a scene with the paper's own Blender renderer (resources/teaser/render_teaser.py)
# and export it as .glb instead of keeping only the render, so the slides show
# exactly the geometry/materials of the paper figures.
#
#   Blender -b -P export_teaser_scene_glb.py -- OUT.glb RENDER_TEASER.py <render_teaser args...>
# render_teaser runs once at a tiny size (cheap), then the in-memory scene is
# exported: lights, camera and the shadow-catcher ground are dropped, curves
# (cone lines, region box) become meshes.
import bpy, sys, runpy, os, tempfile
argv = sys.argv[sys.argv.index('--') + 1:]
out, script, rest = argv[0], argv[1], argv[2:]
tmp = os.path.join(tempfile.mkdtemp(), 'tiny.png')
sys.argv = [script, '--'] + rest + ['--output', tmp, '--size', '64', '--samples', '1']
sys.path.insert(0, os.path.dirname(script))
try:
    runpy.run_path(script, run_name='__main__')
except SystemExit:
    pass
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA') or getattr(o, 'is_shadow_catcher', False):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.data.objects):
    if o.type == 'CURVE':
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.convert(target='MESH'); o.select_set(False)
for o in bpy.data.objects:
    print('NODE', o.type, repr(o.name), [m.name for m in getattr(o.data, 'materials', [])])
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False)
print('EXPORTED', out)
