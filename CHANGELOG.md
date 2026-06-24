# Changelog

本文件记录 system-analyzer 所有显著变更,遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
