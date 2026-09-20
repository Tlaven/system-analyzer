# ADR-010 影响解析:选中触发 + 闭包分层 + 探测边依赖方向

- 状态:accepted
- 日期:2026-09-19
- 关联:ADR-006(探测边;本 ADR 定义其影响语义)、ADR-005(A3 环标记,与闭包互补)、验收第一问"哪里有环 / 谁影响谁"的后半

## [是什么] 背景

现状:`renderer.js` 已有 hover 1-hop 高亮 + 无关元素 dim(只走声明边,`hoverConnectedEdgeIds`);探测边有 `fields` 字段路径但只用于画布虚线标签;panel 无依赖查询入口。

验收第一问只完成一半:环标记(A3)有了,"谁影响谁"只能靠肉眼沿边追。需要:选中节点 → 上游/下游闭包 + 画布聚焦 + 文字列表。

## [为什么] 决策

1. **触发**:选中节点即进入影响模式(`state.selNode` 为焦点);hover 保留 1-hop 现状不改。不引入独立模式开关——选中本来就是"停下来看"的信号
2. **方向与深度**:panel 三选(上游 / 下游 / 双向,默认双向,`state.influenceDir` 仅会话);传递闭包;直接邻居全亮、间接弱亮(0.85)、不可达 dim(0.35);方向单选时另一侧自然被隔离
3. **依赖来源**:声明边 + 探测边。**探测边的影响方向 = 依赖方向**(`u⇢v` 即 u 引用 v ⇒ v 影响 u,与画布箭头相反);同对已有声明边 `u→v` 时该探测边不参与(延续 ADR-006 差集口径,与渲染一致)
4. **列表**:节点级、仅直接邻居,分上游/下游两节(标题带 `直接 N · 间接 M` 计数);行注来源(声明边显示 description;探测边显示 `引用: <field> ×N`);点击行 → 选中对方(panel 切换、焦点转移,**不移动视口**)
5. **实现**:新 `src/influence.js` 纯函数 + 记忆化。缓存键 = `(varName, direction)` + **deriveEdges/deriveProbeEdges 的缓存数组身份**——两者自身的失效即缓存失效,不新增失效点(比挂 `invalidateEdges` 更稳:engine 改引用导致探测边失效时同样覆盖)
6. **优先级**:影响激活时覆盖搜索 dim;与 hover dim 互斥(现有条件 `!state.selNode` 已保证);环红虚线、执行脉冲不受影响

## 被拒方案

- **hover 直接升级为闭包**:无法区分方向;闭包大时画面全亮;hover 是即时反馈,hover 期间弹列表会闪
- **独立"影响"模式开关**:多一个模式概念,与选中/panel 工作流脱节
- **只做 1-hop + 列表**:看不出连锁影响,失去"解析"的意义
- **属性级列表**:面板过长;声明边无字段信息,与探测边的 field-path 两套语义混杂
- **视口自动移动**:点列表即跳镜头易迷失;先只切焦点
- **影响高亮开关**:默认选中即开——连通图里默认双向只 dim 不可达部分,干扰小;实测吵再加
- **路径枚举 / 中心度等图分析**:超出"查邻域"定位,后置

## 影响面

- 新 `src/influence.js`:`computeInfluence(state, varName, direction)` / `invalidateInfluence()`(身份键缓存下后者仅测试与手动清缓存用)
- `src/renderer.js`:节点 alpha/描边分层、声明边与探测边的参与态
- `src/panel.js`:节点面板新增"影响"区(实例模式,Code 模式只读也显示);`src/state.js` 加 `influenceDir`
- `src/input.js`:`window.setInfluenceDir` / `window.selectInfluenceTarget` / `__sa_test.influence`
- 测试:新 `scripts/test-influence.mjs`(Node,闭包语义);e2e 选中/切向/点行
- 文档:`docs/visualization-modes.md` §11;CLAUDE/README/architecture/CHANGELOG 同步

## [不变量]

33. **探测边的影响方向是依赖方向**(u 引用 v ⇒ v 影响 u),与画布箭头相反;同对已有声明边 `u→v` 时探测边不参与影响闭包(差集口径与渲染一致)。
34. **影响闭包纯派生,不落任何持久化**(不入 sourceCode / URL / localStorage);缓存以 deriveEdges/deriveProbeEdges 的缓存数组身份为键,不新增失效点。
35. **影响模式不引入新状态机**:焦点 = `state.selNode`,方向 = `state.influenceDir`(会话内,不持久化);不新增第三个模式概念。
