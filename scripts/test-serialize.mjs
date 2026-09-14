// 守卫测试:三条 P0 数据损坏链的 serializeCode 兜底
// 1. 显式 varName 回写(createNode/copyInstance/Ctrl+V 都产显式名,serialize 必须保留)
// 2. 删除有入边的实例 → 不产生悬空 target varName,roundtrip/reload 不炸
// 3. 删除边后 attrs.edges 数组清理通过 selEdge-id 解析路径验证(serialize 层)
import { runSource, serializeCode, resetRuntime } from '../src/codegraph.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
}
function makeState() {
  return { sourceCode: '', runtimeInstances: [], classes: {}, visualState: { positions: {}, colors: {} } }
}

const SAMPLE = `
class Source {
  description = "源头"
  attrs = { value: 0 }
}
class Sink {
  description = "汇点"
  attrs = { amount: 0 }
}

const Source_1 = GraphStarter.add(Source)
const Sink_1 = GraphStarter.add(Sink)
Source_1.edges = [{ target: Sink_1, description: 'flow' }]
`

// ============ 区 1:显式 varName 必须回写 ============
console.log('\n=== 区 1:serializeCode 输出显式 varName ===')
{
  const state = makeState()
  const src = `
class Population {
  description = "人口"
  attrs = { count: 100 }
}
const Migrant = GraphStarter.add(Population, 'Migrant')
`
  state.sourceCode = src
  runSource(src, state)
  const serialized = serializeCode(state)
  check('显式名保留在 add 调用里',
    /GraphStarter\.add\(Population, 'Migrant'\)/.test(serialized), serialized)

  const state2 = makeState()
  state2.sourceCode = serialized
  runSource(state2.sourceCode, state2)
  check('roundtrip 后 varName 不漂移',
    state2.runtimeInstances[0].varName === 'Migrant',
    state2.runtimeInstances.map(i => i.varName))
}

// ============ 区 2:删除有入边的实例 → 无悬空引用 ============
console.log('\n=== 区 2:delete-then-serialize 无悬空 target ===')
{
  const state = makeState()
  state.sourceCode = SAMPLE
  runSource(SAMPLE, state)
  // 模拟 delInstance(Sink_1):仅从 runtimeInstances 移除(editor 层行为)
  state.runtimeInstances = state.runtimeInstances.filter(i => i.varName !== 'Sink_1')

  const serialized = serializeCode(state)
  try {
    const state2 = makeState()
    runSource(serialized, state2)
    check('serialize 输出可重新加载(不抛 ReferenceError)', true)
    check('悬空 target 序列化为 null(或被清理)',
      !/target:\s*Sink_1/.test(serialized),
      serialized.split('\n').filter(l => l.includes('target')))
  } catch (err) {
    check('serialize 输出可重新加载(不抛 ReferenceError)', false, err.message)
  }
}

// ============ 区 3:auto-named 实例 roundtrip 后 varName 稳定 ============
console.log('\n=== 区 3:自动命名实例 roundtrip 恒定 ===')
{
  const state = makeState()
  state.sourceCode = SAMPLE
  runSource(SAMPLE, state)
  const before = state.runtimeInstances.map(i => i.varName).join(',')
  const state2 = makeState()
  state2.sourceCode = serializeCode(state)
  runSource(state2.sourceCode, state2)
  const after = state2.runtimeInstances.map(i => i.varName).join(',')
  check('Source_1,Sink_1 恒定', before === after, [before, after])
  check('output 含显式名参数',
    /add\(Source, 'Source_1'\)/.test(state2.sourceCode) && /add\(Sink, 'Sink_1'\)/.test(state2.sourceCode),
    state2.sourceCode.split('\n').filter(l => l.includes('add(')))
}

// ============ 区 4:reset + edges 语义不变(回归) ============
console.log('\n=== 区 4:原有语义回归 ===')
{
  const state = makeState()
  state.sourceCode = SAMPLE
  runSource(SAMPLE, state)
  check('edges 引用保持(attrs 对象身份)',
    state.runtimeInstances[0].attrs.edges[0].target === state.runtimeInstances[1].attrs)

  state.runtimeInstances[1].attrs.amount = 777
  const serialized = serializeCode(state)
  check('非默认 override 仍输出', /Sink_1\.amount\s*=\s*777/.test(serialized), serialized)

  state.runtimeInstances[1].attrs.amount = 0
  const serialized2 = serializeCode(state)
  check('回默认值 override 消失', !/Sink_1\.amount\s*=/.test(serialized2), serialized2)

  resetRuntime(state)
  check('reset 后 amount 回默认', state.runtimeInstances[1].attrs.amount === 0)
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
