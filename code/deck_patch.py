"""Write editor edits back into a deck's source (deck.js), so the hand-written
file stays the one source of truth.

An edit is (slide id, element id, prop, value). It is written into the deck
when the element is a plain object literal in the slide's `elements`
({ id: 'title', type: 'text', text: '...', x: 110, ... }):
  - the prop is there with a literal value (string / number / null / array of
    strings): the value is replaced;
  - the prop is not there (it comes from a spread such as ...STEP_CARD, or a
    default): `prop: value` is added at the end of the literal (later keys win).
An `added` edit (value: the element's props) appends a new element literal to
the slide's `elements`. Setting `on` (the element's pages) also removes the
slide's show / hide actions that name the element: its pages replace them.
A `deleted: true` edit removes the element literal from `elements`, and the
show / hide / play / pause / seek actions of that slide that name it.
Anything else (an element made by a helper call, a prop holding an expression)
is left to overrides.json. The patched file is checked with `node --check`
before it is written; if that fails nothing is written.

    patch_deck(path, edits) -> list of the edits written
    patch_slides(path, added, deleted) -> (slide ids added, slide ids deleted)
New slides (from the editor: 2D only) are written after the slide they follow;
deleted slides are cut out of the `slides` array.
    patch_order(path, order) -> True when the `slides` array is in that order (slide ids) now
"""
import os, re, shutil, subprocess, tempfile

PROPS = {'text', 'html', 'tex', 'items', 'x', 'y', 'w', 'h', 'on', 'anim', 'delay', 'anchor', 'className', 'type', 'deleted', 'added', 'group', 'shape', 'color', 'fill', 'strokeWidth', 'rotate', 'font', 'fontSize', 'fontWeight', 'fontStyle', 'src', 'camera', 'cameras', 'lights', 'ambient', 'bg', 'lockRatio', 'z'}
ACTION_KEYS = ('show', 'hide', 'play', 'pause', 'seek')
IDENT = re.compile(r'[A-Za-z_$][\w$]*')


def _skip_string(src, i):
    """i at a quote; returns the index after the closing quote."""
    q = src[i]; i += 1
    while i < len(src):
        c = src[i]
        if c == '\\': i += 2; continue
        if q == '`' and src.startswith('${', i):           # template expression: skip balanced braces
            i = _skip_block(src, i + 1); continue
        if c == q: return i + 1
        i += 1
    return i


def _skip_block(src, i):
    """i at an opening bracket; returns the index after its match."""
    depth = 0
    while i < len(src):
        i, c = _skip_trivia(src, i)
        if c is None: return i
        if c in '\'"`': i = _skip_string(src, i); continue
        if c in '([{': depth += 1
        elif c in ')]}':
            depth -= 1
            if depth == 0: return i + 1
        i += 1
    return i


def _skip_trivia(src, i):
    """skip comments; returns (i, char at i or None)."""
    while i < len(src):
        if src.startswith('//', i):
            j = src.find('\n', i); i = len(src) if j < 0 else j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2); i = len(src) if j < 0 else j + 2; continue
        return i, src[i]
    return i, None


def _objects(src):
    """(start, end) of every { ... } in src (end: index after '}')."""
    out, stack, i = [], [], 0
    while i < len(src):
        i, c = _skip_trivia(src, i)
        if c is None: break
        if c in '\'"`': i = _skip_string(src, i); continue
        if c == '{': stack.append(i)
        elif c == '}' and stack: out.append((stack.pop(), i + 1))
        i += 1
    return out


def _members(src, start, end):
    """top-level members of the object literal src[start:end]: list of
    (key or None, value_start, value_end) ; value span trimmed."""
    out, i, seg = [], start + 1, start + 1
    stop = end - 1
    def close(a, b):
        j, c = _skip_trivia(src, a)
        while j < b and src[j].isspace():
            j += 1; j, c = _skip_trivia(src, j)
        m = IDENT.match(src, j)
        key = None
        if m:
            k = m.end()
            while k < b and src[k].isspace(): k += 1
            if k < b and src[k] == ':': key = m.group(0); j = k + 1
        vs = j
        while vs < b and src[vs].isspace(): vs += 1
        ve = b
        # drop a trailing comment / whitespace
        body = src[vs:ve]
        cut = len(body)
        k = 0
        while k < len(body):
            if body[k] in '\'"`': k = _skip_string(body, k); continue
            if body[k] in '([{': k = _skip_block(body, k); continue      # comments inside the value are its own
            if body.startswith('//', k) or body.startswith('/*', k): cut = k; break
            k += 1
        ve = vs + len(body[:cut].rstrip())
        if ve > vs or key: out.append((key, vs, ve))
    while i < stop:
        i, c = _skip_trivia(src, i)
        if c is None or i >= stop: break
        if c in '\'"`': i = _skip_string(src, i); continue
        if c in '([{': i = _skip_block(src, i); continue
        if c == ',': close(seg, i); seg = i + 1
        i += 1
    close(seg, stop)
    return out


def _unescape(body):
    out, i = [], 0
    simple = {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'}
    while i < len(body):
        c = body[i]
        if c != '\\': out.append(c); i += 1; continue
        n = body[i + 1] if i + 1 < len(body) else ''
        if n in simple: out.append(simple[n]); i += 2
        elif n == 'u' and re.fullmatch(r'[0-9a-fA-F]{4}', body[i + 2:i + 6]): out.append(chr(int(body[i + 2:i + 6], 16))); i += 6
        elif n == '\n': i += 2
        else: out.append(n); i += 2
    return ''.join(out)


def _literal(text):
    """(True, value) when text is a JS literal we can read, else (False, None)."""
    t = text.strip()
    if t in ('null', 'undefined'): return True, None
    if re.fullmatch(r'-?\d+(\.\d+)?', t): return True, float(t)
    if t[:1] in '\'"' and t[-1:] == t[:1] and _skip_string(t, 0) == len(t):
        return True, _unescape(t[1:-1])
    if t[:1] == '[' and t[-1:] == ']':
        items = _members('{' + t[1:-1] + '}', 0, len(t))
        vals = []
        for key, a, b in items:
            ok, v = _literal(('{' + t[1:-1] + '}')[a:b])
            if key or not ok or isinstance(v, list): return False, None
            vals.append(int(v) if isinstance(v, float) and v.is_integer() else v)
        return True, vals
    return False, None


def _js(v, indent=None):
    if v is None: return 'null'
    if isinstance(v, dict):
        if indent is None: return '{ ' + ', '.join(f'{k}: {_js(x)}' for k, x in v.items()) + ' }'
        pad = ' ' * (indent + 2)
        return '{\n' + ''.join(f'{pad}{k}: {_js(x, indent + 2) if isinstance(x, list) and any(isinstance(y, dict) for y in x) else _js(x)},\n' for k, x in v.items()) + ' ' * indent + '}'
    if isinstance(v, list) and indent is not None and any(isinstance(y, dict) for y in v):
        pad = ' ' * (indent + 2)
        return '[\n' + ''.join(f'{pad}{_js(y)},\n' for y in v) + ' ' * indent + ']'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(int(v)) if float(v).is_integer() else repr(float(v))
    if isinstance(v, list): return '[' + ', '.join(_js(x) for x in v) + ']'
    s = str(v).replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
    return "'" + s + "'"


def _find(src, objs, slide_id, el_id):
    """the element literal (start, end), or None."""
    def get(o, key):
        for k, a, b in _members(src, *o):
            if k == key: return a, b
        return None
    def is_id(o, ident):
        v = get(o, 'id')
        if not v: return False
        ok, val = _literal(src[v[0]:v[1]])
        return ok and val == ident
    slides = [o for o in objs if is_id(o, slide_id) and get(o, 'elements')]
    if len(slides) != 1: return None
    ea, eb = get(slides[0], 'elements')
    els = [o for o in objs if ea <= o[0] and o[1] <= eb and is_id(o, el_id)]
    if len(els) != 1: return None
    return els[0]


def _actions_naming(src, objs, slide_id, el_id):
    """the action literals of the slide that name the element."""
    slide = [o for o in objs if _is_slide(src, o, slide_id)]
    if len(slide) != 1: return []
    s0, e0 = slide[0]
    out = []
    for o in objs:
        if not (s0 < o[0] and o[1] < e0): continue
        for k, a, b in _members(src, *o):
            if k in ACTION_KEYS:
                ok, v = _literal(src[a:b])
                if ok and v == el_id: out.append(o); break
    return out


def _is_slide(src, o, slide_id):
    mem = {k: (a, b) for k, a, b in _members(src, *o) if k}
    if 'id' not in mem or 'elements' not in mem: return False
    ok, v = _literal(src[slice(*mem['id'])])
    return ok and v == slide_id


def _cut(src, s, e):
    """the span to remove for the array item src[s:e] (with its comma, and its line when it is alone on it)."""
    j = e
    while j < len(src) and src[j] in ' \t': j += 1
    if j < len(src) and src[j] == ',':
        j += 1
        while j < len(src) and src[j] in ' \t': j += 1
    else:                                           # the last item: take the comma before it
        k = s - 1
        while k >= 0 and src[k].isspace(): k -= 1
        if k >= 0 and src[k] == ',': s = k
    ls = src.rfind('\n', 0, s) + 1
    le = src.find('\n', j); le = len(src) if le < 0 else le
    if not src[ls:s].strip() and not src[j:le].strip(): s, j = ls, min(len(src), le + 1)
    return s, j


def patch_deck(path, edits):
    """edits: [(slide_id, el_id, prop, value)]; returns the edits written."""
    src = open(path, encoding='utf-8').read()
    objs = _objects(src)
    changes, done = [], []                      # (pos, end, text)
    inserts = {}
    deleted = set()
    for slide_id, el_id, prop, value in edits:
        if prop != 'deleted' or not value: continue
        o = _find(src, objs, slide_id, el_id)
        if not o: continue
        for item in [o] + _actions_naming(src, objs, slide_id, el_id):
            a, b = _cut(src, *item); changes.append((a, b, ''))
        deleted.add((slide_id, el_id)); done.append((slide_id, el_id, 'deleted'))
    # new elements: appended to the slide's elements (those already in the deck: edited prop by prop)
    expanded = []
    for slide_id, el_id, prop, value in edits:
        if prop != 'added': expanded.append((slide_id, el_id, prop, value)); continue
        if (slide_id, el_id) in deleted: done.append((slide_id, el_id, 'added')); continue
        if _find(src, objs, slide_id, el_id):
            expanded += [(slide_id, el_id, k, v) for k, v in value.items()]
            done.append((slide_id, el_id, 'added')); continue
        slide = [o for o in objs if _is_slide(src, o, slide_id)]
        if len(slide) != 1: continue
        ea, eb = {k: (a, b) for k, a, b in _members(src, *slide[0]) if k}['elements']
        if src[ea] != '[' or src[eb - 1] != ']': continue
        k = eb - 2
        while k > ea and src[k].isspace(): k -= 1
        first = src.find('{', ea)
        ls = src.rfind('\n', 0, first) + 1
        indent = src[ls:first] if 0 <= first < eb and not src[ls:first].strip() else ' ' * 8
        lit = '{ ' + ', '.join([f'id: {_js(el_id)}'] + [f'{p}: {_js(v)}' for p, v in value.items() if p != 'id']) + ' }'
        changes.append((k + 1, k + 1, ('' if src[k] in ',[' else ',') + '\n' + indent + lit + ','))
        done.append((slide_id, el_id, 'added'))
    for slide_id, el_id, prop, value in expanded:
        if prop not in PROPS or prop in ('deleted', 'added'): continue
        if (slide_id, el_id) in deleted: done.append((slide_id, el_id, prop)); continue
        if prop == 'on':                                 # its pages replace its show / hide actions
            for item in _actions_naming(src, objs, slide_id, el_id):
                a, b = _cut(src, *item); changes.append((a, b, ''))
        o = _find(src, objs, slide_id, el_id)
        if not o: continue
        mem = {k: (a, b) for k, a, b in _members(src, *o) if k}
        if prop in mem:
            a, b = mem[prop]
            ok, cur = _literal(src[a:b])
            if not ok: continue
            if cur == value or (isinstance(cur, float) and isinstance(value, (int, float)) and cur == float(value)):
                done.append((slide_id, el_id, prop)); continue
            changes.append((a, b, _js(value)))
        else:
            if value is None: done.append((slide_id, el_id, prop)); continue     # nothing to null out
            inserts.setdefault(o, []).append(f'{prop}: {_js(value)}')
        done.append((slide_id, el_id, prop))
    for (s, e), parts in inserts.items():
        j = e - 1                                   # the closing brace
        k = j - 1
        while k > s and src[k].isspace(): k -= 1
        sep = '' if src[k] in ',{' else ','
        changes.append((k + 1, k + 1, f'{sep} {", ".join(parts)}'))
    if not changes: return done
    out = src
    for a, b, text in sorted(changes, key=lambda c: (c[0], c[1]), reverse=True):
        out = out[:a] + text + out[b:]
    if not _check(out, path): return []
    with open(path, 'w', encoding='utf-8') as f: f.write(out)
    return done


def _check(code, path):
    node = shutil.which('node')
    if not node: return True
    fd, tmp = tempfile.mkstemp(suffix='.mjs', dir=os.path.dirname(path)); os.close(fd)
    try:
        open(tmp, 'w', encoding='utf-8').write(code)
        return subprocess.run([node, '--check', tmp], capture_output=True).returncode == 0
    finally:
        os.remove(tmp)


def patch_slides(path, added, deleted):
    """added: [(slide id, id of the slide it follows, slide dict)]; deleted: [slide id]."""
    src = open(path, encoding='utf-8').read()
    objs = _objects(src)
    changes, done_add, done_del = [], [], []
    slide = lambda sid: [o for o in objs if _is_slide(src, o, sid)]
    for sid in deleted:
        o = slide(sid)
        if len(o) != 1: continue
        a, b = _cut(src, *o[0])
        if src[a - 2:a] == '\n\n': a -= 1                       # and the blank line before it
        changes.append((a, b, '')); done_del.append(sid)
    for sid, after, d in added:
        if slide(sid): done_add.append(sid); continue                 # already there
        o = slide(after) if after else []
        if len(o) != 1 or after in done_del: continue
        s0, e0 = o[0]
        ls = src.rfind('\n', 0, s0) + 1
        indent = src[ls:s0] if not src[ls:s0].strip() else '    '
        j = e0
        while j < len(src) and src[j] in ' \t': j += 1
        if j < len(src) and src[j] == ',': j += 1
        else: changes.append((e0, e0, ','))
        if 'copyOf' in d:                                # a copy of a slide: its source text, with the new id
            c = slide(d['copyOf'])
            if len(c) != 1: continue
            cs, ce = c[0]
            mem = {k: (a, b) for k, a, b in _members(src, cs, ce) if k}
            ia, ib = mem['id']
            lit = indent + src[cs:ia] + _js(sid) + src[ib:ce]
        else:
            lit = indent + _js(d, len(indent))
        changes.append((j, j, '\n\n' + lit + ','))
        done_add.append(sid)
    if not changes: return done_add, done_del
    out = src
    for a, b, text in sorted(changes, key=lambda c: (c[0], c[1]), reverse=True):
        out = out[:a] + text + out[b:]
    if not _check(out, path): return [], []
    with open(path, 'w', encoding='utf-8') as f: f.write(out)
    return done_add, done_del


def _items(src, a, b):
    """top-level items of the array literal src[a:b] (a at '[', b after ']'): [(start, end)], trimmed."""
    out, i, seg = [], a + 1, a + 1
    stop = b - 1
    def close(x, y):
        x, _ = _skip_trivia(src, x)
        while x < y and src[x].isspace():
            x += 1; x, _ = _skip_trivia(src, x)
        while y > x and src[y - 1].isspace(): y -= 1
        if y > x: out.append((x, y))
    while i < stop:
        i, c = _skip_trivia(src, i)
        if c is None or i >= stop: break
        if c in '\'"`': i = _skip_string(src, i); continue
        if c in '([{': i = _skip_block(src, i); continue
        if c == ',': close(seg, i); seg = i + 1
        i += 1
    close(seg, stop)
    return out


def patch_pages(path, slide_id, ops):
    """page edits of one slide, in order: {'add': True} appends an empty page (step), {'del': k} removes page k
    (its step, k >= 1; k = 0: the first step's actions go to the end of `enter`, then that step goes),
    {'ins': k} puts an empty step in at index k (a new page k + 1, after page k: a duplicate of it),
    {'perm': [old page, ...]} reorders the pages (page 0's actions are `enter`'s).
    Returns how many ops were written (all or none)."""
    src = open(path, encoding='utf-8').read()
    for n, op in enumerate(ops):
        objs = _objects(src)
        slide = [o for o in objs if _is_slide(src, o, slide_id)]
        if len(slide) != 1: return 0
        mem = {k: (a, b) for k, a, b in _members(src, *slide[0]) if k}
        if 'steps' not in mem:
            if not op.get('add'): return 0
            ea, eb = mem['elements']                       # a steps member after the elements
            src = src[:eb] + ',\n      steps: [[]]' + src[eb:]
            continue
        a, b = mem['steps']
        if src[a] != '[' or src[b - 1] != ']': return 0
        items = _items(src, a, b)
        if 'ins' in op:
            k = int(op['ins'])
            if not 0 <= k <= len(items): return 0
            if not items: src = src[:a] + '[[]]' + src[b:]
            elif k < len(items): s0 = items[k][0]; src = src[:s0] + '[], ' + src[s0:]
            else: e = items[-1][1]; src = src[:e] + ', []' + src[e:]
            continue
        if 'perm' in op:
            perm = [int(x) for x in op['perm']]
            if sorted(perm) != list(range(len(items) + 1)): return 0
            def actions_of(text):                               # an action list's inner text
                t = text.strip()
                if t.startswith('['): return t[1:-1].strip().rstrip(',')
                if t.startswith('{'):
                    m = re.search(r'\bactions\s*:\s*\[', t)
                    if not m: return t                          # a single action
                    j = _skip_block(t, m.end() - 1); return t[m.end():j - 1].strip().rstrip(',')
                return t
            if 'enter' in mem: ea, eb = mem['enter']; enter_txt = src[ea:eb]
            else: enter_txt = '[]'
            lists = [actions_of(enter_txt)] + [actions_of(src[x:y]) for x, y in items]
            new = [lists[p_] for p_ in perm]
            steps_txt = '[' + ', '.join('[' + t + ']' for t in new[1:]) + ']'
            src = src[:a] + steps_txt + src[b:]                 # steps (after enter) first
            if 'enter' in mem: src = src[:ea] + '[' + new[0] + ']' + src[eb:]
            elif new[0]:
                key = src.rfind('steps', 0, a); src = src[:key] + 'enter: [' + new[0] + '],\n      ' + src[key:]
            continue
        if op.get('add'):
            if items:
                e = items[-1][1]; src = src[:e] + ', []' + src[e:]
            else: src = src[:a] + '[[]]' + src[b:]
        elif int(op['del']) == 0:
            if not items: return 0
            s0, e0 = items[0]
            body = src[s0:e0]
            if body.startswith('['): inner = body[1:-1].strip()
            elif body.startswith('{'):
                mm = {k: (a, b) for k, a, b in _members(src, s0, e0) if k}
                if 'actions' not in mm: inner = body                         # a single action
                else: a2, b2 = mm['actions']; inner = src[a2 + 1:b2 - 1].strip()
            else: return 0
            inner = inner.rstrip().rstrip(',')
            s, e = _cut(src, s0, e0); src = src[:s] + src[e:]               # the step goes (it is after `enter`)
            if inner:
                if 'enter' in mem:
                    ea, eb = mem['enter']
                    if src[ea] == '[':
                        k2 = eb - 2
                        while k2 > ea and src[k2].isspace(): k2 -= 1
                        sep = '' if src[k2] in '[,' else ', '
                        src = src[:k2 + 1] + sep + inner + src[k2 + 1:]
                    else: src = src[:ea] + '[' + src[ea:eb] + ', ' + inner + ']' + src[eb:]
                else:
                    sa, sb = mem['steps']
                    ls = src.rfind('\n', 0, sa) ; key = src.rfind('steps', 0, sa)
                    src = src[:key] + 'enter: [' + inner + '],\n      ' + src[key:]
        else:
            k = int(op['del'])
            if not 1 <= k <= len(items): return 0
            s, e = _cut(src, *items[k - 1]); src = src[:s] + src[e:]
    if not _check(src, path): return 0
    with open(path, 'w', encoding='utf-8') as f: f.write(src)
    return len(ops)


def patch_order(path, order):
    """put the slides of the deck's `slides` array in `order` (slide ids; the others keep their places). Only when
    every item of the array is a slide literal with a literal id (else False: the order stays in overrides.json)."""
    src = open(path, encoding='utf-8').read()
    arrays = []
    for o in _objects(src):
        for k, a, b in _members(src, *o):
            if k == 'slides' and src[a] == '[' and src[b - 1] == ']': arrays.append((a, b))
    if len(arrays) != 1: return False
    items = _items(src, *arrays[0])
    ids = []
    for s0, e0 in items:
        if src[s0] != '{': return False
        mem = {k: (a, b) for k, a, b in _members(src, s0, e0) if k}
        if 'id' not in mem: return False
        ok, v = _literal(src[slice(*mem['id'])])
        if not ok or not isinstance(v, str): return False
        ids.append(v)
    rank = {sid: k for k, sid in enumerate(order)}
    at = [i for i, sid in enumerate(ids) if sid in rank]
    moved = sorted(at, key=lambda i: rank[ids[i]])
    perm = list(range(len(items)))
    for i, j in zip(at, moved): perm[i] = j                     # place i gets the item that was at j
    if perm == list(range(len(items))): return True
    out, last = [src[:arrays[0][0]]], arrays[0][0]
    for i, (s0, e0) in enumerate(items):
        out.append(src[last:s0]); out.append(src[slice(*items[perm[i]])]); last = e0
    out = ''.join(out) + src[last:]
    if not _check(out, path): return False
    with open(path, 'w', encoding='utf-8') as f: f.write(out)
    return True
