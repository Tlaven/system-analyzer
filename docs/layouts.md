# 布局：节点位置算法

> 这是**布局层**的设计文档，承接 `visualization-modes.md`（渲染层）、与 `edge-routing.md`（路由层）并列。
> 讲：节点应该放在哪里，自动布局算法的设计取舍。
>
> 写给未来的我（或 AI 协作者），用来理解四种布局 + grid 新增的设计。

## 1. 三个感知（所有布局必须满足）

任何自动布局算法都要同时满足三个感知，缺一不可：

| 感知 | 含义 | 当前 v0.9 状态 |
|---|---|---|
| **拓扑感知** | 边的存在要影响节点位置（force 的吸引力、circular 的扇区排序、hierarchical 的层级）| hierarchical ✓ / force ✓ / circular ✗ |
| **方向感知** | 和全局 `layoutDirection`（LR/TB）联动——hierarchical 直接走主流向，force 给方向加权，circular 跳过（圆无方向）| 全缺 |
| **模式感知** | 节点尺寸按 `config.infoLevel` 算间距——minimal 紧凑、full 宽松，同一布局在不同模式下不能套同一组常数 | 全缺 |

当前 v0.9 三个自动布局只有第 1 点勉强做到（hierarchical/force 拓扑感知，circular 完全没有），第 2/3 点全缺——这就是"得重做"的本质。

---

## 2. 当前四种布局的硬伤（v0.9 实现现状）

实现位于 `src/physics.js`。位置真相源是 `state.visualState.positions[varName] = {x, y}`（`io.js` wrapInstance 的 x/y getter 穿透到这里），所以 `applyLayout` 直接 mutate `n.x/n.y` 等于改 positions。

### 2.1 manual（保留）

`applyLayout('manual')` 立即返回——不做任何位置计算，由用户拖拽定位。新节点由 `spreadUnpositioned()` 给网格初始位置（cols=`ceil(sqrt(n))`，spX=240, spY=110）。

**缺陷**：
- `spreadUnpositioned` 无连通分量感知——新节点按数组顺序铺排，破坏已有聚簇
- 网格间距不考虑节点实际尺寸（圆形半径可变、矩形宽度自适应到 600px）

**保留**：manual 是用户主权模式，不应被自动布局覆盖。仅微调 `spreadUnpositioned`。

### 2.2 force（力导向）

`applyLayout('force')` (`physics.js:132-137`)：

- **常量硬编码**：`rep=8000, att=0.005, damp=0.85`
- **迭代 200 次固定**——无退火、无收敛判定、无提前终止
- 斥力 `rep*dx/d²`，引力 `dx*att`（胡克线性）——**与实时物理 `stepPhysics` 的 `k²/d` 公式不一致**（两套独立常数）
- 循环内部 `deriveEdges()` 被调 200 次，每次都遍历全图重派生——巨大重复计算

**缺陷**：
- 迭代次数硬编码，大图根本没收敛；小图浪费
- 没有 Barnes-Hut 加速——`O(n²)` 配对，几十个节点就开始卡顿
- 没有同 class 聚类力——同 class 多实例的图，结果散得满图都是
- 没有边长约束，长边和短边混杂
- `damp` 全程 0.85 恒定——无退火冷却
- 与 `stepPhysics`（elastic 模式用的 `k=120*sqrt(n)`）参数体系不一致——同一个引擎两套常数

### 2.3 circular（圆形）

`applyLayout('circular')` (`physics.js:129-131`)：

- `cx=cw/2, cy=ch/2, rad=min(cw,ch)*0.3`
- 节点均分 `2π`，起点 `-π/2`（顶部）
- 直接 mutate `n.x/n.y`

**缺陷**：
- 纯按节点数组顺序排——**完全忽略拓扑**，有边的两节点可能落在圆的对径
- 没考虑节点尺寸——minimal 圆形 vs full 矩形需要完全不同的圆周间距
- 半径与节点数无关——10 个 vs 1000 个都 `*0.3`
- 这就是个"装饰性布局"，没有信息密度

### 2.4 hierarchical（层次）

`applyLayout('hierarchical')` (`physics.js:138-149`)，基于 Kahn 拓扑排序：

1. 入度 + 邻接表构建
2. Kahn BFS：`inDeg===0` 入队，`shift` 出队、邻接点 inDeg 减 1
3. 孤儿补底：拓扑未覆盖的节点（环上）追加到 `topo` 末尾
4. 分层：`lv[id] = max(lv[src]+1)` over 入边
5. 坐标：`spX=180, spY=80` 硬编码，每层水平居中，垂直 `y=60 + l*spY`

**缺陷**：
- **层内按 BFS 到达顺序排**——没有交叉最小化（Sugiyama 缺第 2/3/4 步：barycenter heuristic、交叉计数、坐标分配）
- **环上节点全被塞到 topo 末尾再赋 lv=0**——环成员全挤顶层
- **没处理反向边**——target 在 source 上游时，节点被迫跨多层
- **强制顶→下**——没有 LR/TB 切换（与端口方向无法联动）
- **spX=180, spY=80 硬编码**——full 矩形 600px 宽会直接重叠；spY=80 小于默认节点高度，层次会与下一层标题重叠
- 嵌套 `deriveEdges()`——每节点调一次，又一次 `O(n·m)`

### 2.5 性能瓶颈（所有布局共享）

- `deriveEdges()` (`io.js:28-58`) **每次调用全量重算**，无缓存
- 被 physics.js 在每帧（elastic 模式）和每次迭代（force 200 次、hierarchical 每节点）调用——核心瓶颈
- 反查 target 用 `runtimeInstances.find(i => i.attrs === refVal)`，O(n) 按对象身份匹配

**重做时必须配套加缓存层**：按 `runtimeInstances` 引用身份哈希失效，`runSource` 后清缓存。

---

## 3. 改造方向

### 3.1 force 重做

**核心改造**：

1. **退火冷却 + 迭代数自适应**：`iter = max(100, 30 * log(n))`，temperature schedule 从高温指数衰减
2. **同 class 聚类力**：每个 class 的 centroid 加额外引力，让同 class 实例靠近——这是"同 class 多实例"图的关键
3. **边长弹簧**：target length 按端口方向给（LR 模式水平斥力弱、垂直斥力强）
4. **方向加权**：和全局 `layoutDirection`（LR/TB）联动——主流向方向斥力弱、垂直方向斥力强
5. **参数体系统一**：和 `stepPhysics`（elastic 模式）共享 `k=120*sqrt(n)` 理想距离，不再两套常数
6. **Barnes-Hut 加速**（可选）：`O(n²)` → `O(n log n)`，支持百节点级图

**保留**：力导向的"自然感"——同 class 聚类后视觉上像分子结构，符合人眼对"群落"的直觉。

### 3.2 circular 重做

**核心改造**：

1. **拓扑感知排序**：用 Cuthill-McKee 算法（或类似的图遍历排序）让相邻节点在圆周上靠近——有边的两节点尽量在圆周邻位
2. **同 class 占连续扇区**：同 class 实例占圆周连续弧段，class 间按"类间连接密度"排外圈顺序
3. **节点尺寸感知**：圆周间距按 `getNodeRect` 实际尺寸算——minimal 紧凑（半径 22-40），full 宽松（矩形 600px）
4. **半径与节点数联动**：`rad = base + n * spacing`，避免 10 个 vs 1000 个都 `*0.3`

**定位调整**：circular 重做后是 **minimal 模式专用**——minimal 圆形 + 圆周布局天然契合（节点小、视觉密度低）。medium/full 不推荐这个布局（矩形 + 圆周排列浪费空间）。

### 3.3 hierarchical 重做

**核心改造**（Sugiyama 框架完整化）：

1. **反向边翻转**：检测环和反向边，临时翻转边的方向让图变 DAG，布局后再翻回
2. **层内 barycenter 排序**：每层节点按"相邻层连接的中位数"排序，迭代减少交叉
3. **交叉计数 + 迭代优化**：标准 Sugiyama 第 3 步——多次扫层、取交叉最少的排序
4. **方向切换**：支持 LR / TB——LR 时层在 x 轴、节点在 y 轴；TB 时层在 y 轴、节点在 x 轴
5. **层间距按节点实际尺寸**：`spX = max(getNodeRect(n).w) + gutter`、`spY = max(getNodeRect(n).h) + gutter`，避免 full 矩形重叠
6. **坐标分配**：Brandes-Köpf 或简单的"中位对齐"——让边的拐点对齐到层中点

**这是端口 LR/TB 的首选布局**——分层方向就是主流向，端口分配和层内排序复用同一份拓扑信息。

### 3.4 新增 grid（适合 minimal 鸟瞰）

**定位**：minimal 模式下 50+ 圆形节点时，力导向会乱、圆形太散、hierarchical 太深——grid 是唯一合适的。

**算法骨架**：
1. 同 class 占连续行——class A 占第 1-3 行，class B 占第 5-7 行（中间留空行作分隔）
2. 行内节点等距排列，列数按 `ceil(sqrt(count_per_class))` 自适应
3. 整体居中，class 间留 1-2 行空隙

**实现复用**：`spreadUnpositioned()` 加 class 感知就是 grid 的雏形——把当前的"全局 sqrt"改为"按 class 分组的 sqrt"。

**适用**：minimal 鸟瞰、大量同类实例（如游戏经济循环里 20 个 Building 实例）。

---

## 4. 不新增什么（减法哲学）

### 4.1 不新增 cluster / 分组布局

同 class 聚类力（force 重做里的）的效果等价于显式 cluster——视觉上同 class 节点聚在一起，但没有"组"这个**概念实体**（不进 attrs、不画组框、不能编辑组）。

引入 cluster 会增加：
- 数据模型：`attrs.group` 或类似的并行字段
- 渲染层：组框、组标题、组折叠
- 交互层：组拖拽、组选择、组编辑

这些都不符合 v0.9 的减法哲学。同 class 聚类力是"效果"而非"概念"——足够好。

### 4.2 不新增 incremental（增量布局）

加新节点时复用 `spreadUnpositioned()`（网格就近摆放）已经够好——单独做"增量布局"类型反而冗余。

如果用户想"加新节点后重新整理"，直接调 `applyLayout(currentLayout)` 即可（重做后会保留已有节点的相对位置，只调整布局参数）。

### 4.3 不新增 Sugiyama 之外的层次变体

不做 radix tree、不做 dendrogram、不做flow map——这些都是特殊场景布局，通用图编辑器不需要。Sugiyama + LR/TB 切换覆盖了 90% 的层次需求。

---

## 5. 与端口方向的联动

布局层和路由层的端口系统（详见 `edge-routing.md` §2.3）有强联动：

| 布局 | 与端口方向的联动 |
|---|---|
| **hierarchical** | **首选**——分层方向直接是主流向，端口 LR/TB 配合层方向 |
| **force** | 方向加权——主流向斥力弱，让节点沿主流向延展 |
| **circular** | 跳过——圆无方向，端口走几何驱动（§2.3 策略 B）|
| **grid** | 部分联动——class 间留空行可视为"层次"，但 class 内是无方向的 |
| **manual** | 不联动——用户主权，端口走几何驱动 |

**`config.layoutDirection`** 应该是全局配置（不入 attrs），影响 hierarchical 的层方向、force 的方向加权、端口的"侧"选择。

---

## 6. 落地次序

按收益 / 复杂度 / 依赖关系排：

1. **hierarchical 优先**——和端口方向、orthogonal 布线契合度最高，改造收益最大。Sugiyama 是教科书算法，落地稳。**与端口化可以一起做**——端口分配的"半固定 (source, target) 分组"和 Sugiyama 的层内排序复用同一份拓扑信息，调一次 `deriveEdges()` 就够。

2. **force 重做**——参数化（统一 `k=120*sqrt(n)`）+ 退火 + 同 class 聚类力。中等复杂度。

3. **circular 重做**——Cuthill-McKee 拓扑排序 + 同 class 扇区。简单算法，主要工作是排序逻辑。

4. **grid 新增**——`spreadUnpositioned` 的 class 感知版本，工作量小，可以和 circular 并行做。

5. **配套基础设施**（贯穿所有重做）：
   - `deriveEdges` 缓存层（按 runtimeInstances 引用身份哈希失效）
   - `getNodeRect` 模式感知间距（所有布局共用）
   - `config.layoutDirection` 全局配置（hierarchical/force 联动）

---

## 7. 不做什么

- **不新增 cluster / 分组布局**——同 class 聚类力等价，避免引入"组"概念
- **不新增 incremental 布局类型**——`spreadUnpositioned` 已够
- **不新增 Sugiyama 之外的层次变体**（radix tree / dendrogram / flow map）——通用图编辑器不需要
- **不让布局覆盖 manual**——manual 是用户主权，自动布局只在用户主动调用时跑一次
- **不让布局实时跑**（除了 elastic 模式）——一次性算完 + fitToView，避免节点持续漂移
- **不做布局参数的节点级 override**——所有布局参数都是全局，避免配置爆炸

---

## 8. 与其他层的关系

- **承接渲染层**（`docs/visualization-modes.md`）：节点的实际尺寸（圆形半径、矩形宽度）由渲染层的 `getNodeRect` / `getNodeH` 决定，布局层的间距必须感知这些尺寸。
- **承接路由层**（`docs/edge-routing.md`）：`layoutDirection` 全局配置同时影响布局（hierarchical 层方向、force 方向加权）和路由（端口的"侧"选择）。`deriveEdges` 是两层共享的拓扑信息源。
- **不耦合数据模型**：布局只改 `state.visualState.positions`，不改 sourceCode / attrs / edges schema。
