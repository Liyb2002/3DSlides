"""Export a cadGrasp paint demo (whole_task_2/idea/demo/paint/code/translations.py) as a 3D process for the slides:
the same plan the video is rendered from (KUKA work arm, Franka Panda moving the support, the paint spreading over
the workpiece), but written as data instead of frames, so the slides can replay it from any camera.

    cd <cadGrasp repo>
    PYTHONPATH=. <cadgrasp python> <3DSlides>/code/tools/export_cadgrasp_process.py paint_B+whole_shape OUT_DIR [--fps 15]
        [--order W03,W05,W06,...] [--skip W05_2,...]

--order: the work directions (Step2 areas) in this order instead of Step6's (each keeps its installations in
order). Two directions in a row on one seat are a Reuse (R) change: the Panda turns the support with the part in
it; on different seats a Juxtaposition (J) change: the Panda moves the part to the other seat.
--skip: installations left out (their faces stay grey).
--unload: a Reuse change too takes the part out first (out of its seat along its exit onto the rest spot), then the Panda
turns the empty support, then puts the part back (as a Juxtaposition does); without it the support turns with the part in it.

Writes OUT_DIR/process.glb   every part's mesh in its own frame (one node per part, names in process.json)
       OUT_DIR/process.bin   per frame: position + quaternion of every track, the column lift, the task, flags;
                             per face: paint time and area id
       OUT_DIR/process.json  layout of process.bin, tracks, markers (work / change segments), camera hints
Frames are the plan's frames from its first work on, resampled to --fps of motion time. World frame: the plan's
(z up, metres). The plan itself is computed (and cached in OUT_DIR/cache) exactly as translations.py does.
"""
import argparse, json, multiprocessing, os, sys
from pathlib import Path
import numpy as np

# cadGrasp's planners hand state to worker processes through module globals
# (written for Linux): fork keeps them, macOS's default spawn does not.
multiprocessing.set_start_method('fork', force=True)

a = argparse.ArgumentParser(); a.add_argument('run'); a.add_argument('out'); a.add_argument('--fps', type=float, default=15.); a.add_argument('--order', default=''); a.add_argument('--skip', default=''); a.add_argument('--unload', action='store_true')
args = a.parse_args()
OUT = Path(args.out).resolve(); OUT.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('TRANSLATIONS_CACHE', str(OUT/'cache'))
REPO = Path.cwd()
sys.path.insert(0, str(REPO)); sys.path.insert(0, str(REPO/'whole_task_2/idea/demo/paint/code'))

import trimesh                                                         # noqa: E402
from scipy.spatial.transform import Rotation                          # noqa: E402
import translations as T                                               # noqa: E402
from whole_task_2.step1 import reach_video as RV                       # noqa: E402
from whole_task_2.step5.video.raster import tool_mesh, GRAY, PINK     # noqa: E402
D, J = T.D, T.J

if args.unload:
    # video.py's Handler, with its same-seat branch (support + part as one, 'SB') replaced by the other seat's three
    # moves: part out, support, part in; and part grasps found for those changes too
    import inspect, textwrap
    def _patched(fn, old, new):
        src = textwrap.dedent(inspect.getsource(fn)); assert old in src, (fn.__name__, old); ns = {}
        exec(src.replace(old, new), D.__dict__, ns); return ns[fn.__name__]
    D.Handler.change = _patched(D.Handler.change, 'if m.seat_of[k] == m.seat_of[k2]:', 'if False:')
    D.Handler.__init__ = _patched(D.Handler.__init__, 'if m.seat_of[k] != m.seat_of[k2] for x in (k, k2)', 'for x in (k, k2)')


def reorder(model, order, skip=()):
    """The installations by work direction in `order` (names of Step2 areas: W03, ...), each direction's own in order,
    without those in `skip` (installation ids: W05_2, ...)."""
    group = [r['id'].rsplit('_', 1)[0] for r in model.records]
    order = order or list(dict.fromkeys(group))
    missing = sorted(set(group)-set(order)); unknown = sorted(set(order)-set(group))
    if missing or unknown: raise SystemExit(f'--order: missing {missing}, unknown {unknown} (directions: {sorted(set(group))})')
    ids = [r['id'] for r in model.records]
    if set(skip)-set(ids): raise SystemExit(f'--skip: unknown {sorted(set(skip)-set(ids))}')
    idx = [k for g in order for k in range(len(group)) if group[k] == g and ids[k] not in skip]
    pick = lambda xs: [xs[k] for k in idx]
    model.records, model.seat_of, model.areas = pick(model.records), pick(model.seat_of), pick(model.areas)
    model.exits = np.asarray(model.exits)[idx]; model.row = dict(model.row, tasks=pick(model.row['tasks']))
    model.layout.poses, model.layout.material = pick(model.layout.poses), pick(model.layout.material)
    for a_, b in zip(model.records, model.records[1:]):
        ga, gb = a_['id'].rsplit('_', 1)[0], b['id'].rsplit('_', 1)[0]
        if ga != gb: print('CHANGE', ga, '->', gb, 'R' if model.seat_of[model.records.index(a_)] == model.seat_of[model.records.index(b)] else 'J', flush=True)


def plan(run_name, order=(), skip=()):
    """translations.run() up to the film's frames: the plan, the Panda's changes, both cached."""
    model = T.Installations(run_name)
    if order or skip:                                                                     # its own cache
        reorder(model, order, skip); run_name = f"{run_name}__{'-'.join(order)}" + (f"__skip-{'-'.join(skip)}" if skip else '')
    result = model.result; report = dict(tasks=model.row['tasks'])
    inputs = (run_name, result, model.row['support_sha256'], repr(D.POLICY), T.LEFT, T.RISE)

    def motion():
        p = D.Demo(model, model.layout, model.support, report, D.POLICY); p.tasks = p.build(); return p.frames, p.events, p.tasks
    frames, events, tasks = T.cached(f'{run_name}_plan', inputs, motion)
    heavy = D.Demo.task_stops; D.Demo.task_stops = J.Plan.task_stops
    try: p = D.Demo(model, model.layout, model.support, report, D.POLICY)
    finally: D.Demo.task_stops = heavy
    p.frames, p.events, p.tasks = frames, events, tasks

    def handling():
        hd = D.Handler(p); return hd.film(), dict(base=hd.panda.base, yaw=hd.panda.yaw, rest=hd.rest, park=hd.park)
    whole, saved = T.cached(f"{run_name}{'__unload' if args.unload else ''}_film", inputs+(repr(D.FRANKA),), handling)
    hd = D.Handler.cached(p, saved)
    return model, p, hd, whole, saved


ORDER = [g for g in args.order.split(',') if g]; SKIP = [g for g in args.skip.split(',') if g]
model, p, hd, whole, saved = plan(args.run, ORDER, SKIP)
fps0 = float(D.POLICY['fps'])
first = next(i for i, f in enumerate(whole) if f['task'] is not None)
times = np.arange(0., (len(whole)-1-first)/fps0, 1./args.fps)
idx = np.minimum(first+np.round(times*fps0).astype(int), len(whole)-1)
frames = [whole[i] for i in idx]; n = len(frames)
print('EXPORT', args.run, len(whole), 'plan frames at', fps0, 'fps ->', n, 'frames at', args.fps, flush=True)

# ---------------------------------------------------------------- meshes (local frames) and their tracks
scene = trimesh.Scene(); tracks = []          # tracks: name -> nodes placed by that track's matrix
def lin(c): c = np.asarray(c, float)[:3]; return np.where(c <= .04045, c/12.92, ((c+.055)/1.055)**2.4)
def add(name, v, f, color, metal=.1, rough=.5):
    m = trimesh.Trimesh(np.asarray(v, float), np.asarray(f, int), process=False)
    m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        name=name, baseColorFactor=[*lin(color), 1.], metallicFactor=metal, roughnessFactor=rough))
    scene.add_geometry(m, node_name=name, geom_name=name); return name
def track(name, nodes): tracks.append(dict(name=name, nodes=nodes))

src = p.source
track('workpiece', [add('workpiece', src.vertices, src.faces, GRAY, .03, .63)])
track('support', [add('support', p.support.vertices, p.support.faces, D.BLUE if hasattr(D, 'BLUE') else (.16, .43, .64), .05, .5)])
tv, tf = D.table_block(p); add('table', tv, tf, D.BENCH, .02, .8)                           # static, world frame
setup = p.model.setup; L_, H_, N_ = setup['needle_length_m'], setup['head_radius_m'], setup['needle_radius_m']
track('tool', [add('needle', *tool_mesh(0., L_, N_, N_), RV.STEEL, .6, .3), add('head', *tool_mesh(L_, L_+.07, H_, H_), RV.HEAD, .2, .45)])
from codes.simulation.kuka import description, visual_parts                                 # noqa: E402
links, _, _ = description(); kuka_links = []
for i, link in enumerate(links):
    offset = np.fromstring(link.find('visual/origin').get('xyz'), sep=' '); nodes = []
    for j, (v, f, rgba) in enumerate(visual_parts(i)):
        color = rgba[:3] if not (i in (2, 4) and np.allclose(rgba[:3], .2)) else np.full(3, .6)
        nodes.append(add(f'kuka_{i}_{j}', v+offset, f, color, .25, .4))
    if nodes: track(f'kuka_{i}', nodes); kuka_links.append(i)
for j, (v, f, c) in enumerate(hd.panda.visuals()): track(f'panda_{j}', [add(f'panda_{j}', v, f, c, .15, .45)])
r = .9*float(np.abs(p.arm.collisions[0][:, :2]).max()); col = trimesh.creation.cylinder(radius=r, height=1., sections=48); col.apply_translation([0, 0, .5])
add('column', col.vertices, col.faces, J.COLUMN, .2, .5)
scene.export(OUT/'process.glb')

# ---------------------------------------------------------------- per-frame poses
base = np.asarray(p.model.setup['base_position_world_m'], float)
bottom = min(f['off'] for f in p.frames)+base[2]-.6*p.D
P = np.zeros((n, len(tracks), 7), np.float32); lift = np.zeros(n, np.float32)
task = np.full(n, -1, np.int16); flags = np.zeros(n, np.uint8)
park = np.asarray(saved['park'], float)
for t, f in enumerate(frames):
    tcp, z, _, _ = p.arm.forward(f['q']); tip = tcp+[0, 0, f['off']]
    L = D.matrices(p.arm.forward(f['q'], geometry=True)[2]); L[:, 2, 3] += f['off']
    H = hd.panda.visual_frames(f['h'], f['open'])
    M = {'workpiece': f['B'], 'support': f['S'], 'tool': J.tool_frame(tip, z)}
    M.update({f'kuka_{i}': L[i] for i in kuka_links}); M.update({f'panda_{j}': H[j] for j in range(len(H))})
    for k, tr in enumerate(tracks):
        m = np.asarray(M[tr['name']], float)
        P[t, k, :3] = m[:3, 3]; P[t, k, 3:] = Rotation.from_matrix(m[:3, :3]).as_quat()
    lift[t] = base[2]+f['off']-bottom
    task[t] = -1 if f['task'] is None else f['task']
    flags[t] = (1 if f.get('contact') else 0) | (2 if f.get('grip') else 0) | (4 if np.abs(np.asarray(f['h'])-park).max() > 1e-6 else 0)
# quaternion sign continuity (so the player can interpolate)
for k in range(len(tracks)):
    for t in range(1, n):
        if np.dot(P[t, k, 3:], P[t-1, k, 3:]) < 0: P[t, k, 3:] *= -1

# paint time (s) per face; area id per face
F = len(src.faces); paint = np.full(F, np.inf, np.float32)
for t, f in enumerate(frames):
    ids = np.asarray(f['painted'])
    ids = np.flatnonzero(ids) if ids.dtype == bool else ids.astype(int)      # a mask or face ids
    if ids.size: new = ids[~np.isfinite(paint[ids])]; paint[new] = t/args.fps
areas = model.areas; area_key = {}
area_of_task = []
for a_ in areas: area_of_task.append(area_key.setdefault(tuple(np.asarray(a_, int)[:8].tolist())+(len(a_),), len(area_key)))
face_area = np.full(F, -1, np.int16)
for k, a_ in enumerate(areas): face_area[np.asarray(a_, int)] = area_of_task[k]

# ---------------------------------------------------------------- markers
def runs(mask):
    out, start = [], None
    for t, v in enumerate(list(mask)+[False]):
        if v and start is None: start = t
        if not v and start is not None: out.append((start, t-1)); start = None
    return out
installs = []
for k, rec in enumerate(model.records):
    on = np.where((task == k) & ((flags & 1) > 0))[0]
    if on.size: installs.append(dict(id=rec['id'], task=k, area=int(area_of_task[k]), start=float(on[0]/args.fps), end=float(on[-1]/args.fps)))
changes = [dict(start=float(a_/args.fps), end=float(b/args.fps)) for a_, b in runs((flags & 4) > 0)]

parts = [('poses', P), ('lift', lift), ('task', task), ('flags', flags), ('paint', paint), ('face_area', face_area)]
off, layout = 0, {}
with open(OUT/'process.bin', 'wb') as fh:
    for name, arr in parts:
        pad = (-off) % 4; fh.write(b'\0'*pad); off += pad
        b = np.ascontiguousarray(arr).tobytes(); fh.write(b)
        layout[name] = dict(offset=off, dtype=str(arr.dtype), shape=list(arr.shape)); off += len(b)
view = T.camera(p)
info = dict(run=args.run, result=model.result, order=ORDER or None, skip=SKIP or None, fps=args.fps, frames=n, duration=float((n-1)/args.fps), layout=layout, tracks=tracks,
            static=['table'], column=dict(node='column', xy=base[:2].tolist(), bottom=float(bottom)),
            colors=dict(gray=list(GRAY), light=list(RV.LIGHT), pink=list(PINK)),
            installations=installs, changes=changes, table_z=float(p.Z0),
            camera=dict(view=view.tolist(), centre=np.asarray(p._centre, float).tolist(), work_arm_base=base.tolist(),
                        panda_base=np.asarray(saved['base'], float).tolist()))
(OUT/'process.json').write_text(json.dumps(info, indent=1))
print('EXPORT done', n, 'frames,', len(installs), 'installations,', len(changes), 'changes ->', OUT, flush=True)
