// The editor in English or Chinese (the "中 | EN" button at the right of the top bar; kept in this browser).
//
// The editor is written in English. In Chinese, its own words are translated where they are shown: every text
// and tooltip (title / placeholder) of the editor's interface, as it is built and as it changes (a
// MutationObserver), by the table below (whole strings) and the patterns after it (strings with numbers or
// names in them). What the talk itself says (the slides, the scene list's titles, the deck's title, what you
// type, what the agent writes) is never touched.
//
//   import { LANG, t, startI18n, langButton } from './i18n.js';
//   t('Send')          -> '发送' in Chinese, 'Send' in English (for text made in code, e.g. a new text box's default)

const KEY = '3dslides:lang';
let stored = null;
try { stored = localStorage.getItem(KEY); } catch { /* none */ }
export const LANG = stored === 'zh' ? 'zh' : 'en';

const ZH = {
  // presenter / practice mode, scene notes (present/talk_view.js)
  'Presenter mode': '演讲者模式', 'Practice mode': '练习模式',
  'Shift+P: from the start, in two windows: the slide full screen (audience) and notes + a small slide (you)': 'Shift+P：从头开始，两个窗口：全屏幻灯片（观众）和备注 + 小幻灯片（你）',
  'rehearse with the microphone: what you say on each scene is written down, then AI tidies it into the scene’s notes': '用麦克风排练：记下你在每个场景说的话，再由 AI 理顺成该场景的备注',
  'Close scene notes': '关闭场景备注', 'Scene notes': '场景备注',
  'what you say on this scene (all its pages): shown in presenter mode': '你在这个场景（所有页）要说的话：在演讲者模式中显示',
  'what you say on this scene (all its pages); presenter mode shows it': '你在这个场景（所有页）要说的话；演讲者模式会显示',
  'notes follow the scene, not the page · Practice mode can write them from what you say': '备注跟随场景，不跟随页 · 练习模式可以根据你说的话来写',
  'Presenter': '演讲者', 'Practice': '练习', 'End': '结束', 'audience window': '观众窗口', 'smaller notes': '备注字小一点', 'larger notes': '备注字大一点',
  'open the audience window again (drag it to the projector, then F: full screen)': '重新打开观众窗口（拖到投影上，再按 F 全屏）',
  'Esc: end the show and go back to the editor': 'Esc：结束放映，回到编辑器', 'Esc: back to the editor': 'Esc：回到编辑器',
  'time since the start · click: pause / go on · double-click: back to 0': '开始以来的时间 · 单击：暂停 / 继续 · 双击：归零',
  '→ / space / click: next · ←: back · Esc: end · the audience window follows': '→ / 空格 / 单击：下一步 · ←：上一步 · Esc：结束 · 观众窗口会跟着走',
  'No notes for this scene. Write them in the editor (“scene notes”) or in Practice mode.': '这个场景还没有备注。可以在编辑器（“场景备注”）或练习模式里写。',
  'next scene · ': '下一个场景 · ', 'last scene': '最后一个场景',
  'Record': '录音', 'Stop recording': '停止录音', 'click again to clear all': '再点一次全部清除', 'forget every scene’s recording and suggestion (click twice)': '清除所有场景的录音文字和建议（点两次）', 'save every scene’s suggestion as its notes': '把每个场景的建议都保存为备注', 'listening…': '正在听…', 'microphone not allowed': '麦克风未授权',
  'speech recognition needs the network': '语音识别需要联网', 'speech recognition is not available in this browser: use Chrome': '这个浏览器不支持语音识别：请用 Chrome',
  'the language you speak (speech recognition)': '你说的语言（语音识别）',
  'What you said · this scene': '你说的话 · 本场景', 'clear': '清除', 'forget what was recorded for this scene (to say it again)': '清除本场景的录音文字（重新说一遍）',
  'Notes · this scene': '备注 · 本场景', 'no notes yet': '还没有备注', 'AI suggestion': 'AI 建议', 'discard': '丢弃', 'use as notes': '用作备注',
  'save it as this scene’s notes': '保存为本场景的备注', 'clear all': '全部清除', 'forget every scene’s recording and suggestion': '清除所有场景的录音文字和建议',
  'AI: tidy what I said into notes': 'AI：把我说的话理顺成备注',
  'the agent connected in the editor tidies each recorded scene into notes, close to your own words; nothing is saved until you accept it': '编辑器里连接的 AI 把每个录过的场景理顺成备注，尽量保留你的原话；你接受之前不会保存',
  'speak: it is written down here for this scene': '说吧：会记在这个场景下', 'press Record, then talk through the scene': '按“录音”，然后把这个场景讲一遍',
  'nothing recorded yet': '还没有录到内容', 'AI suggestions': 'AI 建议', 'use all as notes': '全部用作备注', 'close': '关闭', 'skip': '跳过',
  'notes now': '现在的备注', 'suggestion (edit freely)': '建议（可以直接改）', 'F: full screen · this window follows the presenter window': 'F：全屏 · 这个窗口跟随演讲者窗口',
  // the top bar
  '▶ Run from this slide': '▶ 从此页放映', 'Run from start': '从头放映', '◀ step': '◀ 上一步', 'step ▶': '下一步 ▶',
  '↶ undo': '↶ 撤销', '↷ redo': '↷ 重做', 'Connect to agent': '连接 Agent', 'saving…': '保存中…', 'saved ✓': '已保存 ✓',
  'updated from disk': '已从磁盘更新', 'not saved — start the server with: python3 code/serve.py': '未保存：请先运行 python3 code/serve.py',
  'P: present from the page shown': 'P：从当前页放映', 'Shift+P': 'Shift+P：从头放映', '←': '←：上一步', '→ (plays the animation)': '→：下一步（播放动画）',
  'undo (⌘Z)': '撤销（⌘Z）', 'redo (⌘⇧Z)': '重做（⌘⇧Z）',
  // the scene list
  '+ New 2D scene': '+ 新建 2D 场景', '+ New 3D scene': '+ 新建 3D 场景', 'click: edit · double-click: run from here': '单击：编辑 · 双击：从这里放映',
  'duplicate this scene (2D or 3D)': '复制这个场景（2D 或 3D）', 'delete this scene': '删除这个场景',
  'a new 2D scene (fixed camera) after the current one': '在当前场景后新建一个 2D 场景（固定镜头）',
  'a new 3D scene: from a model file you upload, or generated by the agent': '新建 3D 场景：上传模型文件，或让 Agent 生成',
  'New 3D scene': '新建 3D 场景', 'Upload…': '上传…', 'Generate': '生成', 'Cancel': '取消',
  'the agent makes it (you will be asked to approve one first if none is connected)': '由 Agent 生成（若还没连接 Agent，会先请你授权）',
  // pages
  '⧉ duplicate page': '⧉ 复制此页', '✕ delete page': '✕ 删除此页', 'add a page (one more click) at the end': '在最后加一页（多一次点击）',
  'a copy of the page shown, right after it': '在当前页之后复制一页', 'delete the page shown; the pages after it move up': '删除当前页，后面的页往前移',
  // camera, lights
  'set as current camera': '设为此页镜头', 'the view now becomes the camera of the page shown (where its camera move ends)': '把现在的视角设为当前页的镜头（镜头移动的终点）',
  'Light': '灯光', 'Lights': '灯光', '+ Point': '+ 点光源', '+ Spot': '+ 聚光灯', 'show markers': '显示灯标', 'hide markers': '隐藏灯标',
  'the light balls on the scene (editor only)': '场景里的灯标（只在编辑器里显示）', 'ambient': '环境光', 'strength': '强度', 'level': '亮度',
  'color': '颜色', 'angle': '角度', 'soft': '柔和', 'from': '从', 'at': '位置', 'to': '到', 'delete this light': '删除这盏灯',
  '0 = dark · 0.5 = as it is · 1 = white': '0 = 全暗 · 0.5 = 原样 · 1 = 全白', '0 = dark, 0.5 = the scene as it is, 1 = white': '0 = 全暗，0.5 = 场景原样，1 = 全白',
  'spot': '聚光灯', 'point': '点光源', 'directional': '平行光',
  'hidden (off): click to show': '已隐藏（关闭）：点击显示', 'click to hide (turn off)': '点击隐藏（关闭）',
  // elements
  'Element': '元素', 'Add': '添加', '+ Text': '+ 文字', '+ Symbol': '+ 图形', '+ Shape': '+ 3D 模型', '+ Media': '+ 图片/视频',
  'nothing on this page': '此页没有元素', 'all': '全部', 'hidden': '隐藏', 'shape': '模型', 'text': '文字', 'media': '图片/视频', 'symbol': '图形', 'math': '公式',
  'a 3D shape in the scene': '场景里的 3D 模型', 'in the scene on every page': '在每一页的场景里', 'delete this 3D shape': '删除这个 3D 模型',
  'a 3D view': '3D 视图', 'a 2D element': '2D 元素', 'pages it is on · click to change': '它出现的页 · 点击修改',
  'duplicate onto this page (or ⌘C, then ⌘V on any page / slide)': '复制到此页（或 ⌘C，再在任意页 ⌘V）',
  'delete this element (and its show / hide actions)': '删除这个元素（连同它的出现/消失动作）',
  'a model file (stl, obj, ply, glb, gltf, 3mf): in a 3D scene it goes into the scene (move it below); in a 2D scene it is an isometric 3D view':
    '模型文件（stl、obj、ply、glb、gltf、3mf）：在 3D 场景里放进场景（下面可移动）；在 2D 场景里是一个 3D 小视图',
  'an image (png, jpg, gif, webp, svg) or a video (mp4, webm, mov) on this page': '在此页放一张图片（png、jpg、gif、webp、svg）或一段视频（mp4、webm、mov）',
  'replace image…': '替换图片…', 'another picture in this place: same position, width and frame; the height follows the new picture': '换一张图：位置、宽度和边框不变，高度跟着新图',
  'size': '大小', 'turn': '旋转', 'pages': '页', 'pinned to': '固定在', '— fixed on the slide': '— 固定在幻灯片上', 'layer': '图层', 'box': '底框',
  'items (one per line)': '条目（每行一条）', 'tex': '公式', 'font': '字体', 'font size (px)': '字号（像素）', 'more colours': '更多颜色',
  'bold: select words in the text below': '加粗：先在下面的文字里选中', 'italic: select words in the text below': '斜体：先在下面的文字里选中',
  'to the front (⌘])': '置于顶层（⌘]）', 'to the back (⌘[) — still above the background': '置于底层（⌘[），仍在背景之上',
  'Group': '编组', 'Ungroup': '取消编组', '⌘G': '⌘G：编组', '⇧⌘G': '⇧⌘G：取消编组', 'deleted:': '已删除：', 'restore it': '恢复',
  'drag: move it': '拖动：移动它', 'drag in it: turn its camera (this page) · scroll: zoom': '在里面拖动：转动它的镜头（此页）· 滚轮：缩放',
  '🔒 camera locked · click to adjust': '🔒 镜头已锁定 · 点击调整', '🔓 camera unlocked · click to lock': '🔓 镜头已解锁 · 点击锁定',
  'lock the proportions': '锁定比例', 'proportions locked: click to unlock': '比例已锁定：点击解锁', 'proportions locked: the face dots scale it as a whole': '比例已锁定：拖面上的点会整体缩放',
  'drag to turn': '拖动旋转', 'drag to resize': '拖动缩放', 'no box': '无底框',
  'camera unlocked: drag in it turns it, scroll zooms (saved as this page\'s camera) · click to lock': '镜头已解锁：拖动转动，滚轮缩放（存为此页镜头）· 点击锁定',
  'camera locked: a drag moves the shape · click to unlock and turn its camera': '镜头已锁定：拖动会移动模型 · 点击解锁后可转动镜头',
  'New text': '新文字', 'New slide': '新幻灯片',
  // the agent
  'Connect an agent': '连接 Agent', 'Approving one runs it in this folder with this command:': '授权后，它会在这个文件夹里用以下命令运行：',
  'Approve Claude Code': '授权 Claude Code', 'Approve Codex': '授权 Codex', 'Not now': '暂不',
  'It reads, writes and runs things in this folder without asking you each time.': '它会在这个文件夹里读写文件、运行命令，不会每次都问你。',
  'It first reads user/general_skills and user/user_skills.': '它会先读 user/general_skills 和 user/user_skills。',
  'You approve once; it is kept in user/agent.json. Disconnect (in the panel) takes it back.': '只需授权一次，记录在 user/agent.json；在面板里点「断开」可撤回。',
  'Send': '发送', 'Stop': '停止', '/clear': '/clear', 'Disconnect': '断开', 'hide': '收起',
  'Tell the agent what to change… (Enter: send · Shift+Enter: new line)': '告诉 Agent 要改什么…（Enter 发送 · Shift+Enter 换行）',
  'clear: forget this conversation, start a new one (also: type /clear)': '清空：忘掉这次对话，重新开始（也可以输入 /clear）',
  'stop using this agent (you will be asked again)': '停用这个 Agent（下次会重新询问）', 'let Claude Code or Codex work on this talk with you': '让 Claude Code 或 Codex 和你一起做这个讲稿',
  'Remember your preferences?': '记住你的偏好？', 'Keep these': '保存这些', 'Skip': '跳过', 'Looking back over the conversation…': '正在回顾这次对话…', 'Nothing new to remember.': '没有新的偏好要记。',
  'From this session — kept in user/user_skills/preferences.md, the agent follows them next time. Untick any that are not.':
    '来自这次对话，保存在 user/user_skills/preferences.md，Agent 下次会照着做。不是偏好的请取消勾选。',
  'the agent is still working: wait for it (or Stop), then try again': 'Agent 还在工作：请等它完成（或点停止）再试',
};

// strings with numbers or names in them: [pattern, Chinese]
const PATTERNS = [
  [/^added page (\d+)$/, '已添加第 $1 页'], [/^page (\d+) duplicated: page (\d+)$/, '已复制第 $1 页：第 $2 页'], [/^page (\d+) moved to (\d+)$/, '第 $1 页已移到第 $2 页'],
  [/^deleted page (\d+)(.*)$/, '已删除第 $1 页$2'], [/^camera of page (\d+) saved$/, '第 $1 页的镜头已保存'],
  [/^added “(.+)” on page (\d+)$/, '已在第 $2 页添加「$1」'], [/^added “(.+)” on page (\d+) · double-click it to edit$/, '已在第 $2 页添加「$1」· 双击编辑'],
  [/^added the 3D shape “(.+)” where the camera looks · move it below$/, '已在镜头看的位置添加 3D 模型「$1」· 下面可以移动它'], [/^added the 3D shape “(.+)” on page (\d+)$/, '已在第 $2 页添加 3D 模型「$1」'],
  [/^added a (\w+) light on page (\d+)$/, '已在第 $2 页添加一盏 $1 灯'], [/^deleted “(.+)”$/, '已删除「$1」'], [/^restored “(.+)”$/, '已恢复「$1」'],
  [/^deleted the 3D shape “(.+)” · ⌘Z undoes$/, '已删除 3D 模型「$1」· ⌘Z 撤销'], [/^deleted the light “(.+)” · ⌘Z undoes$/, '已删除灯「$1」· ⌘Z 撤销'],
  [/^deleted scene (\d+) · ⌘Z undoes$/, '已删除场景 $1 · ⌘Z 撤销'], [/^duplicated scene (\d+) → (\d+)$/, '已复制场景 $1 → $2'],
  [/^deleted (\d+) elements$/, '已删除 $1 个元素'],
  [/^Scene (\d+) \/ (\d+)$/, '场景 $1 / $2'], [/^page (\d+) \/ (\d+)$/, '第 $1 / $2 页'], [/^Scene notes · scene (\d+)$/, '场景备注 · 场景 $1'],
  [/^(\d+) scenes? recorded$/, '已录 $1 个场景'], [/^use all (\d+) suggestions as notes$/, '把 $1 条建议全部用作备注'], [/^(\d+) suggestions? ready: each shows on its scene, above its notes$/, '$1 条建议已生成：显示在各自场景的备注上方'], [/^(\d\d:\d\d:\d\d) \(paused\)$/, '$1（暂停）'], [/^Scene (\d+)$/, '场景 $1'],
  [/^the agent is tidying (\d+) scenes?… \(a minute or two\)$/, 'AI 正在整理 $1 个场景…（一两分钟）'], [/^failed: (.*)$/, '失败：$1'], [/^replaced the picture of “(.+)”$/, '已替换「$1」的图片'],
  [/^copied (\d+) elements · ⌘V on any slide \/ page$/, '已复制 $1 个元素 · 在任意页 ⌘V'], [/^copied “(.+)” · ⌘V on any slide \/ page$/, '已复制「$1」· 在任意页 ⌘V'],
  [/^pasted (\d+) elements on scene (\d+), page (\d+)$/, '已粘贴 $1 个元素到场景 $2 第 $3 页'], [/^pasted “(.+)” on scene (\d+), page (\d+)$/, '已粘贴「$1」到场景 $2 第 $3 页'],
  [/^grouped (\d+) elements as (\w+) · a click on one selects them all$/, '已把 $1 个元素编为 $2 · 点其中一个会全选'], [/^ungrouped (\d+) elements$/, '已取消 $1 个元素的编组'],
  [/^uploading (.+) …$/, '正在上传 $1 …'], [/^upload failed: (.*)$/, '上传失败：$1'], [/^(.+): not a picture, video or 3D model$/, '$1：不是图片、视频或 3D 模型'],
  [/^(\d+) selected · drag moves them together$/, '已选 $1 个 · 拖动会一起移动'], [/^on other pages \((\d+)\)$/, '其他页上的（$1）'], [/^lights on other pages \((\d+)\)$/, '其他页上的灯（$1）'],
  [/^of 1–(\d+)$/, '共 1–$1'], [/^ambient light of page (\d+)$/, '第 $1 页的环境光'], [/^page 1: the scene as it enters · drag to reorder$/, '第 1 页：场景刚进入时 · 拖动可调整顺序'],
  [/^page (\d+): after click (\d+) · drag to reorder$/, '第 $1 页：第 $2 次点击后 · 拖动可调整顺序'], [/^runs by itself after the page before · drag to reorder$/, '在上一页之后自动播放 · 拖动可调整顺序'],
  [/^Approve (.+)$/, '授权 $1'], [/^(.+) is not installed on this computer$/, '这台电脑上没有安装 $1'], [/^approve (.+)$/, '授权 $1'],
  [/^You are on scene (\d+) \((.+), (2D|3D)\), page (\d+) of (\d+)\.$/, '你在场景 $1（$2，$3），第 $4 / $5 页。'], [/^You are on scene (\d+), page (\d+) of (\d+)\.$/, '你在场景 $1，第 $2 / $3 页。'],
  [/^follows “(.+)” in 3D · x \/ y = pixel offset from it \(keep small: it is right in one view only\)$/, '跟随 3D 中的「$1」· x / y = 相对它的像素偏移（尽量小：只在一个视角下准确）'],
  [/^(\w+) failed$/, '$1 失败'], [/^deleted the last page: the scene is blank · ⌘Z undoes$/, '已删除最后一页：场景为空 · ⌘Z 撤销'],
];

export function t(s) {
  if (LANG !== 'zh' || typeof s !== 'string') return s;
  const k = s.trim();
  if (!k) return s;
  let out = ZH[k];
  if (out == null) for (const [re, zh] of PATTERNS) if (re.test(k)) { out = k.replace(re, zh); break; }
  return out == null ? s : s.replace(k, out);
}

// what is the talk's, not the editor's: never translated
const TALK = '.slide-overlay, .slide, .stage, .talk-user, .ed-title, .ed-name, code, pre, .katex, .el-desc b, .pref-text, .ed-agent-line.user, .ed-agent-line.tool';
const skipped = (node) => { const el = node.nodeType === 1 ? node : node.parentElement; return !el || !!el.closest(TALK); };
const typedIn = (node) => !!node.parentElement?.closest('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');   // (what is being typed)

function translateNode(node) {
  if (node.nodeType === 3) {
    if (skipped(node) || typedIn(node)) return;
    const v = node.nodeValue, w = t(v);
    if (w !== v) node.nodeValue = w;
    return;
  }
  if (node.nodeType !== 1 || skipped(node)) return;
  for (const a of ['title', 'placeholder']) {
    const v = node.getAttribute(a);
    if (v) { const w = t(v); if (w !== v) node.setAttribute(a, w); }
  }
  for (const c of node.childNodes) translateNode(c);
}

// translate the editor as it is now and as it changes (Chinese only)
export function startI18n(root = document.body) {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  if (LANG !== 'zh') return;
  translateNode(root);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(translateNode);
      else if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
}

// the "中 | EN" button: the other language (the page reloads in it; the talk stays as it is)
export function langButton() {
  const b = document.createElement('button');
  b.className = 'ed-lang';
  b.title = LANG === 'zh' ? 'Switch to English' : '切换到中文';
  b.innerHTML = `<span class="${LANG === 'zh' ? 'on' : ''}">中</span> | <span class="${LANG === 'en' ? 'on' : ''}">EN</span>`;
  b.addEventListener('click', () => { try { localStorage.setItem(KEY, LANG === 'zh' ? 'en' : 'zh'); } catch { /* not kept */ } location.reload(); });
  return b;
}
