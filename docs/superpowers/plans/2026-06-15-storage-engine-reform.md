# Storage & Engine Reform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify three code formats, eliminate `isReflectable`, decouple data model, standardize engine method interface.

**Architecture:** The plan modifies 7 source files and 1 test script. Core change is adding `normalizeCode()` as the single entry point for all code paths, then simplifying `fromCode()`/`save()`/`load()` to treat code as the source of truth with structured fields as runtime cache. Engine methods switch from positional args to `{ inputs, dt }` named parameter object.

**Tech Stack:** Vanilla JS, esbuild, puppeteer (test only).

---

### Task 1: normalizeCode + fromCode simplification + isReflectable removal (src/io.js)

**Files:** `src/io.js`

- [ ] **Step 1: Add normalizeCode function after the DEFINE_RE line (line 9)**

Insert after line 9 (the `DEFINE_RE` constant — will be removed in step 4):

```js
// 迁移期辅助：内联旧 define 解析，仅 normalizeCode 内部使用
function fromCodeLegacy(code) {
  if (!code || !/^\s*define\(/.test(code)) return null
  try {
    const fn = new Function('define', 'return (' + code + ')')
    const define = (cls) => {
      const instance = new cls()
      const properties = {}
      for (const key of Object.getOwnPropertyNames(instance)) properties[key] = instance[key]
      const methods = {}
      for (const key of Object.getOwnPropertyNames(cls.prototype)) {
        if (key !== 'constructor') methods[key] = cls.prototype[key]
      }
      return { label: cls.label || cls.name, description: cls.description || '', inputs: cls.inputs || [], outputs: cls.outputs || [], properties, methods }
    }
    const r = fn(define)
    return (r && typeof r === 'object' && !Array.isArray(r)) ? r : null
  } catch { return null }
}

// 统一三种旧格式为 toCode 输出的裸 class 格式
export function normalizeCode(code) {
  if (!code) return ''
  if (/^\s*define\(/.test(code)) {
    const r = fromCodeLegacy(code)
    return r ? toCode(r) : code
  }
  if (/^\s*class\s/.test(code)) {
    const r = fromCode(code)
    return r ? toCode(r) : code
  }
  const parsed = parseClassCode(code)
  if (parsed) return toCode(parsed)
  return code
}
```

- [ ] **Step 2: Simplify fromCode — remove define branch**

Replace `fromCode` (lines 20-58) with:

```js
export function fromCode(code) {
  if (!code) return null
  try {
    const fn = new Function('return (' + code + ')')
    const cls = fn()
    if (typeof cls !== 'function') return null
    const label = cls.label || cls.name || '?'
    const description = cls.description || ''
    const inputs = cls.inputs || []
    const outputs = cls.outputs || []
    const props = {}
    try { const inst = new cls(); for (const k of Object.keys(inst)) props[k] = inst[k] } catch {}
    const methods = {}
    for (const k of Object.getOwnPropertyNames(cls.prototype)) {
      if (k !== 'constructor' && typeof cls.prototype[k] === 'function') methods[k] = cls.prototype[k]
    }
    return { label, description, inputs, outputs, properties: props, methods }
  } catch { return null }
}
```

- [ ] **Step 3: Update toCode — method signature changes to `{ inputs, dt }`**

In `toCode` (lines 62-84), change the method serialization loop (lines 72-80):

```js
for (const [name, fn] of Object.entries(methods)) {
  if (typeof fn !== 'function') continue
  const src = fn.toString()
  const bm = src.match(/\{([\s\S]*)\}$/)
  const body = bm ? bm[1] : ''
  const indented = body.split('\n').map(l => '  ' + l).join('\n')
  out += body ? `  ${name}({ inputs, dt }) {\n  ${indented}\n  }\n` : `  ${name}({ inputs, dt }) {\n  }\n`
}
```

- [ ] **Step 4: Remove DEFINE_RE and isReflectable, update all call sites**

Delete lines 9 (`const DEFINE_RE = /^\s*define\(/`) and 86-90 (`function isReflectable...`).

Replace `isReflectable(src.code)` at line 127 → `if (src.code)`
Replace `isReflectable(sourceNode.code)` at line 150 → `if (sourceNode.code)`
Replace `isReflectable(targetNode.code)` at line 151 → `if (targetNode.code)`
Replace `isReflectable(sourceNode.code)` at line 160 → `if (sourceNode.code)`
Replace `!isReflectable(n.code)` at line 266 → `!/^\s*class\s/.test(n.code)`

- [ ] **Step 5: Remove `define` import**

Change `io.js:1` from:
```js
import { state, config, createNode, define } from './state.js'
```
to:
```js
import { state, config, createNode } from './state.js'
```

---

### Task 2: save/load/importJSON refactor (src/io.js)

**Files:** `src/io.js`

- [ ] **Step 1: Change save() to only persist code + non-derived fields**

Replace `save()` (lines 298-302):

```js
export function save() {
  try {
    const serializable = state.nodes.map(n => ({
      id: n.id, label: n.label, code: n.code,
      x: n.x, y: n.y,
      metadata: n.metadata, visual: n.visual,
    }))
    localStorage.setItem('sa_data', JSON.stringify({
      nodes: serializable, graphId: state.graphId,
      graphTitle: state.graphTitle, nextId: state.nextId
    }))
  } catch (e) {}
}
```

- [ ] **Step 2: Change load() to normalize + derive from code**

Replace `load()` (lines 304-327):

```js
export function load() {
  try {
    const raw = localStorage.getItem('sa_data')
    if (!raw) return false
    const d = JSON.parse(raw)
    state.nodes = (d.nodes || []).map(n => {
      const node = { inputs: [], outputs: [], properties: {}, methods: {}, visual: {}, computed: {}, error: null, compiled: null, ...n }
      if (node.code) {
        node.code = normalizeCode(node.code)
        const def = fromCode(node.code)
        if (def) {
          node.inputs = def.inputs
          node.outputs = def.outputs
          node.properties = def.properties
          node.description = def.description
          node.methods = def.methods
        }
      }
      return node
    })
    state.graphId = d.graphId || 'g_' + Date.now()
    state.graphTitle = d.graphTitle || '系统模型'
    state.nextId = d.nextId || 1
    document.getElementById('title-text').textContent = state.graphTitle
    return true
  } catch { return false }
}
```

- [ ] **Step 3: Add normalizeCode call to importJSON**

In `importJSON`, add `normalizeCode` call before `fromCode`. Find lines 200-203 (`if (code.trim()) { defResult = fromCode(code) }`) and add normalizeCode before it:

```js
if (code.trim()) {
  code = normalizeCode(code)
  defResult = fromCode(code)
}
```

---

### Task 3: Legacy function deletion (src/io.js)

**Files:** `src/io.js`

- [ ] **Step 1: Replace nodeToCode call with toCode**

At line 223 (`code = nodeToCode(stub)`), change to:
```js
code = toCode(stub)
```

At line 255 (`n.code = nodeToCode(n)`), change to:
```js
n.code = toCode(n)
```

- [ ] **Step 2: Delete getNodeCommentLegacy**

Delete lines 278-283 (`function getNodeCommentLegacy...`). The call at line 267 references it — that code block is the `!isReflectable(n.code)` branch already changed in Task 1 step 4. Verify the block now reads:

```js
if (!n.description && n.code && !/^\s*class\s/.test(n.code)) {
  // this block's inner call to getNodeCommentLegacy is dead since normalizeCode ensures class format; just remove the block
}
```

Actually, since normalizeCode ensures all code is class format by this point, this entire `if` block (lines 264-270) is dead code. Remove lines 264-270 entirely:

```js
// 删除:  // 同步 description（新格式已有，旧格式尝试从注释补）
//       for (const n of state.nodes) {
//         if (!n.description && n.code && !isReflectable(n.code)) {
//           const c = getNodeCommentLegacy(n.code)
//           if (c) n.description = c
//         }
//       }
```

- [ ] **Step 3: Add "migration only" comment to parseClassCode + nodeToCode**

`parseClassCode` and `nodeToCode` are kept as migration helpers used by `normalizeCode`. Add a comment above `parseClassCode()` at line 359 and `nodeToCode()` at line 381:

```js
// 迁移期辅助——仅供 normalizeCode 兜底分支使用，下个版本可移除
```

Also add same comment above `parsePortArr()` at line 339 and `isBodyEmpty()` at line 354.

---

### Task 4: Delete define() from state.js (src/state.js)

**Files:** `src/state.js`

- [ ] **Step 1: Delete the define function**

Delete lines 149-171 (the `define()` function and its comment block).

Verify `define` is no longer imported anywhere: `rg "from './state.js'" src/io.js` should have no `define` in the import line (already done in Task 1 step 5).

---

### Task 5: Engine simplification (src/engine.js)

**Files:** `src/engine.js`

- [ ] **Step 1: Simplify callMethod**

Replace `callMethod` (lines 60-63):

```js
function callMethod(method, ctx, inputs, dt) {
  if (!method || method.error) return undefined
  return method.fn.call(ctx, { inputs, dt })
}
```

- [ ] **Step 2: Simplify compileNode — add isEmpty flag**

Replace `compileNode` (lines 34-53):

```js
export function compileNode(node) {
  if (!node.code || !node.code.trim()) { node.compiled = null; return }
  if (node.methods && Object.keys(node.methods).length > 0) {
    const compiled = { methods: {} }
    for (const [name, fn] of Object.entries(node.methods)) {
      if (typeof fn !== 'function') continue
      const src = fn.toString()
      const bm = src.match(/\{([\s\S]*)\}$/)
      const body = bm ? bm[1] : ''
      const stripped = body.replace(/\/\/.*$/gm, '').replace(/\s/g, '')
      const isEmpty = !stripped || stripped === 'returnnull' || stripped === 'returnundefined'
      compiled.methods[name] = { fn, isEmpty }
    }
    node.compiled = compiled
    return
  }
  node.compiled = null
}
```

- [ ] **Step 3: Delete compileFn and compileOldFormat**

Delete lines 8-18 (`function compileFn...`) and lines 21-32 (`function compileOldFormat...`).

---

### Task 6: codeview.js adaptation (src/codeview.js)

**Files:** `src/codeview.js`

- [ ] **Step 1: Rename splitDefineBlocks → splitClassBlocks**

In `saveCode()` line 51, change: `const blocks = splitDefineBlocks(text)` → `const blocks = splitClassBlocks(text)`

Add `normalizeCode` call in the saveCode loop. After line 66-67:

```js
for (const block of blocks) {
    const normalized = window.normalizeCode(block)  // 新增
    const def = window.fromCode(normalized)          // 原 block 改为 normalized
    if (!def) {
```

And update the `code: block` assignment on line 80: `code: block` → `code: normalized`

- [ ] **Step 2: Simplify splitClassBlocks**

Replace `splitDefineBlocks` function (lines 135-166):

```js
function splitClassBlocks(text) {
  const blocks = []
  let i = 0
  while (i < text.length) {
    const cPos = text.indexOf('class ', i)
    if (cPos < 0 || cPos >= text.length) break
    let depth = 0, inStr = false, strQ = null, j = cPos
    while (j < text.length) {
      const ch = text[j], prev = j > 0 ? text[j - 1] : ''
      if (!inStr) {
        if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strQ = ch }
        else if (ch === '{') depth++
        else if (ch === '}') depth--
      } else {
        if (ch === strQ && prev !== '\\') { inStr = false; strQ = null }
      }
      if (depth === 0 && ch === '}') {
        blocks.push(text.slice(cPos, j + 1))
        i = j + 1
        break
      }
      j++
    }
    if (j >= text.length) break
  }
  return blocks
}
```

- [ ] **Step 3: Add normalizeCode to window bridge in input.js**

In `src/input.js`, add after line 42 (after `initCodeView()`):
```js
window.normalizeCode = normalizeCode
```

And add the import at line 5:
```js
import { normalizeCode } from './io.js'
```

Wait — this requires `normalizeCode` to be exported from io.js. Currently it's not exported. Add `export` to the function declaration.

---

### Task 7: renderer.js isEmpty detection (src/renderer.js)

**Files:** `src/renderer.js`

- [ ] **Step 1: Change isEmpty detection to read from compiled cache**

Replace lines 319-335:

```js
// isEmpty stub indicator (orange dot — AI should fill implementation)
if (n.compiled && n.compiled.methods) {
  let hasEmpty = false
  for (const method of Object.values(n.compiled.methods)) {
    if (method.isEmpty) { hasEmpty = true; break }
  }
  if (hasEmpty) {
    ctx.save()
    ctx.beginPath(); ctx.arc(r.x + r.w - 6, r.y + 6, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#ff9800'; ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()
    ctx.restore()
  }
}
```

---

### Task 8: llms.txt update

**Files:** `src/llms.txt`

- [ ] **Step 1: Delete define compatibility paragraph**

Find lines 86-88 (the "向后兼容" section) and delete the whole section:
```
### 向后兼容

旧格式 `define(class X { ... })` 和 `class X { static inputs = [...] }`（未使用 label 作 class 名的老格式）仍然支持加载。
```

Replace with:
```
旧格式 `define(class X { ... })` 和 `class X { static inputs = [...] }` 在导入时自动迁移为新格式。
```

---

### Task 9: Update test-roundtrip.mjs

**Files:** `scripts/test-roundtrip.mjs`

- [ ] **Step 1: Update inline toCode — produce `{ inputs, dt }` signature**

In the `toCode` function (line 28-50), change the method serialization:

```js
for (const [name, fn] of Object.entries(methods)) {
  if (typeof fn !== 'function') continue
  const src = fn.toString()
  const bm = src.match(/\{([\s\S]*)\}$/)
  const body = bm ? bm[1] : ''
  const indented = body.split('\n').map(l => '    ' + l).join('\n')
  out += `  ${name}({ inputs, dt }) {\n${indented}\n  }\n`
}
```

- [ ] **Step 2: Update inline fromCode — remove define branch**

Replace `fromCode` (lines 52-82) with the simplified version (same as Task 1 step 2):

```js
function fromCode(code) {
  if (!code) return null
  try {
    const fn = new Function('return (' + code + ')')
    const cls = fn()
    if (typeof cls !== 'function') return null
    const label = cls.label || cls.name || '?'
    const description = cls.description || ''
    const inputs = cls.inputs || []
    const outputs = cls.outputs || []
    const props = {}
    try { const inst = new cls(); for (const k of Object.keys(inst)) props[k] = inst[k] } catch {}
    const methods = {}
    for (const k of Object.getOwnPropertyNames(cls.prototype)) {
      if (k !== 'constructor' && typeof cls.prototype[k] === 'function') methods[k] = cls.prototype[k]
    }
    return { id: cls.name || '', label, description, inputs, outputs, properties: props, methods }
  } catch { return null }
}
```

- [ ] **Step 3: Remove inline define() + DEFINE_RE**

Delete lines 4 (`const DEFINE_RE = /^\s*define\(/`) and lines 12-26 (`function define(cls) {...}`).

- [ ] **Step 4: Remove nodeToCode + parseClassCode section**

Delete lines 84-152 (the "旧格式兼容" block containing `parsePortArr`, `parseClassCode`, `nodeToCode`).

- [ ] **Step 5: Update tests to match new behavior**

Section 3 (method body preservation, line 209-249): Update `code.includes('housing_demand(inputs)')` assertion → the new format has `({ inputs, dt })`. Change the tick test to expect `{ inputs, dt }`:

Line 247: `check('tick(dt,inputs) 保留', b4.methods.tick.toString().includes('dt'))` stays the same (engine still passes dt — just via object now).

Section 5 (old format compat, lines 295-319): Delete the entire Section 5 since define/legacy are no longer supported in fromCode. Replace with a single test that verifyLegacy format passes through normalizeCode → toCode. Or just remove the section and add a brief note in the summary.

Section 9 (line 396): Remove `check('无 define 残留', r.define === undefined)` — no longer relevant.

- [ ] **Step 6: Run the test**

```bash
node scripts/test-roundtrip.mjs
```
Expected: All tests pass.

---

### Task 10: Build + e2e test

- [ ] **Step 1: Build**

```bash
npm run build
```
Expected: `dist/index.html` created without errors.

- [ ] **Step 2: Run e2e test**

```bash
node scripts/test-e2e.mjs
```
Expected: All e2e tests pass (Level 1/2/3 + JSON format + isEmpty + description edit).

- [ ] **Step 3: Update e2e test method signature expectation**

In `scripts/test-e2e.mjs` line 109, change:
```js
codeContainsMethod: pop.code.includes('housing_demand(inputs)'),
```
to:
```js
codeContainsMethod: pop.code.includes('housing_demand({ inputs, dt })'),
```

- [ ] **Step 4: Final grep for dangling references**

```bash
rg "isReflectable|DEFINE_RE|splitDefineBlocks|compileOldFormat|compileFn|nodeToCode|getNodeCommentLegacy" src/
```
Expected: No matches (all deleted/replaced).
