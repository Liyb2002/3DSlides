"""Scenes and motions for the merge / adjust operation GIFs (slides 9-10), from the paper figures
resources/merge_operations (scenes_display/, as the figure) and resources/adjust_operations (scenes/).

    /Users/yuanboli/miniforge3/envs/cadgrasp/bin/python code/tools/prep_operations.py

Writes demo.3Dslides/assets/pipeline/<scene>.glb/.json (build_npz_to_glb.py) and ops_motions.json: the rigid motions
between the figure's frames (same mesh, other pose; Kabsch), y-up, as {R: 3x3 row-major, t, centre}.
Work reassignment: the faces given to the other group (reassign_given.npy) get materials 20 (were group 2)
and 21 (were group 4) so the slide can recolour them.
"""
import json, sys, tempfile
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from build_npz_to_glb import convert, yup                    # noqa: E402
MERGE = ROOT/'resources/merge_operations/scenes_display'; ADJ = ROOT/'resources/adjust_operations/scenes'
OUT = ROOT/'3DSlides/demo.3Dslides/assets/pipeline'


def kabsch(A, B):
    ca, cb = A.mean(0), B.mean(0); U, _, Vt = np.linalg.svd((A-ca).T@(B-cb)); d = np.sign(np.linalg.det(Vt.T@U.T))
    R = Vt.T@np.diag([1, 1, d])@U.T; return R, cb-R@ca, float(np.abs(A@R.T+cb-R@ca-B).max())


def verts(f, part): return yup(np.load(f)[f'{part}_v'].astype(float))


def motion(fa, pa, fb, pb):
    A, B = verts(fa, pa), verts(fb, pb); R, t, err = kabsch(A, B)
    assert err < 1e-4, (fa, fb, err)
    return screw(R, t, A.mean(0))


def screw(R, t, centre):
    """the motion as a screw: turn `angle` about the line (point, axis), slide `slide` along it (exact in between)"""
    from scipy.spatial.transform import Rotation
    rv = Rotation.from_matrix(R).as_rotvec(); ang = float(np.linalg.norm(rv))
    if ang < 1e-6: return dict(axis=[0, 1, 0], angle=0., point=centre.tolist(), slide=0., t=t.tolist())
    a = rv/ang; d = float(a@t)
    p = np.linalg.lstsq(np.eye(3)-R, t-d*a, rcond=None)[0]
    p = p+a*(a@(centre-p))                                            # the axis point nearest the body
    return dict(axis=a.tolist(), angle=ang, point=p.tolist(), slide=d, t=t.tolist())


def exit_bins(z, nb=10, pitch=.001):
    """Exit redirection, step by step: the exit turns from the old direction d0 to the new d1 (great circle); a face of
    the cut (red, part 1) turns red when the turning sweep of the G first reaches it, a face of the added material
    (green, part 0 material 1) appears when the sweep has left it for good. Faces are tested a little inside the solid
    (centroid - 1.5 mm normal) against the voxelised G swept along d(u); undecided faces take their neighbours' value.
    Returns the scene with those faces in materials 30+bin (red) and 40+bin (green), bin = threshold * nb."""
    import trimesh
    from trimesh.graph import face_adjacency
    G = trimesh.Trimesh(z['p2_v'], z['p2_f'])
    d0 = z['p3_v'].mean(0)-z['p2_v'].mean(0); d0 /= np.linalg.norm(d0)        # p3/p4: old-exit ghosts (slate)
    d1 = z['p5_v'].mean(0)-z['p2_v'].mean(0); d1 /= np.linalg.norm(d1)        # p5/p6: new-exit ghosts (pale)
    vox = G.voxelized(pitch).fill(); occ = vox.matrix; inv = np.linalg.inv(vox.transform)
    def inside(P):
        ij = np.round(P@inv[:3, :3].T+inv[:3, 3]).astype(int); ok = np.all((ij >= 0) & (ij < occ.shape), 1)
        r = np.zeros(len(P), bool); r[ok] = occ[tuple(ij[ok].T)]; return r
    om = np.arccos(np.clip(d0@d1, -1, 1)); U = np.linspace(0, 1, 41); S = np.arange(0, .35, pitch*.7)
    def swept(C, u):
        d = (np.sin((1-u)*om)*d0+np.sin(u*om)*d1)/np.sin(om); r = np.zeros(len(C), bool)
        for s_ in S: r |= inside(C-s_*d)
        return r
    def thresholds(p, mask, red):
        t = trimesh.Trimesh(z[f'{p}_v'], z[f'{p}_f'], process=False); idx = np.flatnonzero(mask)
        C = t.triangles_center[idx]-.0015*t.face_normals[idx]; H = np.array([swept(C, u) for u in U])
        th = np.full(len(idx), np.nan)
        for k in range(len(idx)):
            if red: w = np.flatnonzero(H[:, k]); th[k] = U[w[0]] if len(w) else np.nan
            else:
                if H[-1, k]: continue
                w = np.flatnonzero(H[:, k]); th[k] = U[min(w[-1]+1, len(U)-1)] if len(w) else 0.
        full = np.full(len(t.faces), np.nan); full[idx] = th
        adj = face_adjacency(t.faces); adj = adj[mask[adj[:, 0]] & mask[adj[:, 1]]]
        for _ in range(200):                                                   # fill the undecided from neighbours
            nan = np.isnan(full) & mask
            if not nan.any(): break
            acc = np.zeros(len(full)); cnt = np.zeros(len(full))
            for a, b in ((adj[:, 0], adj[:, 1]), (adj[:, 1], adj[:, 0])):
                ok = ~np.isnan(full[b]); np.add.at(acc, a[ok], full[b[ok]]); np.add.at(cnt, a[ok], 1)
            fill = nan & (cnt > 0); full[fill] = acc[fill]/cnt[fill]
        full[np.isnan(full) & mask] = .5
        return np.minimum((full*nb).astype(int), nb-1)
    z = dict(z)
    m1 = z['p1_m'].astype(int); m1[:] = 30+thresholds('p1', np.ones(len(m1), bool), True); z['p1_m'] = m1
    m0 = z['p0_m'].astype(int); g = m0 == 1; m0[g] = 40+thresholds('p0', g, False)[g]; z['p0_m'] = m0
    print('exit bins red', np.bincount(m1-30, minlength=nb), 'green', np.bincount(m0[g]-40, minlength=nb))
    return z


def main():
    for n in ('R_before', 'R_turn_100', 'R_after', 'R_res_1', 'R_res_2', 'J_start', 'J_A2', 'J_placed2', 'J_diff', 'J_new_1', 'J_new_2'):
        convert(MERGE/f'{n}.npz', OUT)
    for n in ('exit', 'rot', 'trans'):
        convert(ADJ/f'{n}.npz', OUT)
    # reassignment: the given faces in their own materials
    z = dict(np.load(ADJ/'reassign.npz', allow_pickle=True)); given = np.load(ADJ/'reassign_given.npy')
    m = z['p0_m'].copy(); m[given & (m == 8)] = 20; m[given & (m == 10)] = 21; z['p0_m'] = m
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp)/'reassign.npz'; np.savez(f, **z); convert(f, OUT)
    with tempfile.TemporaryDirectory() as tmp:                                # exit redirection, face by face
        f = Path(tmp)/'exit_steps.npz'; np.savez(f, **exit_bins(np.load(ADJ/'exit.npz'))); convert(f, OUT)
    for n in ('rot_ring', 'rot_ring_rev'):                                    # the turn arrows of (b)
        (OUT/f'{n}.json').write_text(json.dumps(dict(arc=yup(np.load(ADJ/f'{n}.npz')['arc']).round(6).tolist())))
    mo = dict(
        reuse=motion(MERGE/'R_before.npz', 'p0', MERGE/'R_turn_100.npz', 'p0'),
        jux=motion(MERGE/'J_A2.npz', 'p0', MERGE/'J_placed2.npz', 'p1'),
        exit_old=[motion(ADJ/'exit.npz', 'p2', ADJ/'exit.npz', p) for p in ('p3', 'p4')],     # dashed arrow, slate ghosts
        exit_new=[motion(ADJ/'exit.npz', 'p2', ADJ/'exit.npz', p) for p in ('p5', 'p6')],     # solid arrow, pale ghosts
        rot_plus=motion(ADJ/'rot.npz', 'p0', ADJ/'rot_2.npz', 'p0'),
        rot_minus=motion(ADJ/'rot.npz', 'p0', ADJ/'rot_0.npz', 'p0'),
        trans=motion(ADJ/'trans.npz', 'p2', ADJ/'trans.npz', 'p0'),
    )
    same = np.abs(verts(MERGE/'J_start.npz', 'p0')-verts(MERGE/'J_placed2.npz', 'p0')).max()
    print('J_start fixture == J_placed2 fixture:', same < 1e-6)
    (OUT/'ops_motions.json').write_text(json.dumps(mo))
    print('wrote', OUT/'ops_motions.json')


if __name__ == '__main__': main()
