"""A big sleepy orange tabby, lying down, as a .glb (for the product video: a shape dropped into a 3D scene).

    python3 code/tools/make_cat_glb.py video/assets/big_cat.glb

Built from ellipsoids and cones (numpy only); one primitive per colour. Length about 2.6 (x), y up, lying on y = 0,
head toward +x.
"""
import json, struct, sys
import numpy as np

def sphere(n=28, m=18):
    u = np.linspace(0, 2 * np.pi, n + 1)[:-1]; v = np.linspace(0, np.pi, m + 1)
    P = np.array([[np.sin(b) * np.cos(a), np.cos(b), np.sin(b) * np.sin(a)] for b in v for a in u])
    I = []
    for j in range(m):
        for i in range(n):
            a, b, c, d = j * n + i, j * n + (i + 1) % n, (j + 1) * n + i, (j + 1) * n + (i + 1) % n
            I += [[a, b, c], [b, d, c]]
    return P, P.copy(), np.array(I)

def cone(n=20):
    u = np.linspace(0, 2 * np.pi, n + 1)[:-1]
    ring = np.array([[np.cos(a), 0, np.sin(a)] for a in u])
    P = np.vstack([ring, [[0, 1, 0]] * n, ring, [[0, 0, 0]]])
    N = np.vstack([np.array([[np.cos(a), 0.5, np.sin(a)] for a in u])] * 2 + [[[0, -1, 0]] * (n + 1)])
    I = [[i, n + i, (i + 1) % n] for i in range(n)] + [[2 * n + (i + 1) % n, 3 * n, 2 * n + i] for i in range(n)]
    return P, N, np.array(I)

def rot(rx=0, ry=0, rz=0):
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    return (np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]) @ np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
            @ np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]]))

parts = {}                                     # colour -> [(P, N, I)]
def add(color, shape, scale, pos, r=(0, 0, 0)):
    P, N, I = shape
    R, s = rot(*r), np.array(scale, float)
    n = (N / s) @ R.T
    parts.setdefault(color, []).append(((P * s) @ R.T + np.array(pos), n / np.linalg.norm(n, axis=1, keepdims=True), I))

S, C = sphere(), cone()
ORANGE, DARK, CREAM, PINK, BLACK = (0.93, 0.52, 0.13), (0.72, 0.33, 0.07), (0.99, 0.93, 0.82), (0.95, 0.55, 0.6), (0.12, 0.08, 0.06)
add(ORANGE, S, (1.0, 0.42, 0.52), (0, 0.42, 0))                                   # body
for x in (-0.62, -0.36, -0.1, 0.16, 0.42):                                        # tabby stripes over the back
    f = np.sqrt(1 - x * x) * 1.015
    add(DARK, S, (0.055, 0.42 * f, 0.52 * f), (x, 0.435, 0), (0, 0, 0.12))
add(CREAM, S, (0.5, 0.2, 0.36), (0.45, 0.24, 0))                                  # chest and belly
add(ORANGE, S, (0.36, 0.33, 0.36), (1.08, 0.46, 0.04), (0, 0, -0.1))               # head, resting
add(CREAM, S, (0.15, 0.12, 0.2), (1.36, 0.38, 0.04))                              # muzzle
add(PINK, S, (0.04, 0.03, 0.045), (1.5, 0.42, 0.04))                              # nose
for s in (-1, 1):
    add(ORANGE, C, (0.13, 0.26, 0.1), (1.0, 0.7, 0.04 + s * 0.2), (s * 0.25, 0, -0.1))    # ears
    add(PINK, C, (0.07, 0.17, 0.05), (1.03, 0.71, 0.04 + s * 0.2), (s * 0.25, 0, -0.1))
    add(BLACK, S, (0.012, 0.018, 0.075), (1.385, 0.53, 0.04 + s * 0.15), (s * 0.5, 0, 0))    # eyes, closed: content
    add(ORANGE, S, (0.42, 0.1, 0.12), (1.25, 0.1, s * 0.3), (0, -s * 0.12, 0))               # front legs, stretched out
    add(CREAM, S, (0.11, 0.085, 0.115), (1.63, 0.09, s * 0.345))                             # paws
    add(ORANGE, S, (0.38, 0.27, 0.2), (-0.55, 0.26, s * 0.42))                               # haunches
    add(CREAM, S, (0.14, 0.08, 0.1), (-0.2, 0.08, s * 0.6))                                  # hind paws
    add(DARK, S, (0.03, 0.06, 0.09), (1.1, 0.77, 0.04 + s * 0.09), (0, 0, -0.1))             # forehead stripes
for k in range(16):                                                               # the tail, curling round to the side
    a = k / 15 * 2.2
    r = 0.12 - 0.003 * k
    add(DARK if k % 4 == 3 else ORANGE, S, (r, r, r), (-0.95 - 0.55 * np.sin(a), 0.14, 0.62 - 0.62 * np.cos(a)))
add(CREAM, S, (0.11, 0.11, 0.11), (-0.95 - 0.55 * np.sin(2.3), 0.14, 0.62 - 0.62 * np.cos(2.3)))   # its tip

buf, views, accs, prims, mats = b'', [], [], [], []
def push(arr, target):
    global buf
    b = arr.tobytes(); views.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(b), 'target': target})
    buf += b + b'\0' * (-len(b) % 4)
    return len(views) - 1
for color, chunks in parts.items():
    P, N, I, off = [], [], [], 0
    for p, n, i in chunks: P.append(p); N.append(n); I.append(i + off); off += len(p)
    P, N, I = np.vstack(P).astype('<f4'), np.vstack(N).astype('<f4'), np.vstack(I).astype('<u4')
    accs += [{'bufferView': push(P, 34962), 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
             {'bufferView': push(N, 34962), 'componentType': 5126, 'count': len(N), 'type': 'VEC3'},
             {'bufferView': push(I, 34963), 'componentType': 5125, 'count': I.size, 'type': 'SCALAR'}]
    mats.append({'pbrMetallicRoughness': {'baseColorFactor': [*(c ** 2.2 for c in color), 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}})
    prims.append({'attributes': {'POSITION': len(accs) - 3, 'NORMAL': len(accs) - 2}, 'indices': len(accs) - 1, 'material': len(mats) - 1})
gltf = {'asset': {'version': '2.0', 'generator': '3DSlides make_cat_glb.py'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'big_cat'}],
        'meshes': [{'primitives': prims}], 'materials': mats, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}]}
js = json.dumps(gltf).encode(); js += b' ' * (-len(js) % 4)
out = sys.argv[1] if len(sys.argv) > 1 else 'big_cat.glb'
with open(out, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\0') + buf)
print('wrote', out, len(buf) // 1024, 'kB')
