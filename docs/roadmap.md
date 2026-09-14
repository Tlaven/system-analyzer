# Roadmap — 方向型陈述的集中安置点

> 定位:项目所有"计划/方向/非当前事实"的陈述集中在这里(按文档方法论 E2:方向型不会变假,只会悬置——所以需要状态流转,done 移出,dropped 带理由升格 ADR)。
> 各 L2/L3 文档里保持**现状快照**,不承载方向;本文件是唯一的状态账本。

## 支柱图(项目身份的骨架)

```
支柱一(已立):  结构可视化   —— 画布三档 + 路由/布局/端口(渲染/路由/布局三层文档)
支柱一(已立):  语义可执行   —— sourceCode 即文档 + transform 轻量响应式(ADR-003)
支柱二(方向已定, MVP 未做): 执行观测 —— 时序记录 + 步进播放 + 环路标记(ADR-005)
正在酝酿:      运行时事实   —— 双层边(探测边), 与支柱二同哲学的两个入口之一
```

验收标准(什么时候"系统分析器"名副其实):用户不打开代码面板即可回答——
(1) 这个系统哪里有环/谁影响谁(解析) (2) 这个值过去怎样(观测) (3) 改了这个会怎样(干预)。

---

## A. 执行观测 MVP(ADR-005 三分件,planned)

### A1. 属性时序记录 — planned

- `state.traces`: 每 `varName.attr` → `{tick, value}[]`,环形缓冲上限 200
- 写入点:`stepAll()` 每 tick 结束(引擎已留 tickCount/execHistory 骨架)
- 显示:panel 属性行内嵌 mini sparkline(易失,reset 清空)
- **语义澄清**:propagate 是"同一时刻的因果重算"(不动时钟,不产生时间点);stepAll 才推进时间。trace 只记 stepAll。

### A2. 步进播放控制 — planned

- 执行模式 `step` 扩为三态:单步(现有)/ 连播(Play, 可暂停)/ 速度三档(慢/中/快)
- 连播 = `setInterval(stepAll, dt)`,画面同步;暂停即停,不复历史

### A3. 环路视觉标记 — planned

- 数据现成:topologicalSort 已标 `_topoError`(环内+下游成员)
- MVP:环成员间相互连接的边在画布上高亮(虚线 red);仅把"⚠ 错误文字"升级为"环路径可见"
- 显示通道计划(visualization-modes.md §10)的新增项属于同一批,一起排期

### 远期(本支柱,暂不排期)

- **干预/what-if**:锁定属性、参数对比复跑(现有 panel 手动改值已是 what-if 雏形,升级为正式概念再动)
- **影响解析**:沿边/transform 依赖回答"谁影响 X"(数据在 deriveEdges 里,等 UI 契想好)
- Web Worker 化(执行重计算场景实锤抽出后再议)

---

## B. 双层边(探测边) — planned(L1),L2 缓期

- **L1(推荐起点)**:探测边 = 每次 runSource/propagate/stepAll 后重新 derive 的**推而得之**——深度遍历 inst.attrs 字段值,命中另一实例 attrs(`__instId` 识别)记一条 `A→B`,访问集合防环,接 deriveEdges 同款 lazy cache
- 视觉:声明边(实线、可带标签)= 作者意图;探测边(虚线灰、field-path 作 label)、纯派生
- 差集有价值:探测有而声明无的引用 = 未声明的隐式依赖(AI 副作用无所遁形)
- **探测边不序列化**(派生层原则,与 visualState 同族)
- **L2(Proxy 化,真·赋值即图变)远期**:需要独立 ADR——破坏 attrs 恒等、touch 双身份系统,等 L1 跑通后评估
- 噪音治理方向(产品题,实现前拿到答案):同对多引用收敛+计数、外部辅助对象引用的过滤规则

---

## C. 显示通道扩展计划 — planned(详见 `docs/visualization-modes.md` §10)

5 新通道(transform 活性/方法体圆点/边 description/override 标记/执行脉冲)+ 2 假 affordance 清除。

注意 **与 A 的排序耦合**:通道 5"执行脉冲"应当在 A2(步进播放)之后做,否则脉冲没有触发者。

---

## Dropped / 已移出

(空——done 的条目在完成后从本文件移除,历史在 git)

---

## 原则约束(贯穿以上所有方向,违反需新 ADR)

1. **演化层原则**:所有观测/探测数据(traces、探测边、execHistory)不入 sourceCode、不入 URL hash——它们是运行时事实,不是作者意图
2. **防溢出原则**:观测 UI 优先住 panel/tooltip;画布新增显示仅限"三档均适用的小角标"(见 visualization-modes.md §10 表)
3. **零转换原则保留**:观测不得引入"编辑态→运行态"的 deploy 步骤——观测的对象就是眼前对象(文档=程序哲学的一部分)
