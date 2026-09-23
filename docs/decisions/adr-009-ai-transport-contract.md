# ADR-009 AI 传输契约:代码块主通道,URL 降级可选

- 状态:accepted
- 日期:2026-09-19
- 关联:ADR-008(执行闸门,本契约的粘贴入口依赖它);`src/llms.txt`(被本 ADR 重写)

## [是什么] 背景

现状契约(llms.txt)要求 AI 把 sourceCode 经 `btoa(encodeURIComponent(str))` 编码为 URL 输出;用户编辑后回传 URL,AI 从消息文本取 fragment 解码。论证后确认三处结构性脆弱:

1. **AI 侧编码不可靠**:这是字节级三步算法(中文先 UTF-8 → 百分号编码 → 再 base64)。LLM 没有内部 `btoa`,只能逐字符模式补全;长串错误率随长度累积,且**错误不可自检、不可恢复**(一个字符错,JSON 解析报废)。编码可靠性 = f(模型能力 × 图大小),而契约没有降级路径
2. **压缩与 AI 可编码性互斥**:Mermaid Live 能用 pako 压缩 URL,是因为**编辑器**负责编码、AI 只输出 Mermaid 文本。本工具流程里 AI 就是编码器——压缩后 AI 必须实现 deflate,契约复杂度陡增;对无代码执行的模型直接不可解
3. **成本与语义错位**:base64 对 tokenizer 是低信息密度串,每轮全量搬运比源码本身更贵;用户回传的 URL 含 visualState(positions),是往返最长一环。另外 HTTP 请求不携带 fragment——AI 若去 fetch 用户给的 URL,只能拿到空壳

## [为什么] 决策

### 1. 主通道:sourceCode 代码块(围栏)

- 契约改为**默认输出 sourceCode 代码块**,由用户粘贴导入
- 工具新增**"粘贴源码…"模态**:textarea + 载入;载入走 `importSource`(自动过 ADR-008 闸门)
- 智能剥离:粘贴物是围栏代码块时自动去围栏、忽略 `sa-edit` 标记行——用户从聊天复制整块直接粘,零手工清理

### 2. 快路径:URL 可选

- 仅当编码后 **< 约 4000 字符**且模型能可靠编码时,AI 才附加 URL(一键打开)
- "分享链接"(人类↔人类)保持现状(含 visualState,可书签、可传阅),与 AI 往返解耦

### 3. 版本标记

- 代码块首行注释:`// sa-edit: <时间戳>`——由"复制给 AI"生成,不存进源码本身
- 契约要求 AI **回显所依据的标记**(如"基于 sa-edit: 1758… 修改"),让双方能发现版本发散
- 粘贴导入容忍并剥离标记行

### 4. 工具新增"复制给 AI"

- 输出 = 围栏代码块(首行 `// sa-edit` 标记 + 当前作者态 sourceCode),写剪贴板
- 与"分享链接"职责分离:一个是给 AI 的文本,一个是给人的 URL

### 5. 契约新增三条

- "不要 fetch 用户给的 URL——服务器看不到 # 之后的内容,从消息文本取 fragment 解码"
- "含方法体的图在用户侧载入时会看到执行确认——这是预期,不是错误"(与 ADR-008 对齐)
- "回传格式:代码块 + sa-edit 标记"

### 6. 实验协议(不阻塞)

- 3 个 fixture(小图 / 中图 + transform / 中文重图)内嵌本 ADR 可直接复制;指令模板 + 判定表(URL 可用 / 编码错 / 截断 / 正确降级为代码块)
- 用户拿 2-3 个 AI 各跑一轮,结果记入下方"待验证"节——只影响阈值建议与叙事,不影响"代码块永远可行"的结论

## 被拒方案

- **照抄 Mermaid Live 的 pako 压缩**:见背景第 2 条——本工具 AI 是编码器,压缩与可编码性互斥
- **URL 为主 + 降级提示**:编码可靠性问题未解决,只是把失败转嫁给用户
- **先跑实验再定主次**:实验只影响阈值建议与叙事;代码块通道在任何实验结果下都成立,不值得阻塞
- **瘦身/压缩分享 URL**:URL 降级为快路径后收益变小,后置
- **MCP wrapper**:AI 工具发现的另一条路线,属独立议题,后置

## 影响面

- `src/llms.txt`:重写"你的核心任务"段;URL 编码段降级为附录;新增三条契约;`sa-edit` 说明
- 新 UI:`modal.js` 系粘贴导入模态;菜单"复制给 AI";围栏/标记剥离 helper
- 测试:`test-roundtrip` 剥离单测(边界:块内字符串含 ``` 不误剥);`test-e2e`(粘贴导入声明式静默 / 程序化弹确认、复制给 AI 内容断言、菜单项存在)
- 文档:`README.md`(快速开始提代码块通道)、`CLAUDE.md`(ADR 列表)、`docs/architecture.md`、`CHANGELOG.md`

## [不变量]

31. **AI↔人往返的主通道是 sourceCode 文本(代码块)**:URL 是可选快路径与人类分享载体,不是唯一通道。
32. **"复制给 AI"输出的代码块首行必须是 `// sa-edit: <时间戳>`;粘贴导入必须容忍并剥离围栏与标记行**(标记不参与源码语义)。

## 待验证(实验协议)

> 用户拿 2-3 个 AI(有/无代码执行各一)各跑一轮后补记。判定表:URL 可打开 / 编码错误 / 被聊天客户端截断 / 正确降级为代码块。

**跑法(每轮 ~3 分钟):**

1. 新开一轮对话,把 `src/llms.txt` 全文作为工具说明书贴给 AI(或让它 fetch 部署地址的 `/llms.txt`)
2. 给需求:"用下面的代码生成一张图,按说明书给我链接;链接打不开就给我代码块" + 粘贴一个 fixture
3. 打开链接验证:能打开 / 编码错乱 / 被客户端截断 / AI 主动降级给了代码块
4. 一行结果填进文末"结果记录"表(2-3 个 AI 各一轮即可)

fixture A(小图,纯声明):

```js
class Sensor {
  description = '采集数据'
  name = '传感器'
  attrs = { value: 0 }
}
const Sensor_1 = GraphStarter.add(Sensor, 'Sensor_1')
```

fixture B(中图 + transform):

```js
class Source {
  description = '数据源'
  name = '数据源'
  attrs = { out: 10 }
}
class Sink {
  description = '处理并输出'
  name = '处理器'
  attrs = { in: 0, doubled: 0 }
}
const Source_1 = GraphStarter.add(Source, 'Source_1')
const Sink_1 = GraphStarter.add(Sink, 'Sink_1')
Source_1.edges = [{ target: Sink_1, description: '主数据流', transform: "target['in'] = source['out']\ntarget['doubled'] = target['in'] * 2" }]
```

fixture C(中文重图,中文 key):直接用 `examples/frostpunk2_resources.js`(冰汽时代 2 资源循环,8 实例 + 中文 key + transform)。

### 结果记录

| AI(模型/入口) | 代码块可用 | URL 结果 | 备注 |
|---|---|---|---|
| (待填) | | | |
