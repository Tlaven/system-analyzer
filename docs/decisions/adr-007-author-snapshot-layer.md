# ADR-007 编辑快照层:演化值不自动固化

- 状态:accepted
- 日期:2026-09-19
- 关联:ADR-005(演化层数据不序列化)、ADR-006(B-L1 引用序列化)、骨架验证 4.11(本 ADR 解决其钉住的"已知张力")

## [是什么] 背景

现状:UI 编辑(panel 改值、加删属性、边编辑、拖拽建边等)统一走 `syncCodeFromRuntime() → serializeCode(state)`,而 `serializeCode` 的序列化源是 **live `runtimeInstances` 的 attrs**。

问题:方法体(`stepAll`/`propagate`)与 transform 会改写同一批 attrs(运行时演化)。于是"连播 100 拍后随手改个名字"会把**所有实例的演化值一并写进 sourceCode**:

- reset 回不到作者态(重跑源码得到的是被固化的运行结果)
- URL 分享/AI 读回把观察值当成作者意图
- 与 ADR-005"演化层数据不序列化"、CLAUDE.md"sourceCode 只承载作者意图"冲突

骨架验证(`scripts/test-skeleton.mjs` 4.11)已把该行为钉为"已知张力,待决策"。

## [为什么] 决策

引入**作者态快照层 `authorAttrs`**(`state.authorAttrs: Map<varName, attrs>`):**serializeCode 的序列化源改为 authorAttrs**。

- **捕获**:`runSource` 结束时,每个实例拷贝一份作者态 attrs——容器深拷贝、实例引用保身份(不递归目标)、edges 逐条拷贝(只含 target/description/transform)、跳过 `__` 键
- **写穿**:所有 UI 编辑路径在改 live attrs 的同时更新 authorAttrs(panel 改值/加删属性/边编辑/transform 编辑、拖拽建边、类型模式默认值传播、删除实例的入边清理)
- **隔离**:方法体/transform/`stepAll` 只改 live attrs,不碰 authorAttrs
- **显示**:画布/panel/sparkline 仍读 live attrs——演化值照常可见,只是不进代码
- **reset = runSource(sourceCode)** → authorAttrs 从代码重建 → 恢复作者态(兑现 llms.txt "reset 时丢弃运行时 mutation")
- **undo/import/load/切模式**都经 `runSource`,authorAttrs 自动重建,无额外快照
- 序列化判定沿用"序列化形态比较";通道 4 override 下划线改读 authorAttrs(它表达"作者 override",不是"与默认值不同")

## 被拒方案

- **接受现状(全量固化)**:reset 语义失真,观察值污染作者意图;违反既有不变量,不立
- **显式"固化到代码"按钮**:默认路径仍会固化,用户需理解两种编辑的差别;多一个 UI 概念
- **live vs baseline diff**:演化与编辑都改 live,无法区分,不解决
- **写入追踪(Proxy 拦截)**:能自动区分编辑与演化,但破坏 attrs 恒等/双身份系统,属 B L2 范畴(ADR-006 已缓期);authorAttrs 是它在 L1 的**显式版**——调用点写穿而非代理拦截,代价是新增编辑入口时必须记得写穿(靠不变量 27 + 测试约束)

## 影响面

- 新 `src/author.js`:`captureAuthorAttrs` / `authorAttrsOf` / `setAuthorAttr` / `deleteAuthorAttr` / `markEdgesEdited`
- `codegraph.runSource`(捕获)、`codegraph.serializeCode`(改源,author 缺失时回退 live 保持兼容)
- `panel.js` 全部编辑路径、`input.js`(拖拽建边 / 剪贴板复制 / 新建后 runSource)、`editor.js`(delInstance/delEdge)、`renderer.js`(override 下划线)
- 测试:test-skeleton 4.11 翻转为"演化值不固化"、storm 镜像写穿;test-codegraph 区 9 改用写穿 API;e2e 经 UI 路径的用例自然覆盖

## [不变量]

26. **serializeCode 的序列化源是 authorAttrs**(作者态快照),不是 live attrs。方法体/transform/stepAll 对 attrs 的写入不进 sourceCode。
27. **authorAttrs 生命周期与 runtimeInstances 对齐**:`runSource` 重建;UI 编辑写穿;任何改 attrs 的 UI 入口必须同步写穿(author 缺失时 serializeCode 回退 live,仅作容错,不是行为契约)。
