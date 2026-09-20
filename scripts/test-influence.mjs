// ADR-010 影响解析单元测试(无浏览器)
// 语义:声明边 u→v 正向影响;探测边 u⇢v 反向(v 影响 u);同对已有声明边时探测边不参与(差集)
import { state } from '../src/state.js'
import { runSource } from '../src/codegraph.js'
import { computeInfluence, influenceRows, invalidateInfluence } from '../src/influence.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
}
const sorted = (s) => [...s].sort().join(',')

const CHAIN = `class A { attrs = { v: 1 } }
class B { attrs = { v: 0 } }
class C { attrs = { v: 0 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
const C_1 = GraphStarter.add(C, 'C_1')
A_1.edges = [{ target: B_1, description: 'a→b' }]
B_1.edges = [{ target: C_1, description: 'b→c' }]`

console.log('\n测试 1:链式闭包(声明边正向)')
{
  runSource(CHAIN, state)
  const inf = computeInfluence(state, 'A_1', 'down')
  check('down(A_1) = B_1,C_1', sorted(inf.down) === 'B_1,C_1', sorted(inf.down))
  check('directDown(A_1) = B_1', sorted(inf.directDown) === 'B_1', sorted(inf.directDown))
  check('up(A_1) 为空', inf.up.size === 0, sorted(inf.up))
  const inf2 = computeInfluence(state, 'C_1', 'up')
  check('up(C_1) = A_1,B_1', sorted(inf2.up) === 'A_1,B_1', sorted(inf2.up))
  check('directUp(C_1) = B_1', sorted(inf2.directUp) === 'B_1', sorted(inf2.directUp))
}

console.log('\n测试 2:边参与状态')
{
  runSource(CHAIN, state)
  const down = computeInfluence(state, 'A_1', 'down')
  check('A→B 参与 down', down.edgeState.get('A_1>B_1>0') === 'down', [...down.edgeState])
  check('B→C 参与 down', down.edgeState.get('B_1>C_1>0') === 'down', [...down.edgeState])
  const up = computeInfluence(state, 'C_1', 'up')
  check('A→B 参与 up', up.edgeState.get('A_1>B_1>0') === 'up', [...up.edgeState])
}

console.log('\n测试 3:环终止与双向')
{
  const CYCLE = `class A { attrs = { v: 1 } }
class B { attrs = { v: 0 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
A_1.edges = [{ target: B_1 }]
B_1.edges = [{ target: A_1 }]`
  runSource(CYCLE, state)
  const inf = computeInfluence(state, 'A_1', 'both')
  check('环:down(A_1) = B_1', sorted(inf.down) === 'B_1', sorted(inf.down))
  check('环:up(A_1) = B_1', sorted(inf.up) === 'B_1', sorted(inf.up))
  check('环:边双向参与(edgeState=both)', inf.edgeState.get('A_1>B_1>0') === 'both', [...inf.edgeState])
}

console.log('\n测试 4:探测边反向(依赖方向)')
{
  const PROBE = `class A { attrs = { v: 1, ref: null } }
class B { attrs = { v: 2 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
A_1.ref = B_1`
  runSource(PROBE, state)
  const inf = computeInfluence(state, 'A_1', 'up')
  check('A 引用 B ⇒ up(A_1) 含 B_1', sorted(inf.up) === 'B_1', sorted(inf.up))
  const inf2 = computeInfluence(state, 'B_1', 'down')
  check('B 影响 A ⇒ down(B_1) 含 A_1', sorted(inf2.down) === 'A_1', sorted(inf2.down))
  check('探测边参与状态(probeState)', inf.probeState.get('A_1>B_1') === 'up', [...inf.probeState])
}

console.log('\n测试 5:差集口径(同对声明边压制探测边)')
{
  const BOTH = `class A { attrs = { v: 1, ref: null } }
class B { attrs = { v: 2 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
A_1.ref = B_1
A_1.edges = [{ target: B_1, description: '声明' }]`
  runSource(BOTH, state)
  const inf = computeInfluence(state, 'A_1', 'up')
  check('声明边压制探测边 ⇒ up(A_1) 为空', inf.up.size === 0, sorted(inf.up))
  const inf2 = computeInfluence(state, 'A_1', 'down')
  check('down(A_1) = B_1(仅声明方向)', sorted(inf2.down) === 'B_1', sorted(inf2.down))
  check('probeState 不含被压制的探测边', !inf.probeState.has('A_1>B_1'), [...inf.probeState])
}

console.log('\n测试 6:diamond 与直接/间接集合')
{
  const DIAMOND = `class A { attrs = { v: 1 } }
class B { attrs = { v: 0 } }
class C { attrs = { v: 0 } }
class D { attrs = { v: 0 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
const C_1 = GraphStarter.add(C, 'C_1')
const D_1 = GraphStarter.add(D, 'D_1')
A_1.edges = [{ target: B_1 }, { target: C_1 }]
B_1.edges = [{ target: D_1 }]
C_1.edges = [{ target: D_1 }]`
  runSource(DIAMOND, state)
  const inf = computeInfluence(state, 'A_1', 'down')
  check('down(A_1) = B_1,C_1,D_1', sorted(inf.down) === 'B_1,C_1,D_1', sorted(inf.down))
  check('directDown(A_1) = B_1,C_1', sorted(inf.directDown) === 'B_1,C_1', sorted(inf.directDown))
  const inf2 = computeInfluence(state, 'D_1', 'up')
  check('up(D_1) = A_1,B_1,C_1', sorted(inf2.up) === 'A_1,B_1,C_1', sorted(inf2.up))
}

console.log('\n测试 7:列表行数据(influenceRows)')
{
  runSource(CHAIN, state)
  const rows = influenceRows(state, 'A_1', 'down')
  check('down 行 = B_1 声明边', rows.length === 1 && rows[0].varName === 'B_1' && rows[0].kind === 'declared' && rows[0].description === 'a→b', rows)
  const upRows = influenceRows(state, 'C_1', 'up')
  check('up 行 = B_1 声明边', upRows.length === 1 && upRows[0].varName === 'B_1' && upRows[0].kind === 'declared', upRows)
  const PROBE2 = `class A { attrs = { v: 1, ref: null, box: { inner: null } } }
class B { attrs = { v: 2 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
A_1.ref = B_1
A_1.box.inner = B_1`
  runSource(PROBE2, state)
  const pRows = influenceRows(state, 'A_1', 'up')
  check('探测行含 fields(ref + box.inner)', pRows.length === 1 && pRows[0].kind === 'probe' && pRows[0].fields.includes('ref') && pRows[0].fields.includes('box.inner'), pRows)
}

console.log('\n测试 8:缓存身份与失效')
{
  runSource(CHAIN, state)
  const a = computeInfluence(state, 'A_1', 'down')
  const b = computeInfluence(state, 'A_1', 'down')
  check('缓存命中(同一结果对象)', a === b, { same: a === b })
  runSource(`class A { attrs = { v: 1 } }
class B { attrs = { v: 0 } }
const A_1 = GraphStarter.add(A, 'A_1')
const B_1 = GraphStarter.add(B, 'B_1')
A_1.edges = [{ target: B_1 }]
B_1.edges = [{ target: A_1 }]`, state)
  const c = computeInfluence(state, 'A_1', 'down')
  check('新图后缓存失效(边集变化)', c !== a && sorted(c.down) === 'B_1', { same: c === a })
  invalidateInfluence()
  const d = computeInfluence(state, 'A_1', 'down')
  check('手动失效后重算(新对象,结果一致)', d !== c && sorted(d.down) === 'B_1', { same: d === c })
}

console.log('\n测试 9:自引用不参与(探测边自环不记)')
{
  const SELF = `class A { attrs = { v: 1, self: null } }
const A_1 = GraphStarter.add(A, 'A_1')
A_1.self = A_1`
  runSource(SELF, state)
  const inf = computeInfluence(state, 'A_1', 'both')
  check('自引用:up/down 均空', inf.up.size === 0 && inf.down.size === 0, { up: sorted(inf.up), down: sorted(inf.down) })
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
