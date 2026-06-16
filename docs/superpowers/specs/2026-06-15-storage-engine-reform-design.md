# Storage & Engine Reform

> 统一三套代码格式、消除 `isReflectable` 脆弱性、解耦数据模型、规范执行引擎接口。

## Background

System Analyzer 的节点数据以 JavaScript class 代码为核心序列化格式。当前存在三个问题：

1. **三套代码格式并存** — `toCode()` 产出 JSON 双引号格式、`nodeToCode()` 产出单引号旧格式、`define()` 产出包装格式。`fromCode` 需要 try-catch 依次尝试，`isReflectable` 用脆弱正则判定是否应该自动回写 code。
2. **存储字段与运行时字段混存** — `save()` 把整个 `state.nodes`（含 methods 函数对象）`JSON.stringify` 进 localStorage，但序列化天然丢失函数；`load()` 再从 code 重新派生覆盖结构化字段。这意味着存储的 inputs/outputs/properties 是冗余副本，而 methods 实际从未持久化。`undo` 栈 (`editor.js:7`) 同样 `JSON.stringify(state.nodes)`——撤销到含方法编辑的历史时，方法体已经静默丢失（潜在 bug）。`isReflectable` 为 false 时面板编辑不更新 code，但实际所有持久化路径都已经依赖 code——`isReflectable` 是历史包袱。
3. **引擎接口靠 fn.toString() 正则推断参数名** — `callMethod` 从函数源码正则提取参数名（`inputs` vs `dt`），minify/编译/人为缩写都会破坏。

## Scope

涉及七个文件：
- `src/io.js` — 核心修改（normalizeCode / fromCode / save / load / importJSON）
- `src/engine.js` — `callMethod` / `compileNode` 简化
- `src/codeview.js` — `splitDefineBlocks` 简化、`saveCode` 加 normalizeCode
- `src/renderer.js` — 空桩检测改读 `compiled` 缓存
- `src/state.js` — 删除 `define()` 函数
- `src/llms.txt` — 删除 define 向后兼容承诺
- 其他文件（input.js、main.js、editor.js、panel.js）— 不改

## Design

### 1. 加载/导入/代码视图保存时统一格式

新增 `normalizeCode(code)` 函数，在三个 fromCode 入口调用。将任意旧格式统一为新格式（`toCode` 输出的裸 class）。

```js
function normalizeCode(code) {
  if (!code) return ''
  // 1. define 包装 → fromCode 反射 → toCode 标准化
  if (/^\s*define\(/.test(code)) {
    const result = fromCodeLegacy(code)  // 内联旧 define 解析逻辑，仅迁移期使用
    return result ? toCode(result) : code
  }
  // 2. bare class / 旧 class { static inputs } → 同样处理
  if (/^\s*class\s/.test(code)) {
    const result = fromCode(code)
    return result ? toCode(result) : code
  }
  // 3. 非 class 旧格式（极少数遗留数据）→ parseClassCode → toCode
  const parsed = parseClassCode(code)
  if (parsed) return toCode(parsed)
  return code
}
```

**三个调用点**（覆盖所有进入系统的代码路径）：

| 入口 | 文件:行 | 覆盖来源 |
|------|---------|---------|
| `load()` | `src/io.js:312` | localStorage |
| `importJSON()` | `src/io.js:203` | URL hash（经 `main.js:32`）+ 文件导入（`input.js:327`）+ test hook（`input.js:18`） |
| `saveCode()` | `src/codeview.js:67` | 代码视图编辑 |

URL hash 不需要在 `main.js` 单独加 normalizeCode——它已经走 `importJSON`。

此后再无旧格式，`fromCode` 内部可删除 define 分支和 try-catch。

> **迁移期实现细节**：`fromCodeLegacy` 内联原 fromCode 的 define 分支，仅在 `normalizeCode` 内部使用。迁移完成后（一个版本后）可移除。`parseClassCode` 同理保留作为 normalizeCode 的最后兜底分支。

### 2. 消除 `isReflectable`

删除 `isReflectable(code)` 函数和 `DEFINE_RE` 常量。所有带 `node.code` 的节点都可以被反射（normalizeCode 已保证格式）。

替换 `isReflectable(xxx.code)` 出现处：
- `io.js:127` `syncEdgeToSource` — 改为 `if (src.code) src.code = toCode(src)`
- `io.js:150-151` `addEdgeToCode` — 改为 `if (sourceNode.code)` / `if (targetNode.code)`
- `io.js:160` `removeEdgeFromCode` — 改为 `if (sourceNode.code)`
- `io.js:266` `importJSON` 旧格式 description 提取 — 改为 `if (!n.description && n.code && !/^\s*class\s/.test(n.code))`（仅在非 class 格式时尝试）

### 3. 简化 `fromCode()`

去掉 define 分支。只保留 bare class 路径：

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
      if (k !== 'constructor') methods[k] = cls.prototype[k]
    }
    return { label, description, inputs, outputs, properties: props, methods }
  } catch { return null }
}
```

`io.js:1` 的 `import { define } from './state.js'` 一并删除。

### 4. 数据模型：保守缓存版

**核心决策**：code 是真相源；`inputs/outputs/properties/description` 是从 code 派生的运行时缓存（在 load/import/panel-edit/codeview-save 时刷新）；`methods` 不再持久化到 node，仅由 `compileNode` 在运行时缓存到 `node.compiled.methods`。

**为什么不更激进（每次读都派生）**：`utils.js:55,153-158` 的 hit-test、`renderer.js:231-336` 的端口绘制、`engine.js:110,137,183` 的迭代都频繁读 inputs/outputs——每次 fromCode 反射在 100+ 节点下成本过高。缓存 + 在 mutation 时刷新更合适。

**`save()` 改为只存 code + 非派生字段：**

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

**`load()` 从 code 重新派生结构化字段：**

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
    // ... rest unchanged
  } catch { return false }
}
```

**真实收益**（澄清原背景描述）：
- localStorage 体积减小（不再冗余存 inputs/outputs/properties）
- `editor.js:7` undo 栈不再因 JSON.stringify 丢 methods 而出现空方法节点 bug（顺带修复潜在 bug）
- 数据模型一致性（存储的字段 = 持久化的字段，无"看起来存了其实丢了"的歧义）

### 5. 删除遗留代码

删除以下函数（不再调用）：
- `nodeToCode()` — 统一用 `toCode()`
- `parseClassCode()` — 仅在 `normalizeCode` 内部保留作兜底（迁移期）；外部所有引用清理
- `parsePortArr()` / `isBodyEmpty()` — `parseClassCode` 的辅助，随之保留作迁移用
- `getNodeCommentLegacy()` — description 从 static 字段反射获取
- `define()` in `src/state.js:152-171` — 唯一调用点是 fromCode 的 define 分支，本次一并删除

**importJSON "无 code 但有结构化字段" 的处理**：当前 `io.js:220-224` 调 `nodeToCode` 生成 stub。改用 `toCode`：

```js
} else if (inputs.length || outputs.length || Object.keys(properties).length) {
  const stub = { id: n.id || 'n_' + i, label: n.label || '?', inputs, outputs, properties }
  code = toCode(stub)
}
```

### 6. 执行引擎统一接口（删垫片）

**`callMethod` 直接标准化**，删除 `fn.length === 2` 兼容垫片：

```js
function callMethod(method, ctx, inputs, dt) {
  if (!method || method.error) return undefined
  return method.fn.call(ctx, { inputs, dt })
}
```

> 原方案保留 `if (fn.length === 2)` 兼容旧 `tick(dt, inputs)` 签名。但 `normalizeCode` 已把所有代码转成新格式，`toCode` 输出签名固定为 `({ inputs, dt })`，`fn.length === 1`，垫片分支永不触发——是死代码，删除。

**`toCode()` 方法签名固定为 `{ inputs, dt }`：**

```js
// 输出格式
methodName({ inputs, dt }) {
  // body
}
```

**`compileNode` 简化，加 `isEmpty` 标志：**

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

删除 `compileOldFormat()` 和 `compileFn()`（旧格式已被 normalizeCode 消化）。

### 7. codeview.js 适配（新）

`splitDefineBlocks` (codeview.js:135-166) 强依赖 `define(` 子串。删除 define 格式后：

- 重命名为 `splitClassBlocks`
- 删除 `isDefine` 变量、`checkClose` 三元简化为只判 `}`
- saveCode 在调 fromCode 前对每块调 normalizeCode，覆盖第三个入口：

```js
// codeview.js saveCode 循环内
const block = blocks[i]
const normalized = normalizeCode(block)  // 新增
const def = window.fromCode(normalized)
if (!def) { errors.push(...); continue }
// 后续用 normalized 作为 node.code
```

### 8. renderer.js 空桩检测（新）

`renderer.js:319-329` 当前直接读 `method.fn.toString()` 判断方法体是否为空（绘制橙点提示）。methods 字段不再直接挂在 node 上后，改读 compileNode 输出的 `isEmpty` 标志：

```js
// renderer.js 端口绘制处
const compiled = node.compiled
const method = compiled?.methods?.[port.id]
const isEmpty = method?.isEmpty === true
if (isEmpty) {
  // 绘制橙点
}
```

确保 `compileNode` 在渲染前已经跑过——`compileAllNodes()` 在 propagate/stepAll 入口已经调用；renderer 可在缺 compiled 时主动调一次或跳过空桩绘制（性能权衡）。

### 9. llms.txt 同步（新）

`src/llms.txt:88` 当前对外承诺 define 向后兼容：

> 旧格式 `define(class X { ... })` 和 `class X { static inputs = [...] }`（未使用 label 作 class 名的老格式）仍然支持加载。

删除整段（或改为"加载时会自动迁移为新格式"）。`dist/llms.txt` 由 `npm run build` 重新生成。

## Files changed

| File | Change |
|------|--------|
| `src/io.js` | +`normalizeCode()`, refactor `fromCode()`/`save()`/`load()`/`importJSON()`, -`isReflectable()`/`nodeToCode()`/`getNodeCommentLegacy()`/`DEFINE_RE`, -`import { define }` |
| `src/engine.js` | refactor `callMethod()`/`compileNode()` (+isEmpty), -`compileOldFormat()`/`compileFn()` |
| `src/codeview.js` | rename `splitDefineBlocks`→`splitClassBlocks` + 简化, saveCode 调 normalizeCode |
| `src/renderer.js` | `:319-329` 改读 `node.compiled.methods[name].isEmpty` |
| `src/state.js` | -`define()` 函数（行 152-171） |
| `src/llms.txt` | 删 `:88` define 兼容段 |
| `src/panel.js` | 不需要改（grep 确认无 isReflectable 引用，面板编辑已遵循"改字段即改 code"模式） |

## Backward compatibility

- **localStorage `sa_data` 旧格式**（存了完整 node 对象含 inputs/outputs/properties）—— `load()` 先 JSON 解析，后 `normalizeCode` + `fromCode`，兼容。`methods` 字段在旧存储中本来就被 JSON.stringify 丢了，不引入回归。
- **导入 JSON 旧格式**（edges 数组、单引号 class、define 包装）—— `importJSON` 先 edges migration，再 `normalizeCode`，兼容。
- **URL hash 分享** —— URL hash 经 `main.js:32` → `importJSON`，由 `normalizeCode` 覆盖，兼容。无需 `main.js` 单独适配。
- **代码视图编辑** —— `saveCode` 调 `normalizeCode`，用户即便手写 define 包装也会被迁移。
- **`define()` 函数** —— 直接删除。vanilla JS 单文件无外部依赖，全项目 grep 确认唯一运行时调用是 fromCode 的 define 分支（本次也删）。
- **tick 写回的 properties** —— 当前 load 时已被 code 重新派生覆盖，tick 改的属性 reload 后丢失。重构保留此现状（见 Out of scope）。

## Out of scope

- 不改变 URL 分享/导出 JSON 的字段结构（code 字段仍然存在；exportJSON 仍输出 inputs/outputs/properties 供外部消费者使用——从 node 缓存读，已由 fromCode 派生）。
- 不改 `src/llms.txt` 主体规范（class 反射提取元数据不变），仅删 define 兼容段。
- 不改 UI 行为（面板编辑、代码视图等交互逻辑不变）。
- **tick 运行时状态不持久化**（保持现状）：`engine.js:207-209` tick 写回 `node.properties`，但 `load()` 第 316 行从 code 重新派生覆盖。这是当前行为，本次重构不改变。若未来要持久化 tick 状态，是单独的设计决策。
- `parseClassCode`/`parsePortArr`/`isBodyEmpty`/`fromCodeLegacy` 作为 normalizeCode 内部迁移辅助**保留一个版本**，下个版本再清理。
