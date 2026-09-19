# ADR 索引

> ADR = Architecture Decision Record。记录**重大架构决策**——为什么这么选、被拒方案是什么、为什么不选。
> 详见单条模板和示例:`adr-template.md`(在 init-project-docs skill 目录)。

## 为什么写 ADR

文档是人和 AI 的"共享内存"。代码能告诉你**怎么实现**,
但只有 ADR 能告诉你**为什么不换一种实现**——尤其是被拒的方案。

一年后(或者下一个 AI 协作 session),有人提"为什么不换成 X"时,
ADR 是挡回重复提议的唯一挡箭牌。

## 格式约定

每条 ADR 是一个独立 markdown 文件,文件名:`adr-XXX-[短描述].md`。

- `XXX` 是递增编号(001, 002, ...)
- 短描述用英文 kebab-case

每条 ADR 含 5 段:

1. **状态**(proposed / accepted / deprecated / superseded by ADR-YYY)
2. **背景**(为什么需要决策,当时的约束)
3. **考虑过的方案**(包括被拒的,被拒理由是核心)
4. **选择**(选了哪个,为什么,取舍了什么)
5. **后果**(正面 / 负面 / 需要跟进的)

## 索引

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [ADR-007](adr-007-author-snapshot-layer.md) | 编辑快照层(演化值不自动固化) | accepted | 2026-09-19 |
| [ADR-006](adr-006-probe-edges-l1.md) | 双层边(探测边)L1 | accepted | 2026-09-15 |
| [ADR-005](adr-005-execution-observation.md) | 执行观测立柱(推翻"step 不激活") | accepted / MVP 已实现 | 2026-09-14 |
| [ADR-004](adr-004-unicode-identifiers.md) | 中文/Unicode 标识符支持(回溯补记) | accepted | 2026-09-14 |
| [ADR-003](adr-003-edge-transform-expressions.md) | 边级 transform 表达式 | accepted | 2026-06-24 |
| [ADR-001](adr-001-instance-level-edges.md) | 边模型从 class 级迁到实例级 | accepted | 2026-06-18 |
| [ADR-002](adr-002-dual-mode-editing.md) | 双模式编辑(UI / Code) | accepted | 2026-06-15 |

## 何时写新 ADR

- 重大架构转向(模型迁移、技术栈变更、核心抽象重写)
- 多个可行方案,讨论后选了一个,其他被拒
- 跟用户讨论得出的设计哲学,需要挡未来的重复提议
- 不写:实现细节、bug fix、小重构

**铁律:决策当下就写。** 事后补 90% 会丢。
