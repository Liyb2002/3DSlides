---
name: general_skills
description: How the 3D Slides system works (deck files, scenes, pages, elements, 3D, lights, the editor's saved state) so an agent can edit a talk correctly. Read this before changing anything.
---

# 3D Slides — what an agent needs to know

You are working in the `3DSlides/` folder. The user has the editor open in a browser
(`code/serve.py` serves it); it **reloads the deck by itself** when its files change on disk.
So: edit files, never start servers or browsers, never run long jobs unless asked.

## Folders

```
3DSlides/
  code/            the engine + editor (do not change unless the user asks for a feature)
    serve.py         local server: saves editor edits, writes them back into deck.js
    deck_patch.py    the write-back (only plain literals are written; the rest stays in overrides.json)
    src/engine/      player, slide (pages), actions, elements, camera, lights, model views
    src/editor/      the editor UI
    src/scenes/      shared 3D scene helpers (gltf_utils.js, model_scene.js)
    tools/           data / GIF tools (python, node)
  demo.3Dslides/            the talk ("deck"): one folder per deck
    deck.js          THE source of the talk (an ES module exporting the deck object)
    overrides.json   editor edits not (yet) written into deck.js — applied on top of deck.js at load
    scenes/          3D scene factories used by deck.js
    assets/          models, GIFs, images, uploads (assets/models/uploads, assets/media/uploads)
  user/            the user's own space: agent.json (approval, sessions), general_skills, user_skills
  3d_slides_design.md   the full design notes (Chinese); read it when you need details
```

## Words

- **scene** = one entry of `deck.slides` (a "slide" in the code). 2D (`type: '2d'`, fixed camera) or 3D (`type: '3d'`).
- **page** = one click inside a scene. The editor counts pages **from 1**; in the data, page 0 is the scene as it
  enters (`enter` actions) and page k is after k clicks (`steps[k-1]`). So editor page n = data page n−1.

## A scene in deck.js

```js
{
  id: 'problem_setup', type: '3d',            // id: unique, snake_case
  scene: problemSetup, sceneOptions: {...},   // 3D: a scene factory (demo.3Dslides/scenes/*.js) — or `model: 'assets/…stl'`
  camera: 'station' | { position, target, fov },   poses: { name: {position, target, fov} },
  background: '#ffffff', near, far, lensShift,
  elements: [ ... ],                          // the 2D layer (text, images, …), also over 3D scenes
  enter: [ actions ],                         // page 0
  steps: [ [actions], [actions], ... ],       // page 1, 2, … (one array per click)
}
```

Actions (`code/src/engine/actions.js`): `{show:id, anim, delay}`, `{hide:id}`, `{camera:'pose'|{…}, duration}`,
`{orbit:deg}`, `{sim:'play', until:'marker', speed}`, `{do:'sceneAction', args}`, `{wait:s}`, `{play/pause/seek: videoId}`.
All take `delay` (s, from the start of the page).

## Elements (2D layer; stage is 1920 × 1080 px, origin top-left)

`{ id, type, x, y, w, h, on: [from, to], anim, delay, ... }`
- `on`: the **data** pages it is on (`to: null` = to the end). This replaces show/hide actions for it.
- types: `text` (`text` with light markup: `**bold**`, `*italic*`, `$math$`, `\n`), `math` (`tex`), `image` (`src`),
  `video` (`src`, `loop`, `autoplay`), `html`, `bullets` (`items`), `shape` (`shape`: square | circle | triangle | line |
  arrow | dashed; `color`, `fill`, `strokeWidth`), `model` (a small 3D view of `src` on a 2D scene; `cameras: {page: pose}`).
- look: `className` (heading, caption, panel-title, label, card, …: see `code/src/style.css`), `style: {…}`,
  `font` (Inter, Roboto, Open Sans, Lato, Source Serif 4, Merriweather, JetBrains Mono, Helvetica), `fontSize`,
  `fontWeight`, `fontStyle`, `color` (text color; a shape's line), `bg` (a box behind text), `rotate` (deg), `z` (layer, ≥ 0),
  `group`, `lockRatio`, `anchor` (3D scenes: follows a 3D point the scene names; x/y are pixel offsets then).
- Elements with the same kind and content on two neighbouring pages (e.g. a copy) **move** between them instead of fading.
  The same holds from the last page shown of one scene to the first page of the next (2D or 3D): a picture pasted
  into the next scene is carried over, moving to its new place while the scenes cross-fade.

## 3D

- A scene factory (`demo.3Dslides/scenes/*.js`) gets `{ scene, renderer, camera, options, baseUrl }` and returns
  `{ poses, markers, anchors, actions, simStep, reset, frame }`. Units: metres, y up.
- `def.models: { id: { src, position, size, stretch, quat | turn } }` — 3D shapes uploaded in the editor (overrides.json).
  A shape can move between pages: `pages: { page: { position, size, stretch, quat | turn } }` is where it is from that
  (data) page on; it glides there when the page comes. `since`: the page it was added on.
- Lights (`code/src/engine/lights.js`): `def.lights: { id: { type: 'point' | 'spot', position, target, intensity (0–40),
  angle (spot, deg), soft, color, on: [from, to], hidden } }`; `def.ambient: { page: level }` (0 dark, 0.5 as is, 1 white).
  A 2D scene has no lights of its own: each `model` element (3D view) on it has its own `lights` / `ambient` (same
  shape), in the model's own frame (model centred, largest side 1).
- `def.pageCameras: { page: pose }` — the camera a page ends on (editor's "set as current camera").

## The editor's agent panel (you)

- Closing the panel (✕) does **not** end or erase the conversation: your session goes on (resumed with the next
  message) and the user's log is kept. Only `/clear` (or Disconnect) starts a new one. So remember what was said
  and done before; do not greet or re-introduce yourself when the panel is opened again.
- Each time the panel opens, the editor's first line in it tells the user where they are: "You are on scene n (id,
  2D/3D), page k of m." Every message you get starts with the same (scene / page / selection, in the editor's
  numbering: from 1). Use those numbers when you talk about scenes and pages, and act on the scene the user is on
  unless they name another; if it changed since the last message, say which scene and page you are working on.

## A new 3D scene ("+ New 3D scene → Generate")

The editor asks you to generate one: first say you will and ask what it should show; build it once the user answers.
- A scene factory `<deck>/scenes/<snake_case_name>.js` (see the others there, and `code/src/scenes/gltf_utils.js`:
  `paperStudio` for the usual white studio look, `loadGLB`, …). Build the geometry with three.js, or use models in
  `<deck>/assets/models/` (make new ones only if asked). Name what the camera should go to in `poses`.
- Import it at the top of deck.js and add `{ id: '<snake_case>', type: '3d', scene: <factory>, camera: …, elements: [],
  enter: [], steps: [] }` right after the scene the user was on (the editor tells you which). A title or a few steps
  (camera moves, `do` actions) only if the user asks for them.
- Check deck.js (below); the editor reloads by itself and shows the new scene.

## Where an edit goes

- **deck.js** is the source. Prefer editing it directly (keep its style and comments).
- **overrides.json** holds editor edits that could not go into deck.js (or not yet): per scene id —
  `elements: { id: {props} | {deleted: true} | {added: true, …} }`, `poses`, `camera`, `pageCameras`, `pageOps`,
  `models`, `lights`, `ambient`, and new / deleted scenes (`added`, `after`, `def`, `deleted`). Values there **win over
  deck.js**. If you change something in deck.js that overrides.json also sets, update or remove that entry too, or your
  change will not show.
- After editing deck.js check it: `python3 code/tools/check_deck.py demo.3Dslides` (plain `node --check` reads it as CommonJS and fails).

## Rules

- Keep the user's own edits; change only what is asked. Do not reformat files.
- Follow user/user_skills/ (the user's preferences), but do not write there yourself: when a session ends the editor
  asks the user which preferences to keep and saves them (user_skills/preferences.md).
- New files / folders: snake_case names, no spaces (the paper's AGENTS.md).
- Paths in the deck are relative to the deck folder (`assets/...`).
- Answer in the user's language, briefly: what you changed and where.
