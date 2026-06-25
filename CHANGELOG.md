# Changelog

本文件记录 system-analyzer 所有显著变更,遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- **engine.js 剥离 DOM/render,引擎层 pure 化**——`runTransforms` / `propagate` 不再内部调 `render()`,调用方(panel `triggerPropagate` / `_onTransformInput` / input `window.runPropagate`)补 render;`stepAll` 去掉直接读改 `#step-btn` DOM 的逻辑,改 `dispatchEvent('sa-tick')`,input.js 监听后更新按钮文本 + render。engine.js 不再 import renderer.js,理论上可被 Node 单元测试加载
- **`deriveEdges` 从 io.js 迁入 codegraph.js + 加 lazy 缓存**——14 处调用方从 `deriveEdges()`(每次重算 O(n+m))改为 `deriveEdges(state)`(dirty flag + lazy 求值)。`runSource` 末尾自动失效;7 处写边入口(`editor.delInstance` / `panel.{setEdgeTarget,setEdgeDescription,delCurrentEdge,addInstanceEdge,removeInstanceEdge}` / `input.createEdgeFromDrag`)调 `invalidateEdges()`。副产物:砍掉 io↔{engine,physics,renderer,utils} 四条循环依赖 + utils.js → io.js 反向依赖。e2e 钩子 `window.invalidateEdges` 暴露
- 抽取 panel.js 私有 `markUndo()`,消除 8 处 `if (!state.panelUndoPushed) { pushUndo(); ... }` 雷同代码
- 导出 io.js `wrapAllInstances()`,替换 editor.js / codeview.js / input.js / main.js 共 5 处外部 `for...wrapInstance(inst)` 循环
- 补 codegraph.js `isValidIdentifier` 注释,说明与 utils.js ASCII 版的职责差异(序列化层 Unicode vs UI 校验层 ASCII,由 CLAUDE.md 不变量"code identifiers are camelCase English"决定,勿统一)
- **`showModal` 抽到新 `src/modal.js`**——斩断 `panel.js → input.js` 反向上行依赖(panel.js:17 改 import 源)。showModal 是 UI 原语(input.js 调:创建/复制节点、拖边;panel.js 调:加属性、加边),原本 panel 反向 import 事件层是设计异味,现 5 个 call site 都改从 `./modal.js` 进。`__modalPrefill` 测试钩子作为 showModal 内部契约跟着走
- **测试钩子命名空间化**——3 个散落的 `window.__testImport` / `window.__modalPrefill` / `window.__epAutocompleteState` 统一到 `window.__sa_test = { importJSON, modalPrefill, epAutocompleteState }`。各源文件 lazy init(`window.__sa_test = window.__sa_test || {}`)挂自己的钩子,test-e2e.mjs 48 处调用方机械替换。无兼容层(做减法,旧名一次性砍掉)

### Removed

- **wrapInstance 3 个 0-调用方 getter**:`inst.inputs` / `inst.outputs`(v0.8 端口概念残留,永远返回 `[]`)/ `inst.computed`(0 调用方,`define-demo.mjs` 的 `.computed` 是它自己 model shape 不是 inst)。同步解开 `renderer.js:352` 死代码 `12 * (n.outputs.length + 1)` → `12`(outputs 永远 [] → 该表达永为 12)

### Removed

- `engine.js` 对 `renderer.js` 的 import + 内部 3 处 `render()` 直调 + `step-btn` DOM 读写
- `io.js deriveEdges` 函数(已迁入 codegraph.js)
- `editor.js selectNode` 兼容别名(0 调用方,`delNode` 仍被 panel.js HTML onclick 用而保留)
- `io.js exportJSON` 函数(v0.5 wrapper,0 调用方,`importJSON` 仍活)

## [0.12] - 2026-06-25

### Added

- Transform autocomplete:边面板输入 `source['` / `target['` 时弹当前节点 key 列表(↑↓ 选、Enter/Tab 插入、Esc 关闭)。保留 v0.11 focus 契约(原地更新 `#ep-terr`,不重建 panel body)
- 6 个 e2e 测试(测试 29-34):autocomplete 弹列表 / 键盘 nav / Enter 插入 / Esc 关闭 / 候选过滤 / v0.11 focus 契约守卫

### Changed

- 抽取 `getInstanceAttrKeys` utility(新建 `src/attrkeys.js`),替换 panel.js / codegraph.js 共 4 处重复 attrs key 过滤。单独建文件而非放 utils.js,避免 codegraph.js → utils.js → io.js 把 Node 测试环境拉进 IO bundle,保持 codegraph.js 的 Node-runnable pure engine 边界

### Removed

- GitHub Actions CI workflow(`.github/workflows/test.yml`)—— 账户 billing 锁定导致 workflow 无法运行,移除避免误导(v0.11 引入)

## [0.11] - 2026-06-24

### Added

- GitHub Actions CI workflow(`.github/workflows/test.yml`)—— push/PR 自动跑 3 套测试
- Transform 表达式错误显示在边面板(`#ep-terr` 区域)—— 用户写 transform 的地方直接看到表达式哪里坏了
- `runTransforms` 暴露到 `window`(供 e2e 测试调用)
- 3 个 e2e 测试(测试 26-28):transform 错误显示 / 错误清除 / multi-edge 回归守卫

### Fixed

- 源节点多条 transform 边的错误覆盖问题(previously last-edge-wins):现在每条边携带自己的 `_transformError`,不再互相覆盖

### Changed

- `evalTransforms()` 错误挂载点从 `inst._execError`(源实例)迁到 `e._transformError`(边对象本身)。原因:错误是边的属性,不是源节点的属性;绑到边才能正确支持一个源节点多条 transform 边各报各的错
- `inst.error` getter(io.js)聚合本节点所有 transform 边的错误,canvas 仍可见但内容来自聚合
- `scripts/test-e2e.mjs` puppeteer launch 在 `CI` 环境变量设置时加 `--no-sandbox --disable-setuid-sandbox` args(Linux CI root 跑 Chromium 必需)

## [0.10] - 2026-06-24

### Added

- **边级 transform 表达式**(ADR-003):边上写 JS 语句片段,改上游 attr 自动重算下游,像 Excel formula。求值方式 `new Function('source','target', body).call(null, srcAttrs, tgtAttrs)`,属性访问一律 bracket access(`source['总人数']`)。不受 `execMode === 'off'` 抑制
- Scanner 支持中文/Unicode class name 标识符
- 3 个 ADR-003 相关文档:`docs/decisions/adr-003-edge-transform-expressions.md` + `docs/architecture.md` 同步 + `src/llms.txt` 加 transform 字段说明

### Changed

- 序列化边形状从 `{ target, description }` 扩展为 `{ target, description, transform? }`
- `sa_data.version` 5 → 6

## [0.9] - 2026-06-18

### Changed

- **边模型从 class 级迁到实例级** `attrs.edges` 数组(ADR-001)。每条 `{ target, description }`,`target` 指向另一实例的 attrs。统一了多对一 / 多对多 / 同目标多边的表达,消除"边和属性谁占 attrs"的歧义
- Scanner 只读 `new cls()` 实例上的 3 个 class field(description / name / attrs)。不再扫 `static edges` 字面量 / constructor / class.edges(v0.8 残留)
- 边 id 格式 `<srcVar>><tgtVar>>idx`(idx 是 attrs.edges 数组里的位置,区分同对多边)
- 端口概念重做:不再画命名端口圆点,改为四边拖柄几何产物(详见 `docs/edge-routing.md` §2.1)
- 节点显示从 `id` 改为 `varName`(实例身份);`state.instances` 改为 `state.runtimeInstances`(别名保留向后兼容)

### Removed

- `class.edges` 字段(v0.8 残留)
- `inputs` / `outputs` 命名端口概念(getter 保留返回空数组,向后兼容)

## [0.8] - prehistory

中间迭代版本,详见 `docs/archive/node-interaction-redesign-v0.8.md`。无 ADR 单独记录,git log 可追溯。

## [0.7] - prehistory

**双模式编辑(UI / Code)** 落地(ADR-002):segmented control 切换两种体感——UI 模式声明式 sourceCode 无方法体,Code 模式自由 JS 含方法体。CodeMirror 6 集成。具体日期无显式 version commit,见 `docs/decisions/adr-002-dual-mode-editing.md`。

## [0.6] - 2026-06-16

### Changed

- **"sourceCode 是唯一真相源" 重构**:`state.instances` → `state.runtimeInstances`,实例身份从 `id` 改为 `varName`,class 查找从 `classId` 改为 `className`。runtimeInstances 是 sourceCode 的派生视图,每次 `runSource` 完全重建
- URL hash 分享 = base64 编码 sourceCode(UTF-8 safe)

### Removed

- `compileAllNodes` / `compileInstances`(旧 API no-op)

## [0.5] - prehistory

尝试纯 UI 化(静态扫描 + class 库 bundle 内置 + 删除 codeview)。问题:无法表达任意算法(`process` 方法体、循环建边),表达能力被锁死。后续被 v0.6/v0.7 双模式方案取代。

## [0.4] - prehistory

早期 code-only 模式(`code-as-truth`)。用户写完整 sourceCode,门槛高,普通用户用不来。

---

> v0.4 之前的版本无文档/commit 可考。设计意图参考 `docs/decisions/` 下的 ADR 背景段。
