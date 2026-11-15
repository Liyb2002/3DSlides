"""The mover of the Sec. 3.1 station (the eval's Franka FR3 + Robotiq 2F-85, ../../eval/env_simulator/scene.xml, posed
by the eval's own IK ../../eval/planning/ik.py; the base where resources/problem_setup/fr3_arm.py puts it) taking the
workpiece out of the fixture, turning the fixture to its next pose (an R) and putting the workpiece back: idle beside
the G -> above it -> down -> jaws close across the G's thickness -> out along the exit direction (its exit path) -> up,
aside (--aside), set down on the table, release -> grasp the fixture where the hand can hold it through the turn -> lift,
turn it into the pose of the station's placement 4 (the demo's real Reuse turn, 70 deg), set it down, release -> grasp
the G again -> carry it in front of the turned seat -> in along the turned exit direction, release -> back to idle. Writes, for the problem-setup slide:

  OUT/fr3_mover.glb    every visual mesh of the arm + gripper in its own frame (nodes g<i>)
  OUT/fr3_mover.json   per frame: each mesh's pose and the workpiece's and the fixture's motion (y-up, as the slide's
                       station glb); markers (fractions of the whole: exit, out, lifted, released, adjust, adjusted, regrasp, insert, inserted)

  cd <fixture_paper_draft>
  /Users/yuanboli/miniforge3/envs/cadgrasp/bin/python 3DSlides/code/tools/export_fr3_mover.py 3DSlides/demo.3Dslides/assets/models
      [--base x y] [--exit m] [--fps 30]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np, mujoco, trimesh
from scipy.spatial.transform import Rotation, Slerp
from trimesh.visual.material import PBRMaterial

ROOT = Path(__file__).resolve().parents[3]                       # fixture_paper_draft
EVAL = ROOT/'eval'; STATION = ROOT/'resources/problem_setup/scenes/station.npz'
sys.path.insert(0, str(EVAL))
from planning.world import World, _is_robot                      # noqa: E402
from planning import ik                                           # noqa: E402

C = np.array([[1., 0, 0], [0, 0, 1], [0, -1, 0]])                 # z-up -> y-up: (x, y, z) -> (x, z, -y)


def rz(a):
    c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.]])


def main():
    p = argparse.ArgumentParser(); p.add_argument('out'); p.add_argument('--base', type=float, nargs=2, default=(.42, -.40))
    p.add_argument('--exit', type=float, default=.11); p.add_argument('--turn', type=float, default=25., help='deg the fixture is turned when adjusted'); p.add_argument('--aside', type=float, default=.30, help='m the G is set down to the left of where it came out'); p.add_argument('--dip', type=float, default=.018); p.add_argument('--fps', type=float, default=30.)
    a = p.parse_args(); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    d = np.load(STATION); G = d['object_v'].astype(float); exit_dir = np.asarray(d['exit_dir'], float); exit_dir /= np.linalg.norm(exit_dir)
    w = World(); m, dd = w.model, w.data
    bx, by = a.base; T_sb = np.eye(4); T_sb[:3, :3] = rz(np.arctan2(-by, -bx)); T_sb[:3, 3] = (bx, by, 0.)
    S = np.linalg.inv(T_sb)
    lo, hi = w.gripper_width_range()
    pads = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, f'gripper/{s}_pad') for s in ('left', 'right')]

    T_home = w.fk_fingertip(w.home_q)
    F = d['support_v'].astype(float); table = float(F[:, 2].min())          # the fixture's feet stand on the table top

    def pose(point, turn):
        T = np.eye(4); T[:3, :3] = rz(turn)@T_home[:3, :3]; T[:3, 3] = (S@np.r_[point, 1])[:3]; return T

    def closing(q):
        w.set_arm(q); mujoco.mj_kinematics(m, dd); v = T_sb[:3, :3]@(dd.xpos[pads[0]]-dd.xpos[pads[1]]); v[2] = 0.; return v/np.linalg.norm(v)

    def aim(point, axis, q):                                      # IK with the jaws closing along `axis` (horizontal)
        w.set_gripper_opening(hi); turn = 0.
        for _ in range(5):
            q2 = ik.solve(w, pose(point, turn), q)
            if q2 is None: return None, None
            q = q2; e = closing(q); err = (np.arctan2(np.cross(e, axis)[2], e@axis)+np.pi/2) % np.pi-np.pi/2
            if abs(err) < np.radians(1.5): break
            turn += err
        return q, turn

    def line(p0, p1, n, q0, t0, t1=None):                         # IK along a straight line (and a turn), tracked
        qs = []
        for s in np.linspace(0, 1, n):
            e = s*s*(3-2*s)
            q1 = ik.solve(w, pose(p0+(p1-p0)*e, t0+((t1 if t1 is not None else t0)-t0)*e), q0)
            if q1 is None: raise SystemExit(f'FR3 IK failed on a line at s={s:.2f}')
            qs.append(q1); q0 = q1
        return qs

    def joint(q0, q1, n): return [q0+(q1-q0)*(s*s*(3-2*s)) for s in np.linspace(0, 1, n)]

    def thin(P, axis): return float(np.ptp(P@axis))

    # 1. the G: jaws across its thinnest direction (horizontal), straddling its top rim
    c = G-G.mean(0); _, V = np.linalg.eigh(c.T@c); axG = V[:, 0].copy(); axG[2] = 0.; axG /= np.linalg.norm(axG)
    top = G[np.argmax(G[:, 2])]; rim = G[G[:, 2] > top[2]-.03]
    gripG = min(hi, thin(rim, axG)+.002)
    graspG = np.r_[rim[:, :2].mean(0), top[2]-a.dip]
    qG, turnG = aim(graspG, axG, w.home_q)
    if qG is None: raise SystemExit('FR3 IK: no grasp on the G; move --base')

    # rigid motions of a body (station frame): T maps where the body was at the start to where it is now
    def rigid(Rm, t): M = np.eye(4); M[:3, :3] = Rm; M[:3, 3] = t; return M
    def kabsch(A, B):
        ca, cb = A.mean(0), B.mean(0); U, _, Vt = np.linalg.svd((A-ca).T@(B-cb)); dd_ = np.sign(np.linalg.det(Vt.T@U.T))
        Rm = Vt.T@np.diag([1, 1, dd_])@U.T; return rigid(Rm, cb-Rm@ca)
    def path(T0, T1, n, c):                                       # slerp the rotation, the body point c moves straight
        r = Slerp([0, 1], Rotation.from_matrix([T0[:3, :3], T1[:3, :3]]))
        p0, p1 = T0[:3, :3]@c+T0[:3, 3], T1[:3, :3]@c+T1[:3, 3]; out = []
        for s_ in np.linspace(0, 1, n):
            e = s_*s_*(3-2*s_); Rm = r([e]).as_matrix()[0]; out.append(rigid(Rm, p0+(p1-p0)*e-Rm@c))
        return out
    def up(T, h): U = T.copy(); U[2, 3] += h; return U
    def tip(q): return T_sb@w.fk_fingertip(q)
    def follow(Ts, T_tip0, q0, step=1):                           # the hand holding a body along its motion
        qs = []
        for T in Ts[::step]:
            q1 = ik.solve(w, S@T@T_tip0, q0)
            if q1 is None: return None
            qs.append(q1); q0 = q1
        return qs

    # the R: the fixture turned into the pose of the station's placement 4 (the real Reuse turn of this demo, 70 deg);
    # the G goes back into the same seat
    P4 = np.load(STATION.parent/'placement_4.npz'); T4 = kabsch(F, P4['support_v'].astype(float))
    cF, cG = F.mean(0), G.mean(0)
    I = np.eye(4)
    pathF = path(I, up(I, .06), 18, cF)+path(up(I, .06), up(T4, .06), 70, cF)+path(up(T4, .06), T4, 18, cF)

    # 2. a grasp on the fixture the hand can hold along the whole turn
    graspF = None
    order = np.argsort(-F[:, 2])
    for i in order[::20][:600]:
        p0 = F[i]
        if np.linalg.norm(p0[:2]-cG[:2]) < .035: continue
        near = F[(np.linalg.norm(F[:, :2]-p0[:2], axis=1) < .012) & (F[:, 2] > p0[2]-.02)]
        if len(near) < 12: continue
        cc = near-near.mean(0); _, VV = np.linalg.eigh(cc.T@cc); ax = VV[:, 0].copy(); ax[2] = 0.
        if np.linalg.norm(ax) < .3: continue
        ax /= np.linalg.norm(ax); wd = thin(near, ax)
        if not .004 < wd < .05: continue
        pt = np.r_[near[:, :2].mean(0), p0[2]-.012]
        q, t = aim(pt, ax, qG)
        if q is None: continue
        for tt in (t, t+np.pi):
            q = ik.solve(w, pose(pt, tt), qG)
            if q is None or follow(pathF, tip(q), q, step=6) is None: continue
            graspF, gripF, qF, turnF = pt, min(hi, wd+.002), q, tt
            break
        if graspF is not None: break
    if graspF is None: raise SystemExit('no grasp on the fixture the hand can hold through the turn')

    left = np.array([.806405, -.591364, 0.])                      # screen left (fr3_arm.py)
    idle_pt = np.r_[cG[0], cG[1], top[2]+.03]+left*.14
    q_idle = ik.solve(w, pose(idle_pt, turnG), qG)
    aboveG = graspG+np.array([0, 0, .07]); q_aboveG = ik.solve(w, pose(aboveG, turnG), qG)
    if q_idle is None or q_aboveG is None: raise SystemExit('FR3 IK: no idle / approach pose')
    out_pt = graspG+exit_dir*a.exit
    lift_pt = out_pt+np.array([0, 0, .04]); aside_pt = lift_pt+left*a.aside

    frames, marks = [], {}                                        # (q, opening, held: None | 'G' | 'F')
    def mark(name): marks[name] = len(frames)
    def add(qs, wd, held): frames.extend((q, wd, held) for q in qs)
    def grip(w0, w1, held, n=16): q = frames[-1][0]; frames.extend((q, w0+(w1-w0)*s, held) for s in np.linspace(0, 1, n))
    mark('idle')
    add(joint(q_idle, q_aboveG, 45), hi, None)
    mark('descend')
    add(line(aboveG, graspG, 30, q_aboveG, turnG), hi, None)
    mark('close')
    grip(hi, gripG, None)
    mark('exit')
    add(line(graspG, out_pt, 50, frames[-1][0], turnG), gripG, 'G')
    mark('out')
    add(line(out_pt, lift_pt, 18, frames[-1][0], turnG), gripG, 'G')
    mark('lifted')
    add(line(lift_pt, aside_pt, 40, frames[-1][0], turnG), gripG, 'G')
    zG = (G-graspG+aside_pt)[:, 2].min()                          # set it down: its lowest point on the table
    down_pt = aside_pt-np.array([0, 0, zG-table-.001])
    add(line(aside_pt, down_pt, 30, frames[-1][0], turnG), gripG, 'G')
    grip(gripG, hi, 'G')
    T_Grest = rigid(np.eye(3), down_pt-graspG)                    # where the G lies now
    add(line(down_pt, down_pt+np.array([0, 0, .08]), 20, frames[-1][0], turnG), hi, None)
    mark('released')
    # 3. the R: grasp the fixture, lift, turn it into its next pose, set it down
    aboveF = graspF+np.array([0, 0, .08]); q_aboveF = ik.solve(w, pose(aboveF, turnF), qF)
    if q_aboveF is None: raise SystemExit('FR3 IK: no approach to the fixture')
    mark('to_fixture')
    add(joint(frames[-1][0], q_aboveF, 45), hi, None)
    add(line(aboveF, graspF, 30, q_aboveF, turnF), hi, None)
    grip(hi, gripF, None)
    mark('adjust')
    T_tipF = tip(frames[-1][0])
    add(follow(pathF, T_tipF, frames[-1][0]), gripF, 'F')
    grip(gripF, hi, 'F')
    T_back = T4@T_tipF; T_back[:3, 3] += T_back[:3, 2]*(-.06)    # back off along the hand's own axis
    q_b = ik.solve(w, S@T_back, frames[-1][0])
    if q_b is None: raise SystemExit('FR3 IK: cannot back off the fixture')
    add(joint(frames[-1][0], q_b, 20), hi, None)
    mark('adjusted')
    # 4. the G back into its seat: grasp it where it lies, carry it in front of the turned seat, in along the exit
    T_G4 = T4                                                     # same seat: the G moves with the fixture's turn
    e4 = T4[:3, :3]@exit_dir
    T_pre = T_G4.copy(); T_pre[:3, 3] += e4*a.exit
    pathG = path(T_Grest, up(T_Grest, .08), 20, cG)+path(up(T_Grest, .08), up(T_pre, .03), 70, cG)+path(up(T_pre, .03), T_pre, 16, cG)
    insG = path(T_pre, T_G4, 45, cG)
    # choose the grasp from the end: a grasp on the G in its seat after the turn, tilted at most 50 deg, whose
    # counterpart on the G lying on the table comes from above, and that the hand can hold along the whole way
    G4 = (T4[:3, :3]@G.T).T+T4[:3, 3]
    top4 = G4[np.argmax(G4[:, 2])]; rim4 = G4[G4[:, 2] > top4[2]-.03]
    c4 = rim4-rim4.mean(0); _, V4 = np.linalg.eigh(c4.T@c4); ax4 = V4[:, 0].copy(); ax4[2] = 0.; ax4 /= np.linalg.norm(ax4)
    gp4 = np.r_[rim4[:, :2].mean(0), top4[2]-a.dip]
    q4, t4_ = aim(gp4, ax4, frames[-1][0])
    approach = lambda T: T[:3, :3]@(T_home[:3, :3].T@np.array([0, 0, -1.]))
    q_reg, best = None, None
    if q4 is not None:
        for tt in (t4_, t4_+np.pi):
            for ang in (0, 15, -15, 30, -30, 45, -45):
                for tax in ((1, 0, 0), (0, 1, 0)):
                    Rt = Rotation.from_rotvec(np.radians(ang)*np.array(tax, float)).as_matrix()
                    Hf = pose(gp4, tt); Hf = T_sb@Hf                                   # station frame
                    Hf = rigid(Rt, gp4-Rt@gp4)@Hf                                      # tilt about the grasp point
                    Hr = T_Grest@np.linalg.inv(T_G4)@Hf                                # the same grasp on the G on the table
                    if approach(Hr)[2] > -.5 or Hr[2, 3] < table+.02: continue         # must come from above
                    q1 = ik.solve(w, S@Hr, frames[-1][0])
                    if q1 is None: continue
                    T0 = np.linalg.inv(T_Grest)@Hr
                    if follow(pathG+insG, T0, q1, step=5) is None: continue
                    q_reg, turn_reg, T_tipG0_ = q1, None, T0; best = (tt, ang, tax); break
                if q_reg is not None: break
            if q_reg is not None: break
    if q_reg is None: raise SystemExit('FR3 IK: cannot carry the G back into its seat')
    print('G regrasp: tilt', best)
    mark('regrasp')
    H_above = T_Grest@T_tipG0_; H_above = H_above.copy(); H_above[:3, 3] -= approach(H_above)*.08     # back along the approach
    q_ab = ik.solve(w, S@H_above, q_reg)
    if q_ab is None: q_ab = q_reg
    add(joint(frames[-1][0], q_ab, 40), hi, None)
    add(joint(q_ab, q_reg, 25), hi, None)
    grip(hi, gripG, None)
    T_tipG0 = T_tipG0_
    add(follow(pathG, T_tipG0, frames[-1][0]), gripG, 'G')
    mark('insert')
    add(follow(insG, T_tipG0, frames[-1][0]), gripG, 'G')
    grip(gripG, hi, 'G')
    mark('inserted')
    T_out = T_G4@T_tipG0; T_out[:3, 3] += e4*.06+np.array([0, 0, .04])
    q_o = ik.solve(w, S@T_out, frames[-1][0])
    if q_o is not None: add(joint(frames[-1][0], q_o, 20), hi, None)
    add(joint(frames[-1][0], q_idle, 45), hi, None)
    mark('end')
    width = thin(rim, axG); turn = turnG

    # meshes in their own frames
    body = lambda g: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[g]) or ''
    geoms = [g for g in range(m.ngeom) if _is_robot(body(g)) and (
        (m.geom_type[g] == mujoco.mjtGeom.mjGEOM_MESH and m.geom_group[g] == 2)
        or (m.geom_type[g] == mujoco.mjtGeom.mjGEOM_CYLINDER and body(g) == 'flange'))]   # the FT 300-S + adapter are cylinders
    scene = trimesh.Scene()
    for i, g in enumerate(geoms):
        rgba = m.mat_rgba[m.geom_matid[g]] if m.geom_matid[g] >= 0 else m.geom_rgba[g]
        if m.geom_type[g] == mujoco.mjtGeom.mjGEOM_CYLINDER:
            r, hh = m.geom_size[g][:2]; t = trimesh.creation.cylinder(radius=r, height=2*hh, sections=48)
        else:
            mid = m.geom_dataid[g]; v0, nv = m.mesh_vertadr[mid], m.mesh_vertnum[mid]; f0, nf = m.mesh_faceadr[mid], m.mesh_facenum[mid]
            t = trimesh.Trimesh(m.mesh_vert[v0:v0+nv].copy(), m.mesh_face[f0:f0+nf].copy(), process=False)
        t = trimesh.graph.smooth_shade(t, angle=np.radians(30))
        t.visual = trimesh.visual.TextureVisuals(material=PBRMaterial(name=f'g{i}', baseColorFactor=[*[float(x) for x in rgba[:3]], 1.], roughnessFactor=.45, metallicFactor=.15))
        scene.add_geometry(t, node_name=f'g{i}', geom_name=f'g{i}')
    scene.export(out/'fr3_mover.glb')

    # per frame: mesh poses (y-up world), the workpiece's motion (y-up)
    poses = np.zeros((len(frames), len(geoms), 7), np.float32)
    carried = {'G': np.eye(4), 'F': np.eye(4)}; grab = {}               # each body's motion so far; the fingertip when taken
    track = {'G': np.zeros((len(frames), 16), np.float32), 'F': np.zeros((len(frames), 16), np.float32)}
    Cy = np.eye(4); Cy[:3, :3] = C
    base = {'G': np.eye(4), 'F': np.eye(4)}
    for k, (q, wid, held) in enumerate(frames):
        w.set_arm(q); w.set_gripper_opening(wid); mujoco.mj_kinematics(m, dd)
        for i, g in enumerate(geoms):
            R = C@T_sb[:3, :3]@dd.geom_xmat[g].reshape(3, 3); pos = C@(T_sb[:3, :3]@dd.geom_xpos[g]+T_sb[:3, 3])
            poses[k, i, :3] = pos; poses[k, i, 3:] = Rotation.from_matrix(R).as_quat()
        T_tip = T_sb@w.fk_fingertip(q)
        for b_ in ('G', 'F'):
            if held == b_:
                if b_ not in grab: grab[b_] = T_tip; base[b_] = carried[b_]
                carried[b_] = T_tip@np.linalg.inv(grab[b_])@base[b_]          # rides with the fingertip while held
            elif b_ in grab: del grab[b_]
            track[b_][k] = (Cy@carried[b_]@Cy.T).T.flatten()                  # y-up, column-major (three.js)
    for i in range(len(geoms)):                                          # quaternion continuity
        for k in range(1, len(frames)):
            if np.dot(poses[k, i, 3:], poses[k-1, i, 3:]) < 0: poses[k, i, 3:] *= -1
    info = dict(fps=a.fps, frames=len(frames), geoms=len(geoms), marks={k: v/(len(frames)-1) for k, v in marks.items()},
                poses=np.round(poses, 5).tolist(), work=np.round(track['G'], 6).tolist(), fixture=np.round(track['F'], 6).tolist(), base=list(a.base))
    (out/'fr3_mover.json').write_text(json.dumps(info))
    print('FR3 mover:', len(frames), 'frames,', len(geoms), 'meshes; grasp width', round(width, 3), 'jaw turn', round(np.degrees(turn), 1), 'deg ->', out)


if __name__ == '__main__': main()
