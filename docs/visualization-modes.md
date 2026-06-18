# 节点可视化：三档信息密度

> 这是一份"要做成什么样子"的意图文档，不是实现指南。
> 写给未来的我（或者 AI 协作者），用来理解三档模式的设计取舍。

## 1. 问题背景

画布上的节点不能"什么都显示"——同一张图，**用户在不同时刻关心的颗粒度不同**：

- 缩到能看 50 个节点时，只关心"哪里有节点、是什么类"，节点编号、属性都是噪声
- 正常编辑/连线时，关心"这是哪个实例、关键参数是多少"
- debug 时，关心"这个节点的描述说了什么、属性全列出来"

如果用一套渲染规则覆盖所有场景，结果就是要么挤、要么空。
v0.6 时代其实已经有 `infoLevel` 配置，但 medium / full 几乎一样、description 从不画在画布上——
本质上是两档（极简 / 详细），第三档是装饰。这次重写把三档的差异讲清楚。

---

## 2. 三档定位

| 档位 | 心智用途 | 切它的时机 |
|------|---------|-----------|
| **minimal** | 鸟瞰结构 | 缩到看拓扑形态、不在意具体值 |
| **medium** | 工作编辑 | 正常连线、调属性 |
| **full** | 检视 debug | 排查数据流、对图细节 |

每一档都为这个用途服务，**不是"少一些属性 / 多一些属性"的渐进**，而是不同显示策略。

---

## 3. 三档显示规则

### 3.1 内容矩阵

| 元素 | minimal | medium | full |
|------|:---:|:---:|:---:|
| 节点形状 | **圆形** | 圆角矩形 | 圆角矩形 |
| 节点名称（主标题）| ✓ | ✓ | ✓ |
| varName 副标题 | ✗ | ✗ | ✓ |
| 节点属性 | ✗ | ✓ | ✓ |
| 端口圆圈（左右两侧）| ✗ | ✓ | ✓ |
| 画布内 description | ✗ | ✗ | ✓ |
| 边标签 | ✗ | ✗ | ✗（三档全无）|
| 节点 hover tooltip | ✓ | ✓ | ✓ |
| 边 hover tooltip | ✓ | ✓ | ✓ |

### 3.2 关键决定

- **节点名称** = `attrs.name`，留空回退 `cls.name`，再留空回退 `varName`。这是节点身份（v0.8 起 name 是 class field，实例 attrs 覆盖）。
- **varName 副标题** 仅在 full 显示。minimal 不需要（圆形里塞不下两行）；medium 是工作模式，varName 的 `<ClassName>_<n>` 后缀噪声大，主标题名称已经够定位实例。full 才需要副标题，因为 debug 时 varName 是程序里引用实例的"真名"。
- **属性 = 节点属性，不含引用槽**。引用槽是边信息，画在画布上会和边重复。属性区展示**合并视图**：`{...cls.attrs, ...inst.attrs}` 减去 refNames、`name`、`description`。实例没 override 时显示 cls.attrs 默认；实例追加 class 没有的字段也显示。
- **description 来源是 class 的 `static description`**（v0.7 模型里没有实例级描述，所有同 class 实例共享）。full 把它画在节点矩形内最下方。
- **边标签三档都不画**。边的语义靠 hover tooltip 显示，画布上保留线本身和箭头。
- **形状分两种**：minimal 圆形（视觉简洁、可大量并列）；medium/full 圆角矩形（结构化排版）。同一个节点切档时形状会变。

---

## 4. 几何

### 4.1 minimal 圆形

- 半径：`max(22, textWidth/2 + 6)`，封顶 ~40px。短名字得到小圆，长名字自动扩大但有限制。
- 节点名称居中（超长截断加 `…`）。
- **没有端口**。圆周即"端口"，任何方向都能出入。

**边端点**：
- 数学层面：源圆心 → 目标圆心
- 渲染层面：画圆心到圆心的直线，线两端被圆形本体覆盖（视觉上像从圆周出/入）
- **箭头画在目标圆周交点**，不画在目标圆心（否则被圆盖住看不见）

为什么不固定边出口在某个圆周方位？因为同一个源节点可能有多条边指向不同目标，
强行在圆周上分配"出口位"既要算扇区又会重叠，不如让所有边共享圆心起点，
方向自然由目标位置决定——视觉上更干净。

### 4.2 medium / full 圆角矩形

**节点矩形结构（full 示意）**：

```
┌────────────────────────────┐
│   attrs.name 或 cls.name (主标题)  │  ← 顶部
│   varName (副标题灰)       │  ← 仅 full
│   key1            value1   │
│   key2            value2   │
│   key3            value3   │
│   key4            value4   │
│   wrapInstance.description (斜体灰) │  ← 底部，仅 full（优先 inst.attrs.description 回退 cls.description）
●                          ●  ← 端口嵌在左右边
└────────────────────────────┘
```

medium 比 full 少两行（副标题、底部 description），其余同。

**端口位置**：嵌在矩形左右两条边的中点附近（按端口数等分高度），半圆露在矩形外。
和 v0.6 时代的"端口在矩形外悬空"不同——嵌在边上让端口和节点形成一个整体，避免端口"飞出"。

**边端点**：源端口圆圈 → 目标端口圆圈，箭头画在目标端口圆圈外侧。
沿用现有 `edgePts` / `getPortPos` 逻辑。

---

## 5. 防溢出（核心设计约束）

> **画布上不允许出现文本超出节点边界的情况。** 这是设计约束，不是 best effort。

### 5.1 节点宽度自适应扩展

- 测量所有可见行的实际宽度（主标题、副标题、每个属性 row `key  value`），
  取最大值 + padding 作为节点宽度。
- 下限：`NODE_MIN_W`。
- 上限：`min(视口世界宽 × 0.4, 600)`——大屏可显示更多，但不超过视口一半避免遮蔽邻居。
- 旧的硬编码 480 上限被这条自适应规则替换。

### 5.2 数字精度截断

属性 row 的右值、端口 computed value 都走 `formatScalar(v)`：

- `|v| ≥ 1e7` 或 `|v| < 1e-4` → `toExponential(2)`（如 `1.23e+6`、`1.5e-5`）
- 非整数 → `toFixed(2)`（如 `3.14`）
- 整数部分超 12 位 → `toExponential(2)`（防止万亿级数字撑爆宽度）
- 其他整数 → 原样

数字是最容易撑爆节点宽度的来源（`1234567.891234` 比 ` Processor_1 ` 长得多），
显式精度规则比"截断加 …"更有信息量。

### 5.3 对象 / 数组折叠（消除 `[object Object]`）

- 普通对象 → `{…}`（空对象 → `{}`）
- 数组 → `[len]`（带长度，比纯 `[…]` 更有信息）
- 函数 → `ƒ`
- null/undefined → 显示 `null` / 空

这一类值不试图在画布上展开——画布是结构图，不是 JSON viewer。
想看对象内容，hover tooltip 或 panel 详情。

### 5.4 长字符串截断

所有超长文本走 `truncateText(ctx, text, maxW)`：宽度超过可用区时，逐字符砍尾加 `…`。
应用范围：主标题、副标题、属性 key、属性 value、端口名。

### 5.5 属性数上限

- medium：最多 4 行 + `… +N` 提示行（提示有更多但不在画布展开）
- full：最多 6 行 + `… +N`（debug 模式给点宽限）

属性数超过上限不直接静默截断——`… +N` 让用户知道"还有"，主动切 panel 看完整列表。

---

## 6. Hover Tooltip

### 6.1 节点 hover

显示 `wrapInstance.description`（优先 inst.attrs.description 回退 cls.description）。已有逻辑（`updateTooltip()`），保留。

为什么 description 默认走 hover 而不是画在节点上？因为同一张图里同 class 的多个节点
共享同一段 description，画在每个节点上是冗余；用户需要时悬停即可。

### 6.2 边 hover

显示 `edge.description`（来自源 class 的 `static edges` 里那条边的 description）。
新增逻辑：在 `input.js` 的鼠标移动检测里加边的 hit 区判定，设置 `state.hoverEdge`，
`updateTooltip()` 渲染时优先显示边描述。

### 6.3 Tooltip 优先级

边 hover > 节点 hover（边更细更难命中，命中时优先展示）。

---

## 7. 不做什么（避免的范围）

- **不在 minimal 圆形里画属性**。圆形几何不适合多行排版。
- **不在画布上画边标签**。三档统一移除。边的语义靠 hover。
- **不显示引用槽作为属性行**。引用槽是边信息，和边的存在性合取绑定。
- **不让 description 在 minimal / medium 上画布出现**。minimal 圆形塞不下；
  medium 是工作模式，画布上多一行就少一行属性。
- **不做"展开对象/数组"的内联 JSON 显示**。画布不是 JSON viewer。
- **不重新引入边方向标记的额外装饰**（除了已有的箭头）。边的方向靠箭头表达，足够。

---

## 8. 与现有代码的差异（实施清单）

实施时需要改：

- `src/utils.js`：
  - 新增 `formatScalar(v)` —— 数字精度 + 对象/数组折叠统一入口
  - `getNodeH` / `getNodeRect` 适配 minimal 圆形（半径自适应，封顶 40）和 medium/full 矩形
  - 节点宽度上限从硬编码 480 改为 `min(视口世界宽 × 0.4, 600)`
- `src/renderer.js`：
  - 三档渲染分支重写（移除当前 medium ≈ full 的代码复用陷阱）
  - minimal 圆形：边几何用"源圆心 → 目标圆心 + 箭头画在目标圆周"
  - medium/full 圆角矩形：沿用端口到端口
  - 移除所有边标签代码
  - full 节点矩形内底部新增 description 行
- `src/input.js`：
  - 鼠标移动加边 hit 区检测，设置 `state.hoverEdge`
  - `updateTooltip()` 优先渲染 `hoverEdge.description`
- `src/renderer.js` 的 `updateTooltip()`：
  - 处理 `state.hoverEdge` 的 tooltip 文本

不改：

- panel.js（属性编辑不变）
- io.js / codegraph.js（数据模型不变）
- 端口 hit 区（hit 端口和 hit 边分开判定，互不干扰）
