# ADR-004: 中文/Unicode 标识符支持(回溯补记)

## 状态

accepted(决策实际发生在 v0.10,2026-09 回溯补记——按文档方法论"两套并存物必须有 ADR 解释区别,否则下一个人会删错一个"的规则立项)

## 背景

v0.9 立项时,CLAUDE.md 不变量 #21 写定"code identifiers are camelCase English"。但随之演化的功能事实上推翻了它,却没有走 ADR 流程:

1. **目标用户的语言是中文**——graph 是给中文用户可视化"系统"的,attr key 全中文(`总人数`、`需求量`),panel/画布都按字符串渲染中文 key;v0.12 transform autocomplete 中文候选。
2. v0.10 起 scanner/序列化链路实际支持中文 class 名与 varName(`codegraph.js` 的 Unicode 版 `isValidIdentifier` 用 `\p{L}` 允许中日韩字母)。
3. 结果是养出了**两套 `isValidIdentifier` 并存**:
   - `utils.js` ASCII 版(`/^[A-Za-z_$][\w$]*$/`)——UI 新建节点 modal 的 className/varName 校验
   - `codegraph.js` Unicode 版(`/^[$$_\p{L}][$_\p{L}\d]*$/u`)——serializeCode 序列化 key/检测字面量合法性

文件注释里解释了两者的区别,但没有 ADR,不变量 #21 也没修订——正文与事实矛盾(文档方法论 E1 定义的"尸体")。

## 考虑过的方案

### 方案 A: 收紧回 ASCII,禁止中文标识符(被拒)

- 优点:回归不变量 #21 原文,只需一份校验
- 缺点:attr key 已经全是中文且用户在用;强制翻译 key 违反"用户写的图是需求文档"的分工;scanner/llms.txt/教程全要改回
- **拒绝理由**:也就是说短暂涉足的特征已经广泛使用,回滚成本 > 差异管理成本

### 方案 B: 全部放开 Unicode,删除 utils ASCII 校验(被拒)

- 优点:单一真相一套校验
- 缺点:UI 新建入口放松后,用户可能在 modal 里输入中文 varName——把中文打进 bootstrap 的 `const` 名完全合法,但会让"graph 代码段 camelCase"的书写习惯消失、支持/debug 负担增加
- **拒绝理由**:UI 创建入口保守,民众 flow 更宽容——风险不对称,让保守校验留在"用户亲手打字"的入口

### 方案 C: 分层——创作入口 ASCII,序列化/运行层 Unicode 全支持(采纳)

- UI 新建节点 modal(className/varName)继续用 ASCII 校验
- 序列化(serializeCode)、Code 模式手写/导入、中文 attr key:Unicode 全支持
- 两套校验的分工由注释明确,不允许第三个实现出现

## 选择

选方案 C。

理由:事实上代码已经是这个形态(方案 C 是对现状的诚实承认+收口),改动只是把事实写成契约。中文 attr key 是刚需求的(用户的系统用中文描述),class/varName 对中文用户也自然。

**取舍**:两个入口校验宽松度不同会带来"Code 模式能叫中文类名但是 UI 新建不能"的轻微不一致,换得 UI 入口的保守性。若未来 trap 加重,合并方向是 UI 入口也放开(升格到方案 B),需再记一条。

## 后果

### 正面后果

- 序列化/序列化全链路对中文标识符透明,`target['总人数']` 的 bracket-access 约束(ADR-003)有了标识符层的对齐基础
- CLAUDE.md 不变量 #21 修订后,正文与代码不再矛盾

### 负面后果

- `isValidIdentifier` 双实现并存,新增"识别类标识符是否合法"逻辑时必须选对入口(选错会 UI 拒中文或序列化乱码)
- 变量行显示/搜索/自动命名(`suggestUniqueVarName`)都依赖 varName 字符串,中文名的 edge case(如输入法产生的全角字符)未被系统性测试

### 需要跟进的

- CLAUDE.md 不变量 #21 修订为分层说明(已完成,随本 ADR)
- 若要统一,或变更为方案 B,必须新 ADR 并收 utils/codegraph 两份校验

## 关联

- 上游:与 ADR-003 的 bracket-access 约束对齐("中文 key 能否点访问"的歧义由强制 bracket 消除)
- 下游:`utils.js` / `codegraph.js` 双份 `isValidIdentifier` 的存在依据;`scanner.js` 对非 ASCII class field 的容忍
