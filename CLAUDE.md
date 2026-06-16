# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                            # esbuild (dev) + puppeteer (test) + codemirror (editor)
npm run build                          # bundle src/main.js → dist/index.html (single file)
npm run dev                            # watch + dev server at localhost:8000

node scripts/test-codegraph.mjs        # v0.6 核心引擎单元测试（runSource/serializeCode/resetRuntime）
node scripts/test-roundtrip.mjs        # scanner 静态分析单元测试（无浏览器）
node scripts/test-e2e.mjs              # puppeteer, loads dist/index.html — MUST `npm run build` first
```

No test runner, lint, or typecheck. Verification is manual in the browser, plus the three `.mjs` scripts above.

## Architecture

Vanilla JS + Canvas 2D, no framework. ES modules in `src/` are bundled by esbuild into a single `dist/index.html` with inlined `<script>`. **`AGENTS.md` is the authoritative agent guide** — read it first.

### Code-as-truth + GraphStarter 模型（v0.6）

**`state.sourceCode` 字符串是唯一真相源。** 一段 JS 代码同时包含 class 定义（含 `static description` + 默认属性 + 方法体）和启动代码（`GraphStarter.add()` + 引用赋值 + `describe()`）。`state.runtimeInstances` 数组由 `runSource(state.sourceCode)` 派生，不是用户直接编辑的对象。

**sourceCode 长这样：**

```js
class Processor {
  static description = "处理输入数据并传给下游"
  constructor() {
    this.speed = 100
    this.next_stage = null     // 引用槽
  }
  process({ dt }) {
    this.next_stage.input = this.speed * dt   // 这行 = 一条边
  }
}

const p1 = GraphStarter.add(Processor)
const p2 = GraphStarter.add(Processor)
const d1 = GraphStarter.add(Database)
p1.next_stage = d1
p2.speed = 200                 // 实例 override
GraphStarter.describe(p1, 'next_stage', '主数据流')
```

**两层模型：**
- **代码层（真相源）**：class 定义 + 启动代码。`propagate`/`stepAll`/`runSource` 都从这里派生
- **运行时层（mutable）**：迭代时方法体里 `this.X = ...` 写 self 的变化留在 `attrs`，不入代码。`resetRuntime()` 重新执行 sourceCode 回到初始

**实例身份 = 启动代码里的变量名**（p1/p2/d1）。`GraphStarter.add()` **必须**赋值给 `const <varName> = ...`，否则 runSource 报错。varName 不可改（panel 显示但禁用编辑）。

**边的存在条件（合取）：**
1. 源 class 的某方法体里有 `this.<ref>.<attr> = ...`（emitter 声明，scanner.js 识别）
2. 源实例的 `<ref>` 当前指向某目标实例（引用槽非 null）
3. 目标实例的 class 声明了 `<attr>` 属性

**属性语义（"不变"决策）：** class 默认值永远保留（永远写 `this.speed = 100`）；实例 override 单独写在启动代码里（`p1.speed = 200`）。即使所有实例都 override 成 200，class 默认值也不变。

**双向转换器（完整互转，不增量 patch）：**
- `code → graph`：`runSource(state.sourceCode, state)` 在 `src/codegraph.js`。`new Function('GraphStarter', sourceCode)(bridge)` 执行，bridge.add(cls) 返回 attrs 代理（含不可枚举 `__instId` 反查 inst），describe(srcAttrs, refName, text) 写 edgeMeta[refName]
- `graph → code`：`serializeCode(state)` 在 `src/codegraph.js`。Class 段原样保留（parser 切出），启动代码段机器生成（add 调用 + override + 引用 + describe）。Panel 改属性 → `syncCodeFromRuntime()` 在 `src/io.js` 触发序列化 → dispatch `sa-source-updated` 事件 → codeview 同步编辑器内容

### 关键概念

**`GraphStarter.add()` 返回 attrs 代理**，不是 RuntimeInstance 容器。这样 `p1.next_stage = d1` 原生 JS 赋值在 `p1.attrs.next_stage = d1.attrs` 上生效——方法体内 `this.X.Y = ...` 无需 proxy 直接命中目标 attrs。

**实例虚拟字段（向后兼容）。** `wrapInstance(inst)` in `src/io.js` 给每个 RuntimeInstance 加 getter：`id`/`classId`/`label`/`x`/`y`/`properties`/`inputs`/`outputs`/`computed`/`error`。这是给 v0.5 遗留 renderer/utils 代码用的"node 形状"外观。`x`/`y` 实际存取于 `state.visualState.positions[varName]`。

**state 兼容别名。** `state.instances`/`state.nodes` 是 `runtimeInstances` 的 getter 别名；`state.selInstance`/`state.selNode`/`state.hoverInstance`/`state.hoverNode`/`state.dragInstance`/`state.dragNode` 通过 varName 字符串查找 RuntimeInstance。新代码应直接用 `state.runtimeInstances` + `state.selVarName`。

**HTML ↔ module bridge.** `src/index.html` uses inline `onclick` handlers. Every function called from HTML must be explicitly registered on `window` in `src/input.js` (search for `window.<name> =`). 新增 v0.6 入口：`window.toggleCodeView`、`window.commitCodeNow`、`window.resetRuntime`。

**数据流 & 渲染。** 用户操作 → mutate runtimeInstances.attrs 或 sourceCode → `syncCodeFromRuntime()` + `save()` + `render()`（全量 Canvas 重绘）。世界坐标 + viewport 变换（`viewX`/`viewY`/`viewScale`）。

**执行引擎** (`src/engine.js`). `topologicalSort()` 基于 `deriveEdges()` 排序实例；`propagate(startVarName)` 从某实例开始按拓扑序调用每个方法；`stepAll()` 一步还会调 `tick()`。四种模式（`off`/`manual`/`auto`/`step`）从工具栏切换。

**持久化。** `sa_data` 存 `{version:3, sourceCode, visualState, graphId, graphTitle}`。`sa_config` 存样式 + 主题。URL hash 分享编码 sourceCode（UTF-8 safe base64），上限 24000 字符。`src/main.js` init 优先级：URL hash > localStorage > DEFAULT_BOOTSTRAP。

**旧格式硬切换。** v0.5 之前的 `sa_data`（version !== 3，含 `instances`/`nodes` 字段）与 v0.6 不兼容。`load()` 检测到旧版本会丢弃并清空 `sa_data`，返回 false → 走 DEFAULT_BOOTSTRAP。

## Constraints

- No frameworks, bundlers (besides esbuild for dev), or backend services. The deployed artifact is a single static `dist/index.html`.
- Not a git repo (no `.git` directory).
- class 定义写在 sourceCode 字符串里（启动时 `new Function` 执行），不在 bundle 中作为 module import。
- Class method bodies forbid `fetch` / `XMLHttpRequest` / `import` / `require`（文档约定，无运行时强制）。
- Scanner 只识别 `this.<标识符>.<标识符> = ...` 形式（不识别 `this['x'].y = ...`、解构赋值、`Object.assign`）。
- Scanner 是简单正则实现，不识别字符串字面量内的模式 — class 库作者应避免在方法体的字符串里出现 `this.X.Y =`。
- UI labels are in Chinese; code identifiers are camelCase English.

## Documentation

- `AGENTS.md` — authoritative agent guide (file map, conventions, non-obvious interactions)
- `src/llms.txt` — AI-facing onboarding doc, copied to `dist/` on build
- `docs/spec.md`, `docs/level-design.md`, `docs/phase1.md` — historical design notes (pre-v0.6), **not actively maintained**
