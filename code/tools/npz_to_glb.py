"""Convert a paper-figure scene (.npz from resources/*/scenes) to .glb + .json.

    python npz_to_glb.py SCENE.npz OUT.glb [--colors object=...]

Geometry is converted from the paper's z-up frame to three.js y-up:
(x, y, z) -> (x, z, -y). Every point/direction field of the npz (q, c,
tool_tip, tool_dir, arrow_tail/head, marks, ...) is written, converted the
same way, to OUT.json so slide code can place arrows/labels exactly.
Face materials follow resources/system_constraints/render_system.py.
"""
import sys, json, math, numpy as np, trimesh
from trimesh.visual.material import PBRMaterial

# Colours are the paper renderer's Blender values (linear RGB, as glTF expects):
# resources/teaser/render_teaser.py and resources/system_constraints/render_system.py
BLUE = (.16, .43, .64); GRAY = (.66, .69, .72); PINK = (1., .52, .74)
BLUE_CUT = (.58, .76, .90); GRAY_CUT = (.68, .71, .74); ORANGE = (.96, .60, .30)
PINK_DARK = (.78, .28, .51)
# object material 3 is 'fixture solid' (the step5 legs live in the object mesh):
# it is written as a separate 'support__legs' node so it does not move with the workpiece
OBJECT_MATS = {0: ('workpiece', GRAY), 1: ('work_area', PINK_DARK), 2: ('workpiece_cut', GRAY_CUT), 3: ('legs', BLUE)}
SUPPORT_MATS = {0: ('fixture', BLUE), 1: ('fixture_legs', BLUE)}
EXTRA = {'machine': (ORANGE, 1.0), 'keepout': (ORANGE, .4), 'ghost': (GRAY, .3), 'table': ((.85, .85, .85), 1.)}

def yup(v): v = np.asarray(v, float); return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)

def mat(name, rgb, alpha=1., rough=.5, metal=.05):
    return PBRMaterial(name=name, baseColorFactor=[*rgb, alpha], roughnessFactor=rough, metallicFactor=metal,
                       alphaMode='BLEND' if alpha < 1 else 'OPAQUE', doubleSided=alpha < 1)

def piece(v, f, m, angle=40):
    t = trimesh.Trimesh(yup(v), f, process=False)
    t = trimesh.graph.smooth_shade(t, angle=math.radians(angle))
    t.visual = trimesh.visual.TextureVisuals(material=m)
    return t

def main(src, out, json_only=False):
    z = np.load(src, allow_pickle=True)
    scene = trimesh.Scene()
    if json_only: return write_info(z, out)
    for key, table in [('object', OBJECT_MATS), ('support', SUPPORT_MATS)]:
        if f'{key}_v' not in z.files: continue
        v, f = z[f'{key}_v'], z[f'{key}_f']
        ids = z[f'{key}_mat'] if f'{key}_mat' in z.files else np.zeros(len(f), int)
        for i in np.unique(ids):
            name, rgb = table.get(int(i), (f'{key}_{i}', GRAY))
            node = f'support__{name}' if (key, name) == ('object', 'legs') else f'{key}__{name}'
            scene.add_geometry(piece(v, f[ids == i], mat(name, rgb)), node_name=node, geom_name=node)
    for i in range(int(z['n_extra']) if 'n_extra' in z.files else 0):
        kind = str(z[f'extra_{i}_mat'])
        if kind.startswith('rgb:'): rgb, a = tuple(float(c) for c in kind[4:].split(',')), 1.
        else: rgb, a = EXTRA.get(kind, (GRAY, 1.))
        scene.add_geometry(piece(z[f'extra_{i}_v'], z[f'extra_{i}_f'], mat(kind, rgb, a)), node_name=f'extra_{i}__{kind}', geom_name=f'extra_{i}__{kind}')
    scene.export(out)
    write_info(z, out)

def write_info(z, out):
    info = {}
    for k in z.files:
        a = z[k]
        if k.endswith(('_v', '_f', '_mat')) or k.startswith('extra_'): continue
        if a.dtype.kind in 'US' and a.ndim > 0: info[k] = a.tolist()
        elif a.dtype.kind in 'US':
            s = str(a)
            try: s = json.loads(s)
            except Exception: pass
            if k in ('marks', 'anchors'): s = {n: yup(p).tolist() for n, p in s.items()}
            info[k] = s
        elif a.dtype == bool: info[k] = a.tolist() if a.size < 64 else None
        elif a.ndim >= 1 and a.shape[-1] == 3: info[k] = yup(a).round(6).tolist()
        else: info[k] = a.tolist()
    if 'ground_z' in info: info['ground_y'] = info.pop('ground_z')
    json.dump({k: v for k, v in info.items() if v is not None}, open(out.replace('.glb', '.json'), 'w'), indent=1)
    print('wrote', out)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], '--json-only' in sys.argv)
