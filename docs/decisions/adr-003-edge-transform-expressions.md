# ADR-003: 边级 transform 表达式(轻量响应式)

## 状态

accepted

## 背景

v0.9 模型下,attrs 都是字面量赋值。改 `Population.总人数` 不会让任何依赖它的 attr(例如 `Food.需求量`)自动重算——没有依赖追踪、没有重算调度。`runtimeInstances` 是 sourceCode 的**派生快照**,不是 reactive graph。

但 `src/engine.js` 里**执行引擎已经存在**:`propagate(startVarName)` 按拓扑序(Kahn 算法)调用每个实例的方法,改 attr 后 debounce 300ms 触发(`panel.js` 的 `triggerPropagate`)。**循环依赖检测也已经做了**(`topologicalSort` 标记 `_topoError`)。换句话说,"graph 改了自动重算下游"的机制现成,只是当前执行单元是 **class 方法体**(process / tick),没有更轻量的入口。

需要一种**轻量响应式**机制,满足三个约束:

1. 不引入新 mode(避免 ADR-002 双模式的转换损耗)
2. 不发明 DSL(保持"sourceCode 是原生 JS")
3. 不破坏 scanner / serializeCode 的字面量契约(可增量改造)

## 考虑过的方案

### 方案 A: 扩展 ADR-002 双模式为"描述层 / 逻辑层"(被拒)

- 思路:UI 模式 = 描述层(attrs 全字面量,静态);Code 模式 = 逻辑层(attrs 可含方法体 / getter,可执行)
- 优点:复用现有 segmented control,语义分层清晰
- 缺点:**UI↔Code 转换会擦方法体**——UI 模式的 `serializeCode` 是完全重建 sourceCode,编辑带方法体的 Code 模式 sourceCode 时逻辑层被清空。要么 UI 改成 patch(复杂),要么立规矩"含方法体的 sourceCode 在 UI 模式只读"(割裂)
- **拒绝理由**:转换损耗是 ADR-002 已经接受的痛点,在它上面再叠加"逻辑层擦除"会让双模式实际不可用。违反"统一模型优先"——本来想避免双套机制,结果在 mode 里面又塞了一层 mode

### 方案 B: attr 级表达式(`= Population_1.总人数 * 0.02`)(被拒)

- 思路:attrs 的 value 可以是字面量或 `=` 前缀表达式字符串(Excel 风格),panel 输入框直接写
- 优点:spreadsheet 心智,用户熟悉;scanner 不用改(表达式就是字符串)
- 缺点:**节点级指向 UX 痛点**——表达式里要手敲 varName(`Population_1`),这是 bootstrap 时机器拼的(`GraphStarter.add(Population)` → varName `Population_1`),用户脑子里根本没有这个概念,得回去查;打字易错且 debug 困难
- **拒绝理由**:绝对引用是 spreadsheet 的天然痛点,但 spreadsheet 至少 cell 名(A1/B2)是网格位置稳定可读;graph 的 varName 是机器生成的不友好。这个痛点在 attr 级方案里无解——任何"引用别的节点"的语法都得想办法命名别的节点,而 varName 不适合人脑

### 方案 C: 边级 transform 表达式(采纳)

- 思路:边扩展为 `{ target, description, transform? }`,transform 是可选 JS 语句片段字符串;求值时 `source` / `target` 是相对引用,自动绑定到边的两端节点 attrs
- 优点:
  - **节点级指向天然消失**——边连了谁就是谁,表达式里用 `source['X']` / `target['Y']`,不用记 varName
  - **表达式挂在"关系"上,语义对齐**——`Food['需求量']` 由 `Population → Food` 这条边决定,把逻辑放在边上是 graph 的天然表达
  - scanner / runSource / deriveEdges 不动(transform 是 attrs.edges 里的可选字符串字段,JS 字面量透明保留)
  - propagate / topo sort / 循环检测全部复用
- 缺点:serializeCode 需要小改(检测 transform 字段输出);边的 panel 当前不存在(边嵌在节点 panel 的 edges 列表里),需要新增选中边的交互
- 适合场景:既要 vibe editing(画边 + 在边 panel 写公式),又要轻量响应式(改上游 attr 自动重算下游)

## 选择

选方案 C。

理由:

1. **表达式属于关系,不属于节点** — `Food['需求量'] = Population['总人数'] * 0.02` 的语义主体是"Population 对 Food 的影响",不是 Food 自己。把逻辑放在边上是语义对齐,不是凑合
2. **减少一次指向** — 节点级指向由边本身完成(source/target),表达式只需要表达"属性级"映射(`target['X'] = source['Y'] * k`)
3. **复用现有引擎** — propagate / topo sort / 循环检测已经在 `engine.js`,只需在 propagate 遍历到边时多一步"有 transform 就求值"
4. **跟 v0.9 实例级 edges 模型契合** — v0.9 已经把边迁到 `attrs.edges = [{ target, description }]`,加 `transform?` 是纯增量字段,不破坏现有结构
5. **统一用 bracket access 访问属性** — transform 表达式内部访问 attr 一律用 `source['key']` / `target['key']`,不用点访问。理由:(a) 消除"中文 key 能否点访问"的歧义;(b) 跟 panel 里属性列表(本来就是字符串)的视觉一致;(c) 跟 JSON 序列化对齐;(d) UX 上用户照抄属性名字符串,降低出错率。代价是表达式稍长,但统一性收益值得

**取舍:** 接受"边的 panel 需要升级为第一公民"和"serializeCode 需要小改"两个工程成本。换得不引入新 mode、不发明 DSL、不破坏 scanner/deriveEdges 契约三个约束的全部满足。

## 设计细节

### transform 语义

- transform 是 **JS 语句片段字符串**(不是表达式),求值方式 `new Function('source', 'target', transform).call(null, sourceAttrs, targetAttrs)`
- 选语句片段而非表达式:支持 `if` / 临时变量 / 多语句,跟 sourceCode 里 class 方法体的语义对齐,用户/AI 不用切换心智
- 单行 `target['X'] = source['Y'] * 0.02` 是合法语句(赋值表达式也是语句)
- 多行带控制流也合法:`if (source['库存'] < source['阈值']) target['饥饿'] = true`

### sourceCode 形态

边的字段从 `{ target, description }` 扩展为 `{ target, description, transform? }`。未加 transform 的边跟现状完全一样。

```js
Population_1.edges = [
  {
    target: Food_1,
    description: '劳动力换食物',
    transform: "target['需求量'] = source['总人数'] * 0.02"
  },
  {
    target: Fuel_1,
    description: '劳动力换燃料'    // 没 transform,纯结构边
  }
]
```

更复杂的 transform(多语句):

```js
{
  target: Prefabs_1,
  description: '建立工厂消耗',
  transform: `
    const cost = Math.ceil(source['库存'] * 0.1);
    if (source['库存'] >= cost) {
      source['库存'] -= cost;
      target['库存'] += cost * 5;
    }
  `
}
```

## 后果

### 正面后果

- **轻量响应式落地** — 用户在 panel 画边 + 写公式,改上游 attr 自动重算下游,不需要写 process 方法体
- **跟"变化/周"洞察对齐** — `变化/周` 是人手填的导数(AI 生成时估值),transform 是机器算的导数(运行时实时算),两者共存:简单场景手填,复杂场景写公式
- **scanner / runSource / deriveEdges 不动** — transform 是 `attrs.edges[i]` 上的可选字符串,JS 字面量透明保留
- **执行引擎复用** — engine.js 的 propagate / topologicalSort / 循环检测全部可用
- **AI 友好** — AI 生成 graph 时,transform 是边的自然属性,不需要单独的"逻辑层"概念

### 负面后果

- **serializeCode 需要小改** — `codegraph.js:190-200` 当前硬编码 `{ target, description }`,会丢 transform。需要改成检测 transform 字段存在就加进输出(5-10 行改动)
- **边的 panel 升级** — 当前边嵌在节点 panel 里,挂 transform 后边变成"有内容的实体",值得独立 panel。但需要新增"点击边选中"的交互(目前只能选节点)
- **属性级指向痛点(已大幅缓解)** — bracket access 统一后,用户不再需要判断"中文 key 能否点访问"。剩下的痛点是"打字易错"(尤其长 key 名),靠边 panel 常驻 source/target 属性列表提示解决——用户照抄字符串
- **依赖图扩展** — 当前 `topologicalSort` 基于 `deriveEdges()`。transform 引用的属性如果在 source/target 上,边本身已经在依赖图里,没问题;但如果表达式引用了**边两端之外**的第三个节点(罕见),topo sort 不会包含它,需要扩展解析

### 已决策

- **边的 panel 形态** — 升级为**第一公民**(独立边 panel)。点画布边 → 弹独立编辑面板,跟节点 panel 平级。理由:transform 让边变成"有内容的实体",值得独立 panel;description 输入框 + source/target 属性列表提示 + transform textarea 都需要空间,嵌在节点 panel 会过挤
- **execMode 开关语义** — transform **不受 `execMode === 'off'` 抑制**。理由:transform 像 Excel formula,是 attrs 自身的一部分(不是"外部方法体"),用户写了就该立即生效。实现上 transform 改完后走独立的 `runTransforms()` 路径,绕过 triggerPropagate 的 off 短路(panel.js:25)
- **依赖图扩展** — **强约束:transform 只能引用 source/target 属性**。理由:不扩展 topo sort(边本身已在 topo 序里,source 先于 target,顺序天然正确);表达式跨节点引用是罕见场景,真要表达可手动补边。简化实现,放弃少量表达力
- **URL 旧版兼容性** — 开发阶段不考虑。新版 sourceCode 是合法 JS,旧版引擎能 parse,但旧版 serializeCode 会擦除 transform。等稳定后再决定是否 bump version
- **属性访问语法** — 统一 bracket access(`source['key']`),不用点访问
- **transform 默认行为** — 没 transform 的边是纯结构边,不保留任何隐式"默认流动"

## 关联

- 上游:本决策符合 `CLAUDE.md` [为什么] §1 "统一模型优先"(不引入新 mode / DSL)、§3 "vibe editing 与 code editing 不能合并"(transform 是 vibe editing 的轻量扩展,不是新 mode)
- 下游:
  - `engine.js` 的 propagate 加 transform 求值层(遍历到边时,有 transform 就 `new Function` 求值)
  - `codegraph.js` 的 serializeCode 小改(检测 transform 字段输出)
  - `codegraph.js` 的 scanner 不动(transform 是字符串字段,JS 字面量透明保留)
  - `panel.js` 新增边选中 + 边 panel(取决于 OQ#1)
  - `codegraph.js` 的 topologicalSort 可能扩展(取决于 OQ#3)
- 平行:
  - 跟 ADR-002 双模式正交——transform 在 UI 模式可用(Code 模式自然也可用,因为 sourceCode 共享)
  - 跟 ADR-001 实例级 edges 一致——transform 是 `attrs.edges[i]` 上的字段,跟现有模型契合
- 历史背景:`src/engine.js` 是 v0.6 留下的执行引擎,原本为 step 推进设计;v0.9 不激活 step(违背"不做时序动画"),但 propagate(单次重算)一直可用,本 ADR 让它有了轻量入口
