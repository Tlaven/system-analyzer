// v0.9 核心引擎单元测试（无浏览器）
// 测试 splitSource / runSource / serializeCode / resetRuntime
// 模型：3 个实例级 class field（description / name / attrs），edges 是实例级 attrs.edges 数组
import { splitSource } from '../src/parser.js'
import { runSource, serializeCode, resetRuntime } from '../src/codegraph.js'
import { DEFAULT_BOOTSTRAP } from '../src/bootstrap.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail, null, 2) : '') }
}

function makeState() {
  return {
    sourceCode: DEFAULT_BOOTSTRAP,
    runtimeInstances: [],
    classes: {},
  }
}

// v0.9 测试用 sourceCode（无 class.edges，边在实例级 attrs.edges）
const V09_SAMPLE = `class Source {
  description = "数据源"
  name = "数据源"
  attrs = {
    rate: 1,
    value: 0
  }
}

class Processor {
  description = "处理器"
  name = "处理器"
  attrs = {
    factor: 2,
    input: 0
  }
}

class Database {
  description = "数据库"
  name = "数据库"
  attrs = {
    input: 0
  }
}

const Source_1 = GraphStarter.add(Source)
const Processor_1 = GraphStarter.add(Processor)
const Database_1 = GraphStarter.add(Database)
Source_1.edges = [
  { target: Processor_1, description: '数据流向下游' }
]
Processor_1.edges = [
  { target: Database_1, description: '处理结果写入下游' }
]
Source_1.rate = 5`

// ============================================================
console.log('\n=== 区 1：splitSource 切分 ===')
{
  const { classes, bootstrap } = splitSource(V09_SAMPLE)
  check('切出 3 个 class', classes.length === 3, classes.map(c => c.name))
  check('class 名按顺序: Source/Processor/Database',
    classes.map(c => c.name).join(',') === 'Source,Processor,Database',
    classes.map(c => c.name))
  check('bootstrap 段不含 class 关键字', !bootstrap.includes('class Source'), bootstrap)
  check('bootstrap 段含 GraphStarter.add', bootstrap.includes('GraphStarter.add'), bootstrap)
  check('bootstrap 段含 edges 数组赋值', bootstrap.includes('Source_1.edges = '), bootstrap)
  check('bootstrap 段含 override', bootstrap.includes('Source_1.rate = 5'), bootstrap)
}

// ============================================================
console.log('\n=== 区 2：runSource 执行 v0.9 sample ===')
{
  const state = makeState()
  state.sourceCode = V09_SAMPLE
  runSource(state.sourceCode, state)

  check('runtimeInstances 3 个', state.runtimeInstances.length === 3, state.runtimeInstances.length)
  check('classes 3 个', Object.keys(state.classes).length === 3, Object.keys(state.classes))

  const s1 = state.runtimeInstances[0]
  const p1 = state.runtimeInstances[1]
  const d1 = state.runtimeInstances[2]

  check('varName 自动生成: Source_1/Processor_1/Database_1',
    [s1.varName, p1.varName, d1.varName].join(',') === 'Source_1,Processor_1,Database_1',
    [s1.varName, p1.varName, d1.varName])
  check('className 正确',
    [s1.className, p1.className, d1.className].join(',') === 'Source,Processor,Database',
    [s1.className, p1.className, d1.className])

  check('Source class 默认 rate=1（在 attrs 里）', state.classes.Source.attrs.rate === 1, state.classes.Source.attrs.rate)
  check('Source_1.attrs.rate 被 override 成 5', s1.attrs.rate === 5, s1.attrs.rate)
  check('Processor.factor 默认 2', p1.attrs.factor === 2, p1.attrs.factor)
  check('Database.input 默认 0', d1.attrs.input === 0, d1.attrs.input)

  check('Source.description 注册到 classes',
    state.classes.Source.description === '数据源',
    state.classes.Source.description)
  check('Source.name 注册到 classes',
    state.classes.Source.name === '数据源',
    state.classes.Source.name)
}

// ============================================================
console.log('\n=== 区 3：实例级 attrs.edges 解析 ===')
{
  const state = makeState()
  state.sourceCode = V09_SAMPLE
  runSource(state.sourceCode, state)

  const s1 = state.runtimeInstances[0]
  const p1 = state.runtimeInstances[1]
  const d1 = state.runtimeInstances[2]

  check('Source_1.attrs.edges 是数组',
    Array.isArray(s1.attrs.edges) && s1.attrs.edges.length === 1,
    s1.attrs.edges)
  check('Source_1.attrs.edges[0].target 指向 Processor_1.attrs',
    s1.attrs.edges[0].target === p1.attrs,
    s1.attrs.edges[0].target)
  check('Source_1.attrs.edges[0].description 正确',
    s1.attrs.edges[0].description === '数据流向下游',
    s1.attrs.edges[0].description)
  check('Processor_1.attrs.edges[0].target 指向 Database_1.attrs',
    p1.attrs.edges[0].target === d1.attrs,
    p1.attrs.edges[0].target)
  check('Database_1.attrs.edges 不存在（无出边）',
    !Array.isArray(d1.attrs.edges) || d1.attrs.edges.length === 0,
    d1.attrs.edges)
}

// ============================================================
console.log('\n=== 区 4：varName 自动生成（含计数） ===')
{
  const src = `class A {
  description = ''
  attrs = { v: 0 }
}

const a1 = GraphStarter.add(A)
const a2 = GraphStarter.add(A)
const a3 = GraphStarter.add(A)`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)
  check('同 class 多次 add 计数正确',
    state.runtimeInstances.map(i => i.varName).join(',') === 'A_1,A_2,A_3',
    state.runtimeInstances.map(i => i.varName))
}

// ============================================================
console.log('\n=== 区 5：varName 显式命名 ===')
{
  const src = `class A {
  description = ''
  attrs = { v: 0 }
}

const foo = GraphStarter.add(A, 'foo')
const bar = GraphStarter.add(A, 'bar')`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)
  check('显式 name 参数覆盖自动名',
    state.runtimeInstances.map(i => i.varName).join(',') === 'foo,bar',
    state.runtimeInstances.map(i => i.varName))
}

// ============================================================
console.log('\n=== 区 6：varName 支持非字面 const（for/数组）===')
{
  const src = `class A {
  description = ''
  attrs = { v: 0 }
}

const all = []
let prev = null
for (let i = 0; i < 3; i++) {
  const node = GraphStarter.add(A)
  if (prev) prev.edges = [{ target: node, description: '' }]
  prev = node
  all.push(node)
}`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)
  check('for 循环里 add 也能拿到自动 varName',
    state.runtimeInstances.length === 3,
    state.runtimeInstances.length)
  check('自动 varName 顺序正确',
    state.runtimeInstances.map(i => i.varName).join(',') === 'A_1,A_2,A_3',
    state.runtimeInstances.map(i => i.varName))
  check('for 循环里的 edges 赋值也生效',
    Array.isArray(state.runtimeInstances[0].attrs.edges) &&
    state.runtimeInstances[0].attrs.edges[0].target === state.runtimeInstances[1].attrs &&
    Array.isArray(state.runtimeInstances[1].attrs.edges) &&
    state.runtimeInstances[1].attrs.edges[0].target === state.runtimeInstances[2].attrs,
    '链式 edges 应该建立')
}

// ============================================================
console.log('\n=== 区 7：实例 attrs 追加 class 没有的字段（v0.8 关键能力保留）===')
{
  const src = `class A {
  description = ''
  attrs = { v: 0 }
}

const A_1 = GraphStarter.add(A)
A_1.extraField = 'hello'
A_1.v = 99`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)
  check('实例追加的 extraField 保留',
    state.runtimeInstances[0].attrs.extraField === 'hello',
    state.runtimeInstances[0].attrs.extraField)
  check('实例 override 的 v=99 保留',
    state.runtimeInstances[0].attrs.v === 99,
    state.runtimeInstances[0].attrs.v)
  check('class attrs 不含 extraField（追加只进实例）',
    !('extraField' in state.classes.A.attrs),
    state.classes.A.attrs)
}

// ============================================================
console.log('\n=== 区 8：serializeCode 反向构建（round-trip）===')
{
  const state = makeState()
  state.sourceCode = V09_SAMPLE
  runSource(state.sourceCode, state)

  const serialized = serializeCode(state)

  // 重新跑一遍
  const state2 = makeState()
  state2.sourceCode = serialized
  runSource(state2.sourceCode, state2)

  check('round-trip 后实例数相同',
    state.runtimeInstances.length === state2.runtimeInstances.length,
    [state.runtimeInstances.length, state2.runtimeInstances.length])

  check('round-trip 后 varName 一致',
    state.runtimeInstances.every((inst, i) => inst.varName === state2.runtimeInstances[i].varName),
    state2.runtimeInstances.map(i => i.varName))

  check('round-trip 后 className 一致',
    state.runtimeInstances.every((inst, i) => inst.className === state2.runtimeInstances[i].className),
    state2.runtimeInstances.map(i => i.className))

  check('round-trip 后 edges 关系保持',
    Array.isArray(state2.runtimeInstances[0].attrs.edges) &&
    state2.runtimeInstances[0].attrs.edges[0].target === state2.runtimeInstances[1].attrs,
    'Source_1.edges[0].target 应该 === Processor_1.attrs')

  check('serializeCode 输出 class field（非 static）',
    /^\s*description\s*=/m.test(serialized) && !/static\s+description/.test(serialized), serialized)
  check('serializeCode 不输出 constructor',
    !/constructor\s*\(/.test(serialized), serialized)
  check('serializeCode 输出 attrs 字段',
    /^\s*attrs\s*=\s*\{/m.test(serialized), serialized)
  check('serializeCode 不输出 class.edges 字段',
    !/^\s*edges\s*=\s*\[/m.test(serialized), serialized)
  check('serializeCode 输出 override',
    /Source_1\.rate\s*=\s*5/.test(serialized), serialized)
  check('serializeCode 输出实例 edges 数组',
    /Source_1\.edges\s*=\s*\[/.test(serialized), serialized)
}

// ============================================================
console.log('\n=== 区 9：override 决策（class 默认永远保留）===')
{
  const state = makeState()
  state.sourceCode = V09_SAMPLE
  runSource(state.sourceCode, state)

  // 改 Source_1.rate = 99（新 override）
  state.runtimeInstances[0].attrs.rate = 99

  const serialized = serializeCode(state)

  check('override 出现在启动段', /Source_1\.rate\s*=\s*99/.test(serialized), serialized)
  check('class 默认值 rate: 1 仍保留（在 attrs 字典里）', /rate:\s*1/.test(serialized), serialized)

  // 改回默认值，override 应消失
  state.runtimeInstances[0].attrs.rate = 1
  const serialized2 = serializeCode(state)
  check('改回默认值后 override 消失', !/Source_1\.rate\s*=/.test(serialized2), serialized2)
}

// ============================================================
console.log('\n=== 区 10：实例级 description 序列化 ===')
{
  const src = `class X {
  description = 'class 默认描述'
  attrs = {}
}

const X_1 = GraphStarter.add(X)
X_1.description = '实例级描述'`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)

  check('实例级 description 写入 attrs',
    state.runtimeInstances[0].attrs.description === '实例级描述',
    state.runtimeInstances[0].attrs.description)
  check('class 默认 description 保留',
    state.classes.X.description === 'class 默认描述',
    state.classes.X.description)

  const serialized = serializeCode(state)
  check('实例级 description 出现在启动段',
    /X_1\.description\s*=\s*'实例级描述'/.test(serialized), serialized)
  check('class 默认 description 仍在 class 段',
    /description\s*=\s*'class 默认描述'/.test(serialized), serialized)
}

// ============================================================
console.log('\n=== 区 11：resetRuntime 丢弃运行时 mutation ===')
{
  const state = makeState()
  state.sourceCode = V09_SAMPLE
  runSource(state.sourceCode, state)

  // 运行时 mutation
  state.runtimeInstances[0].attrs.value = 999
  state.runtimeInstances[1].attrs.input = 888

  check('mutation 写入', state.runtimeInstances[0].attrs.value === 999, state.runtimeInstances[0].attrs.value)

  // reset
  resetRuntime(state)

  check('reset 后 value 回到默认 0', state.runtimeInstances[0].attrs.value === 0, state.runtimeInstances[0].attrs.value)
  check('reset 后 input 回到默认 0', state.runtimeInstances[1].attrs.input === 0, state.runtimeInstances[1].attrs.input)
  check('reset 后 edges 关系保持',
    Array.isArray(state.runtimeInstances[0].attrs.edges) &&
    state.runtimeInstances[0].attrs.edges[0].target === state.runtimeInstances[1].attrs,
    state.runtimeInstances[0].attrs.edges)
  // Source_1.rate = 5 来自 sourceCode，reset 后应保留
  check('reset 后启动段 override 保留', state.runtimeInstances[0].attrs.rate === 5, state.runtimeInstances[0].attrs.rate)
}

// ============================================================
console.log('\n=== 区 12：空 sourceCode 容忍 ===')
{
  const state = makeState()
  state.sourceCode = ''
  runSource(state.sourceCode, state)
  check('空 sourceCode → runtimeInstances 空', state.runtimeInstances.length === 0, state.runtimeInstances.length)
  check('空 sourceCode → classes 空', Object.keys(state.classes).length === 0, Object.keys(state.classes))

  const serialized = serializeCode(state)
  check('空 state serializeCode → 空字符串', serialized === '', JSON.stringify(serialized))
}

// ============================================================
console.log('\n=== 区 13：多边支持（同源多目标 / 同源同目标）===')
{
  const src = `class Source {
  description = ''
  attrs = { rate: 1 }
}

class Mid {
  description = ''
  attrs = {}
}

class Sink {
  description = ''
  attrs = {}
}

const Source_1 = GraphStarter.add(Source)
const Mid_1 = GraphStarter.add(Mid)
const Sink_1 = GraphStarter.add(Sink)
Source_1.edges = [
  { target: Mid_1, description: '到 Mid' },
  { target: Sink_1, description: '直奔 Sink' },
  { target: Mid_1, description: '再到 Mid（多边同目标）' }
]`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)

  check('Source_1.attrs.edges 有 3 条',
    Array.isArray(state.runtimeInstances[0].attrs.edges) &&
    state.runtimeInstances[0].attrs.edges.length === 3,
    state.runtimeInstances[0].attrs.edges)
  check('edge[0].target === Mid_1.attrs',
    state.runtimeInstances[0].attrs.edges[0].target === state.runtimeInstances[1].attrs)
  check('edge[1].target === Sink_1.attrs',
    state.runtimeInstances[0].attrs.edges[1].target === state.runtimeInstances[2].attrs)
  check('edge[2].target === Mid_1.attrs（同目标多边）',
    state.runtimeInstances[0].attrs.edges[2].target === state.runtimeInstances[1].attrs)
  check('每条边有独立 description',
    state.runtimeInstances[0].attrs.edges.map(e => e.description).join('|') === '到 Mid|直奔 Sink|再到 Mid（多边同目标）',
    state.runtimeInstances[0].attrs.edges.map(e => e.description))

  // round-trip 验证
  const serialized = serializeCode(state)
  const state2 = makeState()
  state2.sourceCode = serialized
  runSource(state2.sourceCode, state2)
  check('round-trip 后 3 条边都保留',
    Array.isArray(state2.runtimeInstances[0].attrs.edges) &&
    state2.runtimeInstances[0].attrs.edges.length === 3,
    state2.runtimeInstances[0].attrs.edges)
}

// ============================================================
console.log('\n=== 区 14：class 默认 name 空时 serializeCode 省略 name 字段 ===')
{
  const src = `class X {
  description = '描述'
  attrs = {}
}

const X_1 = GraphStarter.add(X)`
  const state = makeState()
  state.sourceCode = src
  runSource(state.sourceCode, state)
  check('scanner 返回 name 空串', state.classes.X.name === '', state.classes.X.name)

  const serialized = serializeCode(state)
  check('serializeCode 不输出 name = "" 行（空时省略）',
    !/^\s*name\s*=\s*''/m.test(serialized), serialized)
  check('serializeCode 保留 description 行',
    /description\s*=\s*'描述'/.test(serialized), serialized)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
