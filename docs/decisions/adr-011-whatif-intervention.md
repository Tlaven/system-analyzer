# ADR-011 干预(what-if):假设层 + 基线/复跑对比

- 状态:accepted
- 日期:2026-09-21
- 关联:ADR-005(traces 数据基础)、ADR-007(作者态快照;本 ADR 是其不变量 27 的显式例外)、ADR-010(锁定参数的下游可用影响闭包定位)、验收第三问"改了这个会怎样"

## [是什么] 背景

现状:panel 手动改值就是**改作者态**(ADR-007 写穿)——改完即持久化,无法"试一个值然后无损撤销";`traces` 有历史但无"基线"概念;`resetRuntime` 清 traces 后没有"同起点重放"的机制。验收第三问(改了这个会怎样)只能靠肉眼观察当前值,看不到"和原来比差在哪"。

数据基础已具备:`stepAll` 产 traces(环形缓冲 200,ADR-005)、`state.authorAttrs` 是作者态快照(ADR-007)、`runSource` 从 sourceCode 全量重建(确定性)。

## [为什么] 决策

1. **形态 = 假设层 + 基线/复跑对比(v1)**。不做参数扫描(回答"敏感度"而非"单次干预",成本高一个量级),不做多基线。
2. **逐属性锁定表达假设**:panel **数值**属性行加锁图标,锁定 = 实验参数;锁定编辑即时生效但进假设层。不引入全局"实验模式"开关(粗粒度 + 多一个模式概念,与 ADR-010 不新增状态机同精神)。非数值属性不做锁定(对比数据面是数值 traces)。
3. **假设层住 `state.whatIf`(会话层,不持久化)**:`{ locked: { 'varName.attr': true }, params: { 'varName.attr': value }, baseline: null }`。锁定编辑写 live + params,**不写穿 `authorAttrs`**——这是 ADR-007 不变量 27 的**显式例外**(仅限锁定属性);解锁 = 该 attr 立即恢复作者值(authorAttrs 缺失回退 class 默认)。
4. **基线 = 四元组** `{ traces(深拷贝), values(原始值快照), tickCount, sourceCode }`。`baseline.sourceCode !== state.sourceCode` 即"基线过期"(UI 提示,仍允许复跑)。`values` 只收 number/string/boolean——对象/引用在 `runSource` 重建后身份必变,纳入会产生假差异。
5. **复跑配方固定**:`runSource → applyHypotheses → runTransforms → stepAll × baseline.tickCount`(UI 包装层补 `wrapAllInstances` + render,**不 save**——sourceCode 未变,实验是易失层)。确定性来源:runSource 全量重建 + 同 tickCount;基线 tickCount=0 时只对比静态值。
6. **假设值只在两条路径应用到 live**:锁定属性编辑(即时)、复跑。其他 `runSource`(重置/导入/撤销/Code 提交)不自动应用假设,也**不自动清除实验**——锁与基线仍在,复跑可重现。
7. **对比视图双通道**:sparkline 叠加(基线灰 ghost 在下、当前彩在上,双序列合算 min/max;数据来自 `baseline.traces`)+ panel 顶部"实验对比"节(全局差异行:锁定参数置顶,其余按 |Δ| 降序;点行选中该节点)。
8. **模块边界**:新 `src/whatif.js` 纯逻辑(Node 可测),panel/renderer/input 只消费;锁定与基线都是**易失观测层**(与 ADR-005 同精神),不入 sourceCode / URL / localStorage。

## 被拒方案

- **全局"实验模式"开关**:粗粒度(实验期间连改图结构都变假设)+ 多一个模式概念;逐属性锁定精度更高且贴合 roadmap"锁定属性"措辞
- **快照还原法**(编辑照常落码,靠 sourceCode 快照还原):实验污染 URL/localStorage,与"假设不落码"直接冲突;且无锁定语义
- **参数扫描 / 敏感度分析**:回答的是另一个问题(扫一个范围看终值曲线),v1 范围失控
- **`runSource` 内统一 `applyHypotheses`**:导入/撤销/Code 提交时旧假设会静默命中同名 attr(新图意外被改),且实验被误认为持续生效
- **实验持久化**(锁/基线跨刷新):运行时事实不落码原则;要持久化须新 ADR 重新论证
- **非数值属性对比**:对象引用身份在重建后必变(假差异);字符串/布尔差异表留待后续
- **基线自动重录**(sourceCode 变时):用户可能只是修了无关细节,静默换基线会让"和原来比"失去参照;改为提示过期、由用户决定
- **复跑自动保存 sa_data**:sourceCode 未变,无内容可存;反而放大"实验已持久化"的误解

## 影响面

- 新 `src/whatif.js`:`toggleLock` / `isLocked` / `setHypothesis` / `applyHypotheses`(容错跳过已删 attr)/ `captureBaseline` / `replay` / `clearExperiment` / `diffSummary` / `baselineStale`
- `src/state.js`:加 `whatIf`;`src/panel.js`:锁按钮 + "假设"badge + 写值分支 + sparkline 叠加 + 实验对比节;`src/input.js`:window 钩子 + 实验菜单动作;`src/index.html`:实验菜单 + CSS
- 测试:新 `scripts/test-whatif.mjs`(Node,第七套)+ e2e 53-54
- 文档:`docs/visualization-modes.md` §12;`docs/roadmap.md`(干预移出远期);CLAUDE / README / architecture / CHANGELOG 同步

## [不变量]

36. **假设值只住 `state.whatIf`(会话层)**:锁定属性的编辑写 live + params,不写穿 `authorAttrs`、不入 sourceCode / URL / localStorage;清除实验回作者态。这是 ADR-007 不变量 27 的**显式例外,仅限锁定属性**。
37. **复跑配方固定为 `runSource → applyHypotheses → runTransforms → stepAll × 基线 tickCount`**,复跑不 save;基线四元组含 `sourceCode`,与当前不等即"基线过期",UI 必须提示。
38. **假设值只在两条路径应用到 live**(锁定编辑 / 复跑);其他 `runSource` 不自动应用假设、不自动清除实验。基线 `values` 只收原始值(number/string/boolean),引用不入快照。
