# 节点交互模型重构

> 这是一份"要做成什么样子"的意图文档，不是实现指南。
> 写给未来的我（或者 AI 协作者），用来理解节点身份、属性、边、键盘交互的设计取舍。

> **⚠️ v0.9 更新（2026-06-18）：边模型已重构，下方第 3、4、5、8、9 节关于 `class.edges` + attrs null 引用槽的描述过时。** v0.9 把边彻底迁到实例级 `attrs.edges = [{ target, description }, ...]` 数组，删除 class.edges 字段。下方文档保留作 v0.8 设计意图参考，权威实现以 `CLAUDE.md` 为准。

## 1. 问题背景

v0.7 的节点模型有几个相互关联的缺陷：

1. **`attrs.name` 是个伪属性**：它存在 attrs 里被画布主标题读取，但 `properties` getter 用 `if (k === 'name') continue` 把它从属性区排除。"先污染再治理"——既不是真属性也不是真身份字段。
2. **`constructor() { this.X = ... }` 风格**：属性散落在 constructor 里一行行赋值，没有"属性字典"概念。用户没主动设属性也会显示（如 examples 里 Processor 的 `this.input = 0`）。
3. **attrs 不是真正的追加字典**：`GraphStarter.add` 用 `Object.keys(fresh)` 把 constructor 字段全部预填到 attrs。实例**不能加 class 没有的字段**——`runSource` 重新执行时这些字段会被丢弃。"实例加属性"在 v0.7 不可能。
4. **缺少手动 UI 操作**：v0.7 想画边必须先在类型模式加边声明（`static edges`），再去实例模式连。日常"从节点拖一条线到另一个节点"的直觉操作缺失。复制节点只能点 panel 按钮，没有 Ctrl+C/V。
5. **`config.nodeShape` 已废**：可视化重构把形状决定权交给 `infoLevel`（minimal=圆，medium/full=矩形），nodeShape 配置在 toolbar 是死按钮。

本次重构一次性解决这些问题。设计意图跟 `docs/visualization-modes.md` 配套——那一份讲"画布上画什么"，这一份讲"节点是什么 + 怎么操作"。

---

## 2. 节点身份字段

节点有 **3 个并列的身份字段**：

| 字段 | 约束 | 来源 | 可改 |
|------|------|------|:---:|
| **节点名称** | 任意字符（建议 ≤20）| class field `name` + 实例 override | ✓ |
| **class 名** | JS 标识符 | 创建节点 modal | ✗ |
| **变量名** | JS 标识符 | `GraphStarter.add` 自动生成 `<ClassName>_<n>` | ✗（本次不做改名）|

**主标题（画布顶部大字）**：读 `attrs.name`，留空回退 `varName`。这是节点没命名时画布仍能识别实例的回退机制。

**变量名改名**这次不做。涉及 sourceCode 全文重写、URL hash 重编码、selVarName/hoverVarName 同步，复杂度高，需求不强。后续单独做。

**class 名不可改**。用户在创建节点 modal 时确定；想换 class 就删了重建。

---

## 3. sourceCode 形式（核心模型）

**所有 class 字段用实例级 class field 语法**（不是 static、不是 constructor）。每个 `new cls()` 实例天然有自己的字段副本。scanner 从 fresh 实例上提取字面量值作为"class 模板"。

```js
class Source {
  description = "数据源"            // class 默认描述
  name = "数据源"                    // class 默认名
  edges = [
    { name: 'target', description: '主数据流' }
  ]
  attrs = {
    factor: 5,
    target: null
  }
}

const Source_1 = GraphStarter.add(Source)
Source_1.name = '主数据源'           // 实例 override
Source_1.factor = 10                 // 实例 override
Source_1.target = Processor_1        // 引用槽赋值
```

### 3.1 4 个 class field

| 字段 | 类型 | 含义 |
|------|------|------|
| `description` | string | class 默认描述（class 模板）|
| `name` | string | class 默认名（class 模板）|
| `edges` | `[{name, description}, ...]` | 引用槽声明，name + description 成对（即使 description 为 `''`）|
| `attrs` | `{key: value, ...}` | class 默认属性字典（class 模板）|

**edges 数组的 name + description 必须成对**——不允许 `{ name: 'target' }` 缺 description 的形式。parser/serializeCode 都按这个约束。

### 3.2 scanner 提取 class 模板

```js
function scanClass(cls, classSource) {
  const fresh = new cls()      // 实例化拿到 class field 副本
  return {
    id: cls.name,
    description: fresh.description || '',
    name: fresh.name || '',
    edges: fresh.edges || [],
    attrs: deepCopy(fresh.attrs || {}),
  }
}
```

字面量写在 class body 里，`new cls()` 实例化时每个字段独立副本。scanner 直接读这些字段值作为"class 模板"。

### 3.3 GraphStarter.add 创建实例

```js
add(cls, explicitName) {
  const fresh = new cls()
  const attrs = deepCopy(fresh.attrs || {})   // 每个 inst 独立 attrs 副本
  // ... 给 attrs 加 __instId 反查
  const inst = { varName, className: cls.name, attrs, ... }
  return attrs   // 返回 attrs 代理（让 Source_1.X 直接读写 inst.attrs.X）
}
```

`Source_1.X = value` 顶层访问背后是 `inst.attrs.X = value`——GraphStarter.add 返回 attrs 代理，调用方不用写 `.attrs`。

### 3.4 实例 override 写法

启动段每个 override 字段写一行（兼容 v0.7 风格，AI 学习和用户编辑都顺手）：

```js
const Source_1 = GraphStarter.add(Source)
Source_1.name = '主数据源'
Source_1.factor = 10
Source_1.target = Processor_1
```

**不用 `Object.assign(Source_1, {...})` 一行式**——多行风格统一，每个字段独立编辑更清晰。

### 3.5 画布显示的"合并视图"

properties 区遍历 `{...cls.attrs, ...inst.attrs}` 的键并集（实例 override 覆盖 class 默认）：
- 排除：`name`（主标题用）、`description`（说明用）、`refNames`（来自 cls.edges 的字段名集合，引用槽不进属性区）
- 实例没 override 任何字段时，画布显示 cls.attrs 的字段（"出厂默认"）
- 实例加了 class 没有的字段（追加），也显示

### 3.6 panel 操作语义

| 操作 | 类型模式 | 实例模式 |
|------|---------|---------|
| **加属性** | 写 cls.attrs[key] + 同步 class field `attrs` | 写 inst.attrs[key] = value |
| **删属性** | 从 cls.attrs 删 key（所有同 class 实例失去）| 从 inst.attrs 删 key（class 字段保留默认）|
| **改属性值** | 改 cls.attrs[key] + 传播到未 override 的实例 | 改 inst.attrs[key]（创建 override）|

**各删各的**——类型模式动 cls.attrs，实例模式动 inst.attrs。互不干扰。

### 3.7 概念分类

attrs 字典里的字段分 3 类（panel/画布按类区分显示）：

| 类别 | 识别方式 | 显示位置 |
|------|---------|---------|
| **元信息字段** | key === `'name'` 或 `'description'` | 主标题（name）/ 底部说明（description）|
| **引用槽** | key 在 cls.edges 的 name 集合里 | 不显示在属性区，画布显示为边 |
| **数据属性** | 其他 | properties 区（key-value 行）|

---

## 4. 引用槽（边）

**声明在 class field `edges`**，**值存在 `inst.attrs` 里**：

```
inst.attrs.target = null               // 空槽
inst.attrs.target = processor_1.attrs  // 指向 Processor_1（实例引用）
```

**约束：引用槽的值只能是 null 或另一个实例的 attrs 引用**（不是普通对象、不是属性子字段）。`Source_1.target = Processor_1` 这种顶层赋值让 `inst.attrs.target` 指向 `Processor_1.attrs`（含 `__instId` 反查）。这样 deriveEdges 才能稳定画边。

panel 通过 cls.edges 判定哪些字段是引用槽——
- 实例模式编辑引用槽：UI 是下拉选择目标实例（不能输任意值）
- 类型模式编辑引用槽：编辑 class field `edges` 声明（加/删/改 name + description，成对）

---

## 5. description 两层

```
cls.description = "数据源：按 rate 产生数据"   // class 默认（class field 模板）
inst.attrs.description = '主数据源'             // 实例 override（如果设了实例级描述）
```

**wrapInstance 加 description getter**：

```js
get description() {
  const v = inst.attrs.description
  return v != null ? v : (cls.description || '')
}
```

- 画布 full 模式底部显示：取 wrapInstance description getter（优先 inst，回退 cls）
- tooltip 显示：同上
- panel 类型模式：编辑 cls.description（写 class field `description`）
- panel 实例模式：编辑 inst.attrs.description

实例级 description 让用户能给同一 class 的不同实例加不同说明（如"主数据源"vs"备用数据源"）。

name 跟 description 完全对称——class field 提供默认，实例 attrs 覆盖。

---

## 6. panel 双模式 UI

```
┌─ 类型 / 实例  [类型|实例] ─┐   ← 顶部 segmented control
├─ 节点身份 ────────────────┤
│ 节点名称: [主处理器      ] │   ← 类型：cls.name；实例：inst.attrs.name
│ Class:    Processor       │   ← 只读
│ 变量名:   processor_1     │   ← 只读
├─ 描述 ────────────────────┤
│ [处理器：放大输入并...]    │   ← 类型：cls.description；实例：inst.attrs.description
├─ 属性 ────────────────────┤
│ factor   [3            ] 🗑│   ← 类型：cls.attrs；实例：inst.attrs
│ speed    [100          ] 🗑│
│ [+ 加属性]                │   ← 双模式都能加（动不同层）
├─ 输出边 ──────────────────┤
│ target → Database_1   🗑   │   ← 类型：编辑 class field edges；实例：编辑引用指向
│ [+ 加输出边]              │   ← 类型模式才显示
└──────────────────────────┘
```

---

## 7. 拖拽边交互（新增）

**用户行为**：从节点边缘 mousedown → 拖出虚线 → mouseup 在目标节点上 → 创建边。

**两种节点形状都支持拖边**（与 `infoLevel` 模式无关）：
- **minimal 圆形**：用距圆心距离判定——`distance < radius * 0.6` 视为拖动节点，否则视为拖边
- **medium/full 矩形**：矩形 outer 框 - inner 框的边缘 hit 区（约 6-8px 宽），跟"节点本体 hit 区"区分——内部 mousedown 拖动节点，边缘 mousedown 拖出边

**流程**：
1. mousedown 在节点边缘 → 进入 `state.mode = 'edge'`，记录 `state.edgeSrcId`（源节点 varName）
2. mousemove → 显示虚线（沿用现有 `state.tempEnd` 渲染逻辑）
3. mouseup：
   - 在目标节点上 → 创建边流程（见下）
   - 在空白处 → 取消

**创建边流程**（mouseup 在目标节点上）：
- 源 cls 已有 edges：如果只有 1 个 refName，直接用；多个则弹 modal 让用户选
- 源 cls 没有 edges：弹 modal 收集 refName + description（沿用 `addOutputEdge` 流程，name + description 成对），加到 cls.edges，再赋值
- 赋值：`srcInst.attrs[refName] = targetInst.attrs`

**视觉反馈**：hover 节点时，边缘 hit 区显示淡色边框（提示"可拖出"）。

---

## 8. 键盘快捷键（新增）

| 快捷键 | 行为 |
|--------|------|
| **Ctrl+C** | 复制当前选中节点到 `state.clipboard`（存 varName 字符串）|
| **Ctrl+V** | 在本体位置 + (40, 40) offset 粘贴新实例 |

**粘贴语义**（参考 `src/input.js` copyInstance 现状 line 415-467）：
- **varName**：`<原varName>_1` 起，冲突则 `_2`、`_3`...（用 `suggestUniqueVarName`）
- **内容**：跟本体一致——attrs（含 override）、description、引用槽指向（保持指向原目标）
- **位置**：本体位置 + (40, 40) offset
- **不弹 modal**——直接用默认 varName 创建（区别于 panel 复制按钮，那个会弹 modal 询问 varName）

**实现选择：用内存 clipboard，不走浏览器原生**。原因：
- 节点是结构化对象（含 attrs、引用关系），原生 clipboard 只能存文本
- 序列化到 sourceCode 字符串再粘贴，比内存拷贝复杂且容易出错
- 不需要跨标签页/跨设备粘贴

**冲突防护**：
- panel 输入框 / codeview 编辑器 focus 时，Ctrl+C/V 走浏览器原生（复制选中文本）
- 只在 canvas focus 时拦截

---

## 9. toolbar 清理

**移除"节点形状"下拉**（`config.nodeShape`）：
- `index.html` 删 `sel-shape` 下拉
- `state.js` 删 `config.nodeShape` 字段
- `input.js` 删 `keyToEl.nodeShape` 映射
- `utils.js` 已用 `config.infoLevel === 'minimal'` 替代圆形判定
- `renderer.js` 节点形状分支：`config.infoLevel === 'minimal'` → 圆形，否则圆角矩形

---

## 10. 持久化迁移

`sa_data.version` 从 4 升到 5。

**硬切换**：load 时检测 `version !== 5`，丢弃旧数据，返回 false 走默认 bootstrap（空）。

理由：
- v0.7 刚发布，没有用户数据要保护
- 旧 v4 数据 sourceCode 用 constructor 风格，跟新模型（class field）不兼容
- 软迁移要做 sourceCode 形式转换，复杂度高，收益低

---

## 11. 影响范围

| 文件 | 改动 |
|------|------|
| `src/state.js` | 删 `config.nodeShape`；加 `state.clipboard` |
| `src/scanner.js` | 重写：扫 class field（description/name/edges/attrs），不再扫 constructor |
| `src/codegraph.js` | `GraphStarter.add` 用 `deepCopy(fresh.attrs)` 而非 `Object.keys(fresh)` 拷贝字段；serializeCode 按新模型输出（class 段用 class field 语法，实例段多行赋值）|
| `src/parser.js` | 确认能解析 class field 语法（`attrs = {...}`），如不能则扩展 |
| `src/io.js` | wrapInstance 加 `description` getter（优先 inst.attrs.description，回退 cls.description）；properties getter 合并 `{...cls.attrs, ...inst.attrs}` 减 refNames 减 {name, description} |
| `src/panel.js` | 加属性按钮（双模式）；删属性按钮；实例模式 description 编辑框；引用槽下拉选目标实例；移除 nodeShape 引用 |
| `src/renderer.js` | properties 显示从合并模型取；description 从 wrapInstance description getter 取；hover 节点显示"边缘拖拽"视觉提示 |
| `src/input.js` | 节点边缘 hit 检测（圆形 + 矩形两种）；edge 模式流程；Ctrl+C/V keydown handler；删 nodeShape 相关代码；`copyInstance` 拆出"不弹 modal 版"给 Ctrl+V 用 |
| `src/index.html` | 删 sel-shape 下拉；infoLevel 三档选项保留 |
| `src/llms.txt` | 更新 AI 文档（讲新模型）|
| `docs/v0.7-design.md` | 标注"已被本次重构替代"|
| `docs/visualization-modes.md` | 小幅更新（描述新节点模型下属性区显示规则）|
| 持久化 | `sa_data.version` 升 5，旧数据硬切换 |

---

## 12. 验证

**核心引擎**（`scripts/test-codegraph.mjs`）：
- `GraphStarter.add` 创建 inst.attrs = deepCopy(cls.attrs)
- 实例 attrs 加 class 没有的字段，runSource 后保留
- serializeCode 输出 class field 语法（不用 constructor）+ 实例多行赋值
- 实例级 description 序列化/反序列化
- edges 数组 name + description 成对

**scanner**（`scripts/test-roundtrip.mjs`）：
- 扫 class field（description/name/edges/attrs）正确
- 不再扫 constructor

**e2e**（`scripts/test-e2e.mjs`）：
- panel 加/删属性（类型/实例模式）
- panel 编辑实例级 description
- 从节点边缘拖拽边到目标节点（圆形 + 矩形两种）
- Ctrl+C/V 复制粘贴（varName `_1` 起，位置 +offset）
- 旧 v4 数据 load 被丢弃

**手测**：
- 创建节点 → 默认 attrs 跟 cls.attrs 一致，画布显示 class 默认字段
- 实例模式加属性 → sourceCode 加 `varName.X = value`
- 实例模式删属性 → sourceCode 该行消失（class 字段保留默认）
- 类型模式加属性 → class field `attrs` 加键，所有同 class 实例显示该字段
- 类型模式删属性 → class field `attrs` 该键消失
- 节点边缘拖到目标 → 边出现（圆形/矩形都行）
- Ctrl+C 选中 → Ctrl+V → 新实例出现，varName `_1` 起，位置偏移
