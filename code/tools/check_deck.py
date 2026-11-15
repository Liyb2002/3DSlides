"""Check a deck's source for syntax errors (as an ES module, the way the browser loads it).

    python3 code/tools/check_deck.py demo.3Dslides            -> "ok demo.3Dslides/deck.js" or the error, exit 1
    python3 code/tools/check_deck.py demo.3Dslides/clips.js
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
arg = sys.argv[1] if len(sys.argv) > 1 else 'demo.3Dslides'
path = os.path.join(ROOT, arg) if not os.path.isabs(arg) else arg
if os.path.isdir(path): path = os.path.join(path, 'deck.js')
fd, tmp = tempfile.mkstemp(suffix='.mjs'); os.close(fd)
try:
    shutil.copy(path, tmp)
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    if r.returncode == 0: print('ok', os.path.relpath(path, ROOT)); sys.exit(0)
    print((r.stderr or r.stdout).replace(tmp, os.path.relpath(path, ROOT)).strip()); sys.exit(1)
finally:
    os.remove(tmp)
