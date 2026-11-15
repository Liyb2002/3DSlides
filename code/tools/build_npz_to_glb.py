"""Convert build_sequence scenes (resources/build_sequence/scenes/*.npz, the
render_build.py format) to .glb + .json for the slides.

    python build_npz_to_glb.py OUT_DIR SCENE.npz [SCENE.npz ...]

A scene is parts p<i>_v / p<i>_f / p<i>_m (per-face material ids, see
render_build.py): 0 fixture, 1 material a merge added, 2 material it removed,
3 workpiece, 4 pink (the group just added), 5 light pink, 6 workpiece ghost,
7..10 work groups A1..A4, 11 second ghost, 12 shared area. Each (part, material)
becomes one node named  p<i>__m<k>  so a slide can fade / move them; colours are
the pipeline figure's (render_colors.sh: solid fixture blue, added green,
removed red). Geometry goes from the paper's z-up to three.js y-up:
(x, y, z) -> (x, z, -y). Points (tool_tip, tool_dir, arrows, ground_z) go to
the .json, converted the same way.
"""
import json, math, sys
from pathlib import Path
import numpy as np, trimesh
from trimesh.visual.material import PBRMaterial

# linear RGB (glTF), the Blender values of render_build.py / render_teaser.py / render_colors.sh
BLUE = (.16, .43, .64); ADDED = (.20, .62, .33); REMOVED = (.85, .18, .20)
GRAY = (.66, .69, .72); PINK = (1., .52, .74); OLD_PINK = (1., .78, .88); GHOST = (.80, .83, .87)
GROUPS = [(.62, .42, .28), (.60, .48, .88), (.25, .72, .90), (.95, .78, .28)]
MATS = {0: ('fixture', BLUE, .42), 1: ('added', ADDED, .42), 2: ('removed', REMOVED, .6), 3: ('workpiece', GRAY, .55),
        4: ('pink', PINK, .6), 5: ('old_pink', OLD_PINK, .6), 6: ('ghost', GHOST, .6),
        7: ('group1', GROUPS[0], .6), 8: ('group2', GROUPS[1], .6), 9: ('group3', GROUPS[2], .6), 10: ('group4', GROUPS[3], .6),
        11: ('ghost2', (.36, .45, .58), .6), 12: ('shared', (.78, .63, .58), .6),
        20: ('given2', GROUPS[1], .6), 21: ('given4', GROUPS[3], .6)}       # faces reassigned to the other group (prep_operations.py)


def yup(v):
    v = np.asarray(v, float)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def convert(src, out_dir):
    z = np.load(src, allow_pickle=True)
    out_dir = Path(out_dir)
    scene = trimesh.Scene()
    n = int(z['n']) if 'n' in z.files else 0
    for i in range(n):
        v, f, m = z[f'p{i}_v'], z[f'p{i}_f'], z[f'p{i}_m'].astype(int)
        for k in np.unique(m):
            name, rgb, rough = MATS.get(int(k), (f'm{k}', GRAY, .6))
            t = trimesh.Trimesh(yup(v), f[m == k], process=False)
            t.remove_unreferenced_vertices()
            t = trimesh.graph.smooth_shade(t, angle=math.radians(35 if k < 3 else 180))
            t.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(
                name=name, baseColorFactor=[*rgb, 1.], roughnessFactor=rough, metallicFactor=.05, doubleSided=True))
            node = f'p{i}__m{k}'
            scene.add_geometry(t, node_name=node, geom_name=node)
    stem = Path(src).stem
    scene.export(Path(out_dir)/f'{stem}.glb')
    info = {}
    for k in z.files:
        if k == 'n' or k.startswith('p') and k[1:2].isdigit(): continue
        a = z[k]
        if a.dtype.kind in 'fi' and a.ndim >= 1 and a.shape[-1] == 3: info[k] = yup(a).round(6).tolist()
        elif a.dtype.kind in 'fi' and a.ndim == 0: info[k] = float(a)
    if 'ground_z' in info: info['ground_y'] = info.pop('ground_z')
    info['parts'] = {f'p{i}': sorted(int(k) for k in np.unique(z[f'p{i}_m'])) for i in range(n)}
    (Path(out_dir)/f'{stem}.json').write_text(json.dumps(info))
    print('wrote', stem, n, 'parts')


if __name__ == '__main__':
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for s in sys.argv[2:]: convert(s, out)
