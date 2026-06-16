// v0.6 核心引擎单元测试（无浏览器）
// 测试 splitSource / parseClass / runSource / serializeCode / resetRuntime
import { splitSource, parseClass } from '../src/parser.js'
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

// ============================================================
console.log('\n=== 区 1：splitSource 切分 ===')
{
  const { classes, bootstrap } = splitSource(DEFAULT_BOOTSTRAP)
  check('切出 4 个 class', classes.length === 4, classes.map(c => c.name))
  check('class 名按顺序: Source/Processor/Database/Sink',
    classes.map(c => c.name).join(',') === 'Source,Processor,Database,Sink',
    classes.map(c => c.name))
  check('bootstrap 段不含 class 关键字', !bootstrap.includes('class Source'), bootstrap)
  check('bootstrap 段含 GraphStarter.add', bootstrap.includes('GraphStarter.add'), bootstrap)
  check('bootstrap 段含引用赋值', bootstrap.includes('s1.target = p1'), bootstrap)
  check('bootstrap 段含 describe', bootstrap.includes('GraphStarter.describe'), bootstrap)
}

// ============================================================
console.log('\n=== 区 2：parseClass 解析 static description ===')
{
  const src = `class X {
    static description = "hello world"
    constructor() { this.foo = 1 }
  }`
  const result = parseClass(src)
  check('className=X', result.className === 'X', result.className)
  check('description="hello world"', result.description === 'hello world', result.description)
  // 注意：v0.6 不依赖 parseClass.properties（属性走 scanClass + new cls()），
  // parseClass 只用来拿 description + 后续可能的方法体注释

  // 测试模板字符串 description
  const src2 = `class Y {
    static description = \`多行
描述\`
  }`
  const r2 = parseClass(src2)
  check('模板字符串 description 支持多行', r2.description === '多行\n描述', r2.description)
}

// ============================================================
console.log('\n=== 区 3：runSource 执行 DEFAULT_BOOTSTRAP ===')
{
  const state = makeState()
  runSource(state.sourceCode, state)

  check('runtimeInstances 3 个', state.runtimeInstances.length === 3, state.runtimeInstances.length)
  check('classes 4 个', Object.keys(state.classes).length === 4, Object.keys(state.classes))

  const s1 = state.runtimeInstances[0]
  const p1 = state.runtimeInstances[1]
  const d1 = state.runtimeInstances[2]

  check('varName 按声明顺序: s1/p1/d1',
    [s1.varName, p1.varName, d1.varName].join(',') === 's1,p1,d1',
    [s1.varName, p1.varName, d1.varName])
  check('className 正确',
    [s1.className, p1.className, d1.className].join(',') === 'Source,Processor,Database',
    [s1.className, p1.className, d1.className])

  check('Source.rate 默认 1', s1.attrs.rate === 1, s1.attrs.rate)
  // s1.target 在 bootstrap 里被赋值为 p1，所以不是 null（"引用身份"区单独测）
  check('Processor.factor 默认 2', p1.attrs.factor === 2, p1.attrs.factor)
  check('Database.input 默认 0', d1.attrs.input === 0, d1.attrs.input)
  check('Database 没有 target 字段', !('target' in d1.attrs), Object.keys(d1.attrs))

  check('Source.description 注册到 classes',
    state.classes.Source.description === '数据源：按 rate 产生数据，推送到下游',
    state.classes.Source.description)

  check('emitters 正确识别',
    state.classes.Source.emitters.length === 1 &&
    state.classes.Source.emitters[0].ref === 'target' &&
    state.classes.Source.emitters[0].attr === 'input',
    state.classes.Source.emitters)
}

// ============================================================
console.log('\n=== 区 4：引用赋值与 attrs 身份 ===')
{
  const state = makeState()
  runSource(state.sourceCode, state)
  const s1 = state.runtimeInstances[0]
  const p1 = state.runtimeInstances[1]
  const d1 = state.runtimeInstances[2]

  check('s1.target === p1.attrs（身份比较）', s1.attrs.target === p1.attrs, s1.attrs.target)
  check('p1.target === d1.attrs（身份比较）', p1.attrs.target === d1.attrs, p1.attrs.target)

  // 模拟方法体执行：s1.process 调用时 this = s1.attrs
  // this.target.input = this.value
  s1.attrs.value = 42
  s1.attrs.target.input = s1.attrs.value
  check('方法体 this.X.Y = v 直接命中目标 attrs', p1.attrs.input === 42, p1.attrs.input)
}

// ============================================================
console.log('\n=== 区 5：describe 调用记录到 edgeMeta ===')
{
  const state = makeState()
  runSource(state.sourceCode, state)
  const s1 = state.runtimeInstances[0]
  const p1 = state.runtimeInstances[1]

  check('s1.edgeMeta.target 存在', !!s1.edgeMeta.target, s1.edgeMeta)
  check('s1.edgeMeta.target.description 正确',
    s1.edgeMeta.target.description === '源数据流向处理器',
    s1.edgeMeta.target)
  check('p1.edgeMeta.target 存在', !!p1.edgeMeta.target, p1.edgeMeta)
}

// ============================================================
console.log('\n=== 区 6：serializeCode round-trip ===')
{
  const state = makeState()
  runSource(state.sourceCode, state)

  // 不动任何东西，直接 serializeCode
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

  check('round-trip 后引用关系保持',
    state2.runtimeInstances[0].attrs.target === state2.runtimeInstances[1].attrs,
    's1.target 应该 === p1.attrs')

  check('round-trip 后 edgeMeta 保持',
    state2.runtimeInstances[0].edgeMeta.target?.description === '源数据流向处理器',
    state2.runtimeInstances[0].edgeMeta)
}

// ============================================================
console.log('\n=== 区 7：override 决策（class 默认永远保留）===')
{
  const state = makeState()
  runSource(state.sourceCode, state)

  // 改 s1.rate = 5（override）
  state.runtimeInstances[0].attrs.rate = 5

  const serialized = serializeCode(state)

  check('override 出现在启动段', /s1\.rate\s*=\s*5/.test(serialized), serialized)
  check('class 默认值 this.rate = 1 仍保留', /this\.rate\s*=\s*1/.test(serialized), serialized)

  // 改回默认值，override 应消失
  state.runtimeInstances[0].attrs.rate = 1
  const serialized2 = serializeCode(state)
  check('改回默认值后 override 消失', !/s1\.rate\s*=/.test(serialized2), serialized2)
}

// ============================================================
console.log('\n=== 区 8：resetRuntime 丢弃运行时 mutation ===')
{
  const state = makeState()
  runSource(state.sourceCode, state)

  // 运行时 mutation
  state.runtimeInstances[0].attrs.value = 999
  state.runtimeInstances[1].attrs.input = 888

  check('mutation 写入', state.runtimeInstances[0].attrs.value === 999, state.runtimeInstances[0].attrs.value)

  // reset
  resetRuntime(state)

  check('reset 后 value 回到默认 0', state.runtimeInstances[0].attrs.value === 0, state.runtimeInstances[0].attrs.value)
  check('reset 后 input 回到默认 0', state.runtimeInstances[1].attrs.input === 0, state.runtimeInstances[1].attrs.input)
  check('reset 后引用关系保持',
    state.runtimeInstances[0].attrs.target === state.runtimeInstances[1].attrs,
    state.runtimeInstances[0].attrs.target)
}

// ============================================================
console.log('\n=== 区 9：报错情况 ===')
{
  // varName 数不匹配
  const badCode = `class X { constructor() { this.v = 1 } }
const a = GraphStarter.add(X)
GraphStarter.add(X)`
  const state = makeState()
  state.sourceCode = badCode
  let threw = false
  try {
    runSource(state.sourceCode, state)
  } catch (e) {
    threw = true
  }
  check('varName 数 ≠ add 数时报错', threw, '应该 throw')

  // class 语法错误
  const badCode2 = `class X { constructor() { this.v = 1 } }`
  const state2 = makeState()
  state2.sourceCode = badCode2  // 没有 GraphStarter.add，runtimeInstances 应为空
  runSource(state2.sourceCode, state2)
  check('无启动代码则 runtimeInstances 空', state2.runtimeInstances.length === 0, state2.runtimeInstances.length)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
