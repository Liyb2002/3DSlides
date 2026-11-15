#!/bin/zsh
# Open a <name>.3Dslides deck in the 3D Slides editor, in the browser: what 3DSlides.app runs when a deck is
# double-clicked (code/tools/make_app.sh). With no deck: the editor of this folder's default deck.
#   code/tools/open_deck.sh [path/to/name.3Dslides]
# Every time, a fresh server: one already serving this deck's 3DSlides folder (on 8000..8020) is stopped and a
# new one started on the same port (so open tabs keep working, now with the current code); else the first free
# port of those. In the background (log: ~/Library/Logs/3DSlides.log). (Only servers of this folder are touched.)
deck="${1%/}"
if [[ -n "$deck" ]]; then
  root="$(cd "$(dirname "$deck")" && pwd -P)"; name="$(basename "$deck")"
else
  root="$(cd "$(dirname "$0")/../.." && pwd -P)"; name=""
fi
[[ -f "$root/code/serve.py" ]] || { echo "“${name:-$deck}” is not in a 3DSlides folder (one with code/serve.py next to it)." >&2; exit 2; }

# node (writing edits back into deck.js), claude / codex (the editor's agent): the usual places too
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
py="$(command -v python3)"; [[ -n "$py" ]] || py=/usr/bin/python3

query=""; [[ -n "$name" ]] && query="?deck=$("$py" -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$name")"
served() { curl -s -m 1 "http://localhost:$1/api/root" | "$py" -c 'import sys, json; sys.exit(json.load(sys.stdin)["root"] != sys.argv[1])' "$root" 2>/dev/null; }

# stop this folder's servers (an old one would serve old code: e.g. not know what a newer editor saves)
ports=()
for port in {8000..8020}; do
  if served $port; then
    ports+=($port)
    for pid in $(lsof -nP -t -iTCP:$port -sTCP:LISTEN 2>/dev/null); do kill $pid 2>/dev/null; done
  fi
done
for port in $ports; do
  for i in {1..25}; do lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.2; done
done

for port in $ports {8000..8020}; do
  lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1 && continue
  mkdir -p "$HOME/Library/Logs"
  nohup "$py" "$root/code/serve.py" $port $name --no-open >>"$HOME/Library/Logs/3DSlides.log" 2>&1 </dev/null &
  for i in {1..50}; do served $port && { open "http://localhost:$port/$query"; exit 0; }; sleep 0.2; done
  echo "the 3D Slides server did not start (see ~/Library/Logs/3DSlides.log)" >&2; exit 1
done
echo "no free port in 8000–8020" >&2; exit 1
