# System Analyzer — Agent Guide

## Run

```bash
npm install           # esbuild + puppeteer + codemirror
npm run build         # bundle src/main.js → dist/index.html (single file, open in browser)
npm run dev           # watch src/ + dev server at localhost:8000
```

## Test

```bash
npm run build                            # required first (e2e loads dist/index.html)
node scripts/test-codegraph.mjs          # v0.6 核心引擎单测（runSource/serializeCode/resetRuntime，无浏览器）
node scripts/test-roundtrip.mjs          # scanner 静态分析单元测试（无浏览器）
node scripts/test-e2e.mjs                # puppeteer，加载 dist/index.html，验证完整 v0.6 流程
```

No test runner, lint, or typecheck. All verification is the three `.mjs` scripts above plus manual browser inspection.

## Data model（v0.6：code-as-truth + GraphStarter）

- **`state.sourceCode` 是唯一真相源。** 一段 JS 代码同时含 class 定义 + 启动代码。`state.runtimeInstances` 由 `runSource` 派生
- **RuntimeInstance = 节点。** `{varName, className, attrs, edgeMeta, _topoError, _execError}`。多个实例可共享同一个 class
- **Class 信息派生自 sourceCode。** `splitSource`（`src/parser.js`）切 class 段与 bootstrap 段；`scanClass`（`src/scanner.js`）填 properties/references/emitters/methods/hasTick/defaults；`static description` 由 runSource 单独读 `cls.description`
- **边由 deriveEdges 派生。** 3 条件合取：源 class 有 emitter + 引用槽非空 + 目标 class 声明了被写属性。`src/io.js:deriveEdges()`
- **引用值是目标 attrs 对象（身份比较），不是 id 字符串。** `GraphStarter.add()` 返回 attrs 本身（含不可枚举 `__instId`），方法体内 `this.X.Y = v` 无 proxy 直接命中目标
- **实例身份 = varName。** 启动代码里的 `const <varName> = GraphStarter.add(ClassName)` 决定身份。varName 不可改、不可重复（重复 JS 会报 SyntaxError）
- **edgeMeta 存按 refName 索引**（不是 v0.5 的 `targetId|attr`）。因为 v0.6 的 describe API 是 `GraphStarter.describe(srcInst, refName, text)`

## Parser 规则（`src/parser.js`）

- 由 `scripts/parse-class-demo.mjs` 迁移而来：Cursor 字符扫描 + 括号深度计数
- `parseClass(code)` 解析单个 class 字符串：className / description（v0.6 新增 static description 解析）/ properties / methods
- `splitSource(sourceCode)` 切出 `{classes: [{name, source}], bootstrap: '启动代码段'}`，按字符位置切分（识别 `class X extends Y { ... }` 边界）

## Scanner 规则（`src/scanner.js`）

- 识别 `this.<ref>.<attr> = ...` 形式（含 `+=`、`-=`、`*=` 等复合赋值）
- 排除 `==` 和 `===`（用 negative lookahead）
- 不识别字符串字面量内的模式 — class 库作者需注意
- 不识别 `this['x'].y = ...`、解构赋值、`Object.assign(this.x, ...)`
- 条件写入（`if (cond) this.X.Y = ...`）仍算 emitter（静态分析）

## Codegraph 规则（`src/codegraph.js`）

- `runSource(sourceCode, state)`：splitSource → eval 每个 class source → scanClass → 静态扫 bootstrap 拿 varName 顺序 → `new Function('GraphStarter', sourceCode)(bridge)` 执行 → bridge._instances 按 varName 顺序对应 → 写入 state.runtimeInstances
- `serializeCode(state)`：class 段原样输出（splitSource 切出）+ 启动代码段机器生成（add 调用 + override + 引用 + describe）
- `resetRuntime(state)`：alias for `runSource(state.sourceCode, state)`，丢弃运行时 mutation
- VAR_DECL_RE 正则扫 bootstrap 拿 varName 顺序表，必须与 `GraphStarter.add()` 调用顺序一致（每个 add 必须以 `const <vN> =` 形式）

## HTML ↔ module bridge

`src/index.html` 用 inline `onclick`。所有从 HTML 调用的函数必须在 `src/input.js` 显式注册到 `window`。`selNode`/`selEdge` 通过 `Object.defineProperty` 暴露（selNode 是 selInstance 的别名，setter 接受 RuntimeInstance 并写入 selVarName）。

测试钩子：`window.state`, `window.config`, `window.propagate`, `window.deriveEdges`, `window.__testImport`, `window.toggleCodeView`, `window.commitCodeNow`, `window.resetRuntime`。

## 编辑流程（双入口）

**Panel UI（右栏，属性微调）：** 选中实例 → panel 显示属性表单。改属性 → `inst.attrs[k] = v` → `syncCodeFromRuntime()`（serializeCode 写回 sourceCode + save + dispatch `sa-source-updated` 事件）→ codeview 自动同步。改引用槽 = 改连线 = 同流程。

**Codeview（左栏 `</>` 按钮，结构性变更）：** CodeMirror 6 编辑整段 sourceCode。debounce 400ms 后 commit → `runSource` → 成功则更新 runtimeInstances + render；失败显示错误但保留用户输入。

**画布（视图层）：** 拖动位置只改 `visualState.positions[varName]`，不入代码。删除节点/边 = `delInstance`/`delEdge`（editor.js）+ `syncCodeFromRuntime`。

## 引擎（`src/engine.js`）

- `topologicalSort()`：基于 `deriveEdges()` Kahn 排序，循环依赖会标记 `inst._topoError`
- `propagate(startVarName)`：从 startVarName 开始按拓扑序调用每个实例的每个非 tick 方法
- `stepAll()`：全拓扑序调用方法 + 调 `tick()`（如果存在）
- 方法 `this` = `inst.attrs`，方法体内 `this.X = v` 写 attrs[X]，`this.X.Y = v` 写目标 attrs[Y]
- 4 个执行模式：off（不传播）/ manual（面板 ▶ 按钮触发）/ auto（属性变更 debounce 300ms 触发）/ step（▶ 下一步 按钮）

## 持久化 & URL 分享

- `sa_data`：`{version:3, sourceCode, visualState, graphId, graphTitle}`（v0.6）
- `sa_config`：style/theme 配置
- URL hash：编码 `{version:3, sourceCode, visualState, ...}` 整个 wrapper（UTF-8 safe base64），~24000 字符上限
- 旧 sa_data（version !== 3）被硬切换忽略并清空

## Key files

| File | Purpose |
|------|---------|
| `src/main.js` | 入口、init（load sourceCode → runSource → mountCodeView）、resize |
| `src/state.js` | state 对象（sourceCode/runtimeInstances/visualState/selVarName）+ 兼容别名层 + 调色板 |
| `src/parser.js` | parseClass（含 static description）+ splitSource（切 class 段/bootstrap 段） |
| `src/scanner.js` | 静态扫描 class → properties/references/emitters/methods/hasTick/defaults |
| `src/codegraph.js` | runSource / serializeCode / resetRuntime / GraphStarter bridge |
| `src/bootstrap.js` | DEFAULT_BOOTSTRAP 字符串（Source/Processor/Database/Sink + 示例启动段） |
| `src/codeview.js` | CodeMirror 6 wrapper（mountCodeView/setCode/getCode/toggleCodeView/commitCodeNow） |
| `src/io.js` | deriveEdges/save/load/importSource/exportSource/shareURL/wrapInstance/syncCodeFromRuntime/resetRuntime |
| `src/engine.js` | topologicalSort/propagate/stepAll（基于 runtimeInstances + varName） |
| `src/panel.js` | 实例面板 + 边面板（属性改触发 syncCodeFromRuntime） |
| `src/editor.js` | pushUndo（sourceCode 快照）/undo/select/del/delEdge |
| `src/input.js` | 鼠标/键盘 + window 桥 + toolbar 按钮 |
| `src/physics.js` | 力布局、`fitToView`、`stepPhysics` |
| `src/config.js` | config 加载/保存 + `applyTheme()` |
| `src/utils.js` | `toB64`/`fromB64`、snap、hit testing、geometry |
| `src/index.html` | HTML + CSS（toolbar 含 `</>` 和 ↻ 按钮、左 codeview 面板、右 panel） |
| `src/llms.txt` | AI 接入文档（build 时拷到 `dist/`） |

## Non-obvious interactions

| Action | Result |
|--------|--------|
| 点击 `</>` 按钮 | 切换 #code-panel 显隐；显示时 refreshFromState 同步 sourceCode 到 CodeMirror |
| CodeMirror 输入 | debounce 400ms → runSource → 成功更新 runtimeInstances + render；失败显示错误 |
| 单击实例 | 选中 + 打开右侧 panel |
| 拖动实例 | 移动位置（写入 `visualState.positions[varName]`，不入代码） |
| 单击边 | 选中 + 打开边 panel |
| Panel 改属性 | inst.attrs[k] = v → syncCodeFromRuntime → sourceCode 启动段出现 `<varName>.<k> = <v>` |
| Panel 改引用下拉 | inst.attrs[ref] = target.attrs → sourceCode 出现 `<src>.<ref> = <targetVarName>` |
| 删除实例/边 | 从 runtimeInstances 移除 + 清引用 + syncCodeFromRuntime + save |
| 点 ↻ 按钮 | resetRuntime：重新 runSource(state.sourceCode)，attrs 回到初始（运行时 mutation 丢弃） |
| Space + 左键拖动 / 中键 / 右键拖动 | 平移画布 |
| 鼠标滚轮 | 缩放（保持鼠标位置不动） |
| Ctrl+F → Enter | 居中到第一个匹配的实例 |
| 选 exec mode "步进" | 工具栏出现 "▶ 下一步" 按钮 |
| Delete/Backspace（非编辑态）| 删除选中实例或边 |
| Ctrl+Z | 撤销（弹出 sourceCode 快照） |

## Conventions

- UI labels & tooltips in **Chinese**; code identifiers in camelCase English
- Brightness (0-100) 连续插值 light/dark palette；`isDark` export in `state.js` 仅用于 utils.js 的 edge color
- Class method bodies 在 sourceCode 字符串里，由 `new Function` 执行，约定不调用 `fetch`/`eval`/`import`
- Class 库作者：避免在方法体的字符串字面量中出现 `this.X.Y =` 模式（会被 scanner 误识别）

## Constraints

- Single-file HTML output (`dist/index.html`), no frameworks or backend services
- URL hash limit: ~24000 字符 base64
- Not a git repo (no `.git` directory)
- Edit `src/` files, run `npm run build` to deploy
- CodeMirror 6 已是 deps（v0.5 死依赖，v0.6 启用）
