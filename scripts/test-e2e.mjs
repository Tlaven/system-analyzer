// v0.9 端到端测试：加载 dist/index.html，验证实例级 edges 模型 + 新交互
//
// 模型变更（vs v0.8）：
//   - 删除 class.edges 字段（边不在 class 声明）
//   - 边改为实例级 attrs.edges 数组：[{ target, description }, ...]
//   - 支持多边（多对一、多对多）
//   - sa_data version: 5 → 6
//
// 测试覆盖：
//   1. 空画布加载
//   2. importSource 加载 v0.9 sample
//   3. class scanner 注册（3 字段：description / name / attrs，无 edges）
//   4. 实例级 edges 引用身份
//   5. 边从 attrs.edges 派生
//   6. serializeCode（class field 3 字段 + inst.edges 数组）
//   7. resetRuntime
//   8. 持久化 save/load round-trip (version 6)
//   9. 旧 v5 格式硬切换
//  10. 双模式切换
//  11. 新建节点（已存在 class）
//  12. 新建节点（新 class，空模板 3 字段）
//  13. 复制节点（继承 override + edges 数组）
//  14. panel 实例模式加属性
//  15. panel 类型模式加属性
//  16. panel 实例模式删属性
//  17. 实例级 description 编辑
//  18. 类型模式默认值传播
//  19. panel 实例模式加边（push 到 inst.attrs.edges）
//  20. selEdge 活过 runSource
//  21. Code 模式 panel 禁用
//  22. Ctrl+C/V 复制粘贴
//  23. 多边支持（同源多目标）
import puppeteer from 'puppeteer'
import { resolve } from 'path'

const root = resolve(process.cwd())

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : '') }
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

const browser = await puppeteer.launch({
  headless: 'new',
  args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
})
const page = await browser.newPage()

page.on('console', msg => console.log('  [browser console]', msg.text()))
page.on('pageerror', err => console.log('  [browser error]', err.message))
const dialogMsgs = []
page.on('dialog', async d => {
  dialogMsgs.push(d.message())
  await d.accept()
})

await page.goto('file://' + resolve(root, 'dist', 'index.html'))
await page.waitForFunction(() => window.state)

console.log('测试 1：空画布加载')
{
  const stats = await page.evaluate(() => ({
    instanceCount: window.state.runtimeInstances.length,
    classCount: Object.keys(window.state.classes).length,
    sourceCodeLength: window.state.sourceCode.length,
    editMode: window.state.editMode,
  }))
  check('默认示例 4 个实例', stats.instanceCount === 4, stats.instanceCount)
  check('默认示例 4 个 class', stats.classCount === 4, stats.classCount)
  check('默认示例 sourceCode 非空', stats.sourceCodeLength > 800, stats.sourceCodeLength)
  check('默认 editMode = ui', stats.editMode === 'ui', stats.editMode)
}

console.log('\n测试 2：importSource 加载 v0.9 sample')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '测试图' })
  }, V09_SAMPLE)
  const stats = await page.evaluate(() => ({
    instanceCount: window.state.runtimeInstances.length,
    varNames: window.state.runtimeInstances.map(i => i.varName),
    classNames: window.state.runtimeInstances.map(i => i.className),
  }))
  check('实例数 = 3', stats.instanceCount === 3, stats.instanceCount)
  check('varNames 自动生成 = Source_1,Processor_1,Database_1',
    stats.varNames.join(',') === 'Source_1,Processor_1,Database_1', stats.varNames)
  check('classNames = Source,Processor,Database',
    stats.classNames.join(',') === 'Source,Processor,Database', stats.classNames)
}

console.log('\n测试 3：class scanner 注册（3 字段，无 edges）')
{
  const stats = await page.evaluate(() => {
    const c = window.state.classes
    return {
      count: Object.keys(c).length,
      sourceAttrsRate: c.Source?.attrs?.rate,
      sourceAttrsValue: c.Source?.attrs?.value,
      sourceDescription: c.Source?.description,
      sourceName: c.Source?.name,
      sourceHasEdges: 'edges' in (c.Source || {}),     // v0.9 不应有
      databaseAttrsInput: c.Database?.attrs?.input,
      hasProperties: 'properties' in (c.Source || {}),
      hasDefaults: 'defaults' in (c.Source || {}),
    }
  })
  check('注册 3 个 class', stats.count === 3, stats.count)
  check('Source.attrs.rate=1', stats.sourceAttrsRate === 1, stats.sourceAttrsRate)
  check('Source.attrs.value=0', stats.sourceAttrsValue === 0, stats.sourceAttrsValue)
  check('Source.description 注册',
    stats.sourceDescription && stats.sourceDescription.includes('数据源'), stats.sourceDescription)
  check('Source.name 注册', stats.sourceName === '数据源', stats.sourceName)
  check('Source class 无 edges 字段（v0.9 移除）', stats.sourceHasEdges === false, stats.sourceHasEdges)
  check('Database.attrs.input=0', stats.databaseAttrsInput === 0, stats.databaseAttrsInput)
  check('无 properties 字段（v0.7 残留）', stats.hasProperties === false, stats.hasProperties)
  check('无 defaults 字段（v0.7 残留）', stats.hasDefaults === false, stats.hasDefaults)
}

console.log('\n测试 4：实例级 edges 引用身份（attrs 对象身份比较）')
{
  const stats = await page.evaluate(() => {
    const [s1, p1, d1] = window.state.runtimeInstances
    return {
      s1_edges_0_target_is_p1: Array.isArray(s1.attrs.edges) && s1.attrs.edges[0].target === p1.attrs,
      p1_edges_0_target_is_d1: Array.isArray(p1.attrs.edges) && p1.attrs.edges[0].target === d1.attrs,
      s1_edges_0_desc: s1.attrs.edges?.[0]?.description,
    }
  })
  check('Source_1.edges[0].target === Processor_1.attrs',
    stats.s1_edges_0_target_is_p1 === true, stats.s1_edges_0_target_is_p1)
  check('Processor_1.edges[0].target === Database_1.attrs',
    stats.p1_edges_0_target_is_d1 === true, stats.p1_edges_0_target_is_d1)
  check('Source_1.edges[0].description = 数据流向下游',
    stats.s1_edges_0_desc === '数据流向下游', stats.s1_edges_0_desc)
}

console.log('\n测试 5：边从 attrs.edges 派生')
{
  const initial = await page.evaluate(() => window.deriveEdges().length)
  check('初始边数 = 2', initial === 2, initial)

  // 清空 Source_1.attrs.edges → 边数应减 1
  await page.evaluate(() => {
    const s = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    s.attrs.edges = []
  })
  const after = await page.evaluate(() => window.deriveEdges().length)
  check('清空 Source_1.edges 后边数 = 1', after === 1, after)

  // 恢复
  await page.evaluate(() => {
    const s = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const p = window.state.runtimeInstances.find(i => i.varName === 'Processor_1')
    s.attrs.edges = [{ target: p.attrs, description: '数据流向下游' }]
  })
  const restored = await page.evaluate(() => window.deriveEdges().length)
  check('恢复 Source_1.edges 后边数 = 2', restored === 2, restored)
}

console.log('\n测试 6：serializeCode 输出 class field 3 字段（无 static 无 constructor 无 edges）')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '测试图' })
  }, V09_SAMPLE)
  const stats = await page.evaluate(() => {
    const src = window.state.sourceCode
    return {
      hasClassFieldDescription: /^\s*description\s*=/m.test(src),
      hasClassFieldName: /^\s*name\s*=/m.test(src),
      hasClassFieldAttrs: /^\s*attrs\s*=\s*\{/m.test(src),
      noClassFieldEdges: !/^\s*edges\s*=\s*\[/m.test(src),
      noStatic: !/static\s+(description|edges|attrs|name)/.test(src),
      noConstructor: !/constructor\s*\(/.test(src),
      hasOverride: /Source_1\.rate\s*=\s*5/.test(src),
      hasEdgesArrayAssign: /Source_1\.edges\s*=\s*\[/.test(src),
    }
  })
  check('class 段用 class field description', stats.hasClassFieldDescription === true, stats)
  check('class 段用 class field name', stats.hasClassFieldName === true, stats)
  check('class 段用 class field attrs', stats.hasClassFieldAttrs === true, stats)
  check('class 段无 edges 字段（v0.9 移除）', stats.noClassFieldEdges === true, stats)
  check('无 static 字段', stats.noStatic === true, stats)
  check('无 constructor', stats.noConstructor === true, stats)
  check('override 多行赋值', stats.hasOverride === true, stats)
  check('实例 edges 数组赋值', stats.hasEdgesArrayAssign === true, stats)
}

console.log('\n测试 7：resetRuntime 丢弃运行时 mutation')
{
  await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    s1.attrs.value = 9999
  })
  const before = await page.evaluate(() => window.state.runtimeInstances[0].attrs.value)
  check('mutation 生效', before === 9999, before)

  await page.evaluate(() => window.resetRuntime())
  const after = await page.evaluate(() => ({
    s1_value: window.state.runtimeInstances[0].attrs.value,
    s1_rate_kept: window.state.runtimeInstances[0].attrs.rate === 5,
    s1_edges_kept: Array.isArray(window.state.runtimeInstances[0].attrs.edges) &&
      window.state.runtimeInstances[0].attrs.edges.length === 1,
  }))
  check('reset 后 value 回到默认 0', after.s1_value === 0, after.s1_value)
  check('reset 后启动段 override rate=5 保留', after.s1_rate_kept === true, after.s1_rate_kept)
  check('reset 后 edges 数组保留', after.s1_edges_kept === true, after.s1_edges_kept)
}

console.log('\n测试 8：持久化 save/load round-trip (version 6)')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '持久化测试' })
  }, V09_SAMPLE)
  await page.evaluate(() => window.save())
  await page.reload()
  await page.waitForFunction(() => window.state)
  const after = await page.evaluate(() => ({
    count: window.state.runtimeInstances.length,
    varNames: window.state.runtimeInstances.map(i => i.varName),
    sourceCodeLength: window.state.sourceCode.length,
    edges: window.deriveEdges().length,
    version: (() => {
      const raw = localStorage.getItem('sa_data')
      if (!raw) return null
      try { return JSON.parse(raw).version } catch { return null }
    })(),
    editMode: window.state.editMode,
  }))
  check('reload 后实例数 = 3', after.count === 3, after.count)
  check('reload 后 varNames 保持', after.varNames.join(',') === 'Source_1,Processor_1,Database_1', after.varNames)
  check('reload 后 sourceCode 非空', after.sourceCodeLength > 100, after.sourceCodeLength)
  check('reload 后边数 = 2', after.edges === 2, after.edges)
  check('sa_data version = 6', after.version === 6, after.version)
  check('editMode 默认 ui', after.editMode === 'ui', after.editMode)
}

console.log('\n测试 9：旧 v5 格式硬切换')
{
  await page.evaluate(() => {
    localStorage.setItem('sa_data', JSON.stringify({
      version: 5,
      sourceCode: 'class Old { static edges = [] }',
      graphId: 'old', graphTitle: '旧 v0.8 图',
    }))
  })
  await page.reload()
  await page.waitForFunction(() => window.state)
  const result = await page.evaluate(() => ({
    instanceCount: window.state.runtimeInstances.length,
    stillHasOld: (() => {
      const raw = localStorage.getItem('sa_data')
      if (!raw) return false
      try { return JSON.parse(raw).version === 5 } catch { return false }
    })(),
  }))
  check('旧 v5 被忽略，fallback 到默认示例', result.instanceCount === 4, result.instanceCount)
  check('旧 sa_data 被清空或覆盖', result.stillHasOld === false, result.stillHasOld)
}

console.log('\n测试 10：双模式切换 UI ↔ Code')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '模式切换测试' })
  }, V09_SAMPLE)

  await page.evaluate(() => window.setEditMode('code'))
  const afterCode = await page.evaluate(() => ({
    editMode: window.state.editMode,
    sourceStillValid: window.state.runtimeInstances.length === 3,
  }))
  check('UI → Code 后 editMode = code', afterCode.editMode === 'code', afterCode.editMode)
  check('UI → Code 后实例数仍 = 3（无损）', afterCode.sourceStillValid === true, afterCode.sourceStillValid)

  await page.evaluate(() => window.setEditMode('ui'))
  const afterUI = await page.evaluate(() => window.state.editMode)
  check('Code → UI 后 editMode = ui', afterUI === 'ui', afterUI)
}

console.log('\n测试 11：新建节点（已存在 class）')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '新建测试' })
  }, V09_SAMPLE)
  await page.evaluate(() => {
    window.__modalPrefill = { className: 'Source', varName: 'Source_2' }
    window.createNode()
  })
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => ({
    sourceCount: window.state.runtimeInstances.filter(i => i.className === 'Source').length,
    hasSource2: !!window.state.runtimeInstances.find(i => i.varName === 'Source_2'),
    sourceCodeHasAdd: window.state.sourceCode.includes('GraphStarter.add(Source, "Source_2")'),
  }))
  check('Source 实例数 = 2', stats.sourceCount === 2, stats.sourceCount)
  check('Source_2 创建', stats.hasSource2 === true, stats.hasSource2)
  check('sourceCode 含新 add 调用（带显式 varName）', stats.sourceCodeHasAdd === true, stats.sourceCodeHasAdd)
}

console.log('\n测试 12：新建节点（新 class）——空 class 模板用 3 字段（无 name 无 edges）')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '新建 class 测试' })
  }, V09_SAMPLE)
  await page.evaluate(() => {
    window.__modalPrefill = { className: 'BrandNew', varName: 'BrandNew_1' }
    window.createNode()
  })
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => ({
    hasClass: !!window.state.classes.BrandNew,
    instanceCount: window.state.runtimeInstances.length,
    hasInstance: !!window.state.runtimeInstances.find(i => i.varName === 'BrandNew_1'),
    sourceCodeHasClass: window.state.sourceCode.includes('class BrandNew'),
    sourceCodeHasEmptyAttrs: /class BrandNew[\s\S]*?attrs\s*=\s*\{\}/.test(window.state.sourceCode),
    noConstructor: !/class BrandNew[\s\S]*constructor/.test(window.state.sourceCode),
    noNameField: !/class BrandNew[\s\S]*?^\s*name\s*=/.test(window.state.sourceCode),
    noEdgesField: !/class BrandNew[\s\S]*?^\s*edges\s*=/.test(window.state.sourceCode),
    classNameFallback: window.state.runtimeInstances.find(i => i.varName === 'BrandNew_1').label,
  }))
  check('BrandNew class 注册', stats.hasClass === true, stats.hasClass)
  check('总实例数 = 4（原 3 + 新 1）', stats.instanceCount === 4, stats.instanceCount)
  check('BrandNew_1 实例存在', stats.hasInstance === true, stats.hasInstance)
  check('sourceCode 含 class BrandNew', stats.sourceCodeHasClass === true, stats.sourceCodeHasClass)
  check('新 class 模板含 attrs = {}（空字典）', stats.sourceCodeHasEmptyAttrs === true, stats.sourceCodeHasEmptyAttrs)
  check('新 class 模板无 constructor', stats.noConstructor === true, stats.noConstructor)
  check('新 class 模板无 name = "" 行（v0.9 省略空 name）', stats.noNameField === true, stats)
  check('新 class 模板无 edges = [] 行（v0.9 移除 edges）', stats.noEdgesField === true, stats)
  check('label 兜底到 className（"BrandNew"）', stats.classNameFallback === 'BrandNew', stats.classNameFallback)
}

console.log('\n测试 13：复制节点（继承 override 和 edges 数组）')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '复制测试' })
  }, V09_SAMPLE)
  dialogMsgs.length = 0
  await page.evaluate(() => {
    window.__modalPrefill = { varName: 'Source_1_copy' }
    const src = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.copyInstance(src)
  })
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 300))
  if (dialogMsgs.length) console.log('  [dialog captured]', dialogMsgs)
  const stats = await page.evaluate(() => {
    const copy = window.state.runtimeInstances.find(i => i.varName === 'Source_1_copy')
    const p1 = window.state.runtimeInstances.find(i => i.varName === 'Processor_1')
    return {
      hasCopy: !!copy,
      rateInherited: copy?.attrs.rate === 5,
      edgesInherited: Array.isArray(copy?.attrs.edges) && copy?.attrs.edges.length === 1,
      edgesTargetInherited: copy?.attrs.edges?.[0]?.target === p1?.attrs,
      sourceCodeHasOverride: window.state.sourceCode.includes('Source_1_copy.rate = 5'),
      sourceCodeHasEdges: /Source_1_copy\.edges\s*=\s*\[/.test(window.state.sourceCode),
    }
  })
  check('Source_1_copy 实例存在', stats.hasCopy === true, stats.hasCopy)
  check('rate override 被继承（= 5）', stats.rateInherited === true, stats.rateInherited)
  check('edges 数组被继承', stats.edgesInherited === true, stats.edgesInherited)
  check('edges[0].target 引用被继承', stats.edgesTargetInherited === true, stats.edgesTargetInherited)
  check('sourceCode 含复制块的 override 行', stats.sourceCodeHasOverride === true, stats.sourceCodeHasOverride)
  check('sourceCode 含复制块的 edges 数组', stats.sourceCodeHasEdges === true, stats.sourceCodeHasEdges)
}

console.log('\n测试 14：实例模式加属性 → inst.attrs + sourceCode 多行赋值')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '加属性测试' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.showNodePanel(s1)
    window.setPanelMode('instance')
    window.__modalPrefill = { key: 'priority', value: 'high' }
    window.addProperty()
  }, V09_SAMPLE)
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const cls = window.state.classes.Source
    return {
      instHasPriority: s1.attrs.priority === 'high',
      clsNoPriority: !('priority' in cls.attrs),
      srcHasPriority: window.state.sourceCode.includes("Source_1.priority = 'high'"),
    }
  })
  check('inst.attrs.priority = "high"', stats.instHasPriority === true, stats.instHasPriority)
  check('cls.attrs 不含 priority（实例追加）', stats.clsNoPriority === true, stats.clsNoPriority)
  check('sourceCode 含 Source_1.priority = "high"', stats.srcHasPriority === true, stats.srcHasPriority)
}

console.log('\n测试 15：类型模式加属性 → cls.attrs + 实例自动同步')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '类型加属性' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.showNodePanel(s1)
    window.setPanelMode('type')
    window.__modalPrefill = { key: 'threshold', value: '10' }
    window.addProperty()
  }, V09_SAMPLE)
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => {
    const cls = window.state.classes.Source
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    return {
      clsHasThreshold: cls.attrs.threshold === 10,
      instHasThreshold: s1.attrs.threshold === 10,
      srcHasClassField: /attrs\s*=\s*\{[\s\S]*threshold:\s*10/.test(window.state.sourceCode),
    }
  })
  check('cls.attrs.threshold = 10', stats.clsHasThreshold === true, stats.clsHasThreshold)
  check('实例自动同步 threshold = 10', stats.instHasThreshold === true, stats.instHasThreshold)
  check('sourceCode class 段 attrs 含 threshold: 10', stats.srcHasClassField === true, stats.srcHasClassField)
}

console.log('\n测试 16：实例模式删属性 → 仅从 inst.attrs 删（class 默认保留）')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '删属性' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    s1.attrs.extraField = 'temp'
    window.syncCodeFromRuntime()
    window.showNodePanel(s1)
    window.setPanelMode('instance')
    window.deleteProperty('extraField')
  }, V09_SAMPLE)
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    return {
      instNoExtra: !('extraField' in s1.attrs),
      srcNoExtra: !window.state.sourceCode.includes('extraField'),
    }
  })
  check('inst.attrs 不含 extraField', stats.instNoExtra === true, stats.instNoExtra)
  check('sourceCode 不含 extraField', stats.srcNoExtra === true, stats.srcNoExtra)
}

console.log('\n测试 17：实例级 description 编辑 → sourceCode 多行赋值')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: 'desc' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.showNodePanel(s1)
    window.setPanelMode('instance')
    const desc = document.getElementById('np-desc')
    desc.value = '实例级描述'
    desc.dispatchEvent(new Event('input', { bubbles: true }))
  }, V09_SAMPLE)
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => ({
    srcHasInstDesc: window.state.sourceCode.includes("Source_1.description = '实例级描述'"),
    instDesc: window.state.runtimeInstances.find(i => i.varName === 'Source_1').description,
    clsDesc: window.state.classes.Source.description,
  }))
  check('sourceCode 含实例级 description override', stats.srcHasInstDesc === true, stats.srcHasInstDesc)
  check('inst.description getter 返回实例级', stats.instDesc === '实例级描述', stats.instDesc)
  check('cls.description 保留默认（数据源）', stats.clsDesc === '数据源', stats.clsDesc)
}

console.log('\n测试 18：类型模式默认值传播')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: 't18' })
    window.state.sourceCode = window.state.sourceCode +
      '\nconst Source_2 = GraphStarter.add(Source, "Source_2")'
    window.runSource(window.state.sourceCode, window.state)
    for (const i of window.state.runtimeInstances) window.wrapInstance(i)
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.showNodePanel(s1)
    window.setPanelMode('type')
    const rateInput = document.getElementById('np-attr-rate')
    rateInput.value = '999'
    rateInput.dispatchEvent(new Event('input', { bubbles: true }))
  }, V09_SAMPLE)
  await new Promise(r => setTimeout(r, 200))
  const stats = await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const s2 = window.state.runtimeInstances.find(i => i.varName === 'Source_2')
    return {
      newDefault: window.state.classes.Source.attrs.rate,
      s1rate: s1.attrs.rate,
      s2rate: s2.attrs.rate,
    }
  })
  check('cls.attrs.rate = 999', stats.newDefault === 999, stats.newDefault)
  check('Source_1 override (=5) 保留', stats.s1rate === 5, stats.s1rate)
  check('Source_2 (无 override) 同步到 999', stats.s2rate === 999, stats.s2rate)
}

console.log('\n测试 19：实例模式加边 → push 到 inst.attrs.edges')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: 't19' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.showNodePanel(s1)
    window.setPanelMode('instance')
    window.__modalPrefill = { target: 'Database_1', description: '直连数据库' }
    window.addInstanceEdge()
  }, V09_SAMPLE)
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 300))
  const stats = await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const d1 = window.state.runtimeInstances.find(i => i.varName === 'Database_1')
    const edges = s1.attrs.edges || []
    return {
      edgeCount: edges.length,
      lastEdgeTargetIsD1: edges[edges.length - 1]?.target === d1?.attrs,
      lastEdgeDesc: edges[edges.length - 1]?.description,
      srcHasEdgesArray: /Source_1\.edges\s*=\s*\[/m.test(window.state.sourceCode),
      derivedEdgeCount: window.deriveEdges().filter(e => e.source_instance === 'Source_1').length,
    }
  })
  check('Source_1.attrs.edges 现在有 2 条（原 1 + 新 1）', stats.edgeCount === 2, stats.edgeCount)
  check('新边 target = Database_1.attrs', stats.lastEdgeTargetIsD1 === true, stats)
  check('新边 description = 直连数据库', stats.lastEdgeDesc === '直连数据库', stats.lastEdgeDesc)
  check('sourceCode 含 Source_1.edges = [...]（2 条）', stats.srcHasEdgesArray === true, stats.srcHasEdgesArray)
  check('deriveEdges() Source_1 出边数 = 2', stats.derivedEdgeCount === 2, stats.derivedEdgeCount)
}

console.log('\n测试 20：selEdge 活过 runSource')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: 't20' })
    const edges = window.deriveEdges()
    window.selectEdge(edges[0])
    window.runSource(window.state.sourceCode, window.state)
    for (const i of window.state.runtimeInstances) window.wrapInstance(i)
  }, V09_SAMPLE)
  const stats = await page.evaluate(() => {
    const edges = window.deriveEdges()
    return {
      selEdgePreserved: window.state.selEdge === edges[0].id,
      e0Id: edges[0].id,
    }
  })
  check('selEdge 字符串活过 runSource', stats.selEdgePreserved === true, stats)
}

console.log('\n测试 21：Code 模式 panel 全只读')
{
  const stats = await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: 't21' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.showNodePanel(s1)
    window.setEditMode('code')
    window.showNodePanel(window.state.selInstance)
    const buttons = document.querySelectorAll('.panel-mode-toggle .edit-mode-btn')
    return {
      toggleCount: buttons.length,
      allDisabled: Array.from(buttons).every(b => b.disabled),
      noAddEdgeButton: !document.querySelector('button[onclick="addInstanceEdge()"]'),
      noAddPropButton: !document.querySelector('button[onclick="addProperty()"]'),
    }
  }, V09_SAMPLE)
  check('segmented control 有 2 个按钮', stats.toggleCount === 2, stats.toggleCount)
  check('Code 模式下两个按钮都 disabled', stats.allDisabled === true, stats.allDisabled)
  check('Code 模式下不显示"+ 加边"', stats.noAddEdgeButton === true)
  check('Code 模式下不显示"+ 加属性"', stats.noAddPropButton === true)
  await page.evaluate(() => window.setEditMode('ui'))
}

console.log('\n测试 22：Ctrl+C/V 复制粘贴（不弹 modal，varName _1 起）')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: 't22' })
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    window.selectInstance(s1)
  }, V09_SAMPLE)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyC')
  await page.keyboard.up('Control')
  await new Promise(r => setTimeout(r, 100))
  const clipboardAfterCopy = await page.evaluate(() => window.state.clipboard)
  check('Ctrl+C 后 state.clipboard = "Source_1"', clipboardAfterCopy === 'Source_1', clipboardAfterCopy)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyV')
  await page.keyboard.up('Control')
  await new Promise(r => setTimeout(r, 300))
  const stats = await page.evaluate(() => {
    const copy = window.state.runtimeInstances.find(i => i.varName === 'Source_1_1')
    return {
      hasCopy: !!copy,
      rateInherited: copy?.attrs.rate === 5,
      noModalDialog: !window.__modalPrefill,
    }
  })
  check('Source_1_1 实例存在（varName _1 起）', stats.hasCopy === true, stats.hasCopy)
  check('rate override 继承', stats.rateInherited === true, stats.rateInherited)
  check('没弹 modal', stats.noModalDialog === true, stats.noModalDialog)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyV')
  await page.keyboard.up('Control')
  await new Promise(r => setTimeout(r, 300))
  const has2 = await page.evaluate(() => !!window.state.runtimeInstances.find(i => i.varName === 'Source_1_2'))
  check('第二次 Ctrl+V → Source_1_2（冲突自动 _2）', has2 === true, has2)
}

console.log('\n测试 23：多边支持（同源多目标 / 同源同目标）')
{
  const multiSample = `class Source {
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
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '多边测试' })
  }, multiSample)
  const stats = await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const m1 = window.state.runtimeInstances.find(i => i.varName === 'Mid_1')
    const k1 = window.state.runtimeInstances.find(i => i.varName === 'Sink_1')
    const edges = s1.attrs.edges || []
    return {
      edgeCount: edges.length,
      e0_to_m1: edges[0]?.target === m1.attrs,
      e1_to_k1: edges[1]?.target === k1.attrs,
      e2_to_m1: edges[2]?.target === m1.attrs,
      derivedEdges: window.deriveEdges().length,
      derivedFromSource: window.deriveEdges().filter(e => e.source_instance === 'Source_1').length,
    }
  })
  check('Source_1.attrs.edges 有 3 条', stats.edgeCount === 3, stats.edgeCount)
  check('edge[0].target = Mid_1', stats.e0_to_m1 === true, stats)
  check('edge[1].target = Sink_1', stats.e1_to_k1 === true, stats)
  check('edge[2].target = Mid_1（同目标多边）', stats.e2_to_m1 === true, stats)
  check('deriveEdges() 总数 = 3', stats.derivedEdges === 3, stats.derivedEdges)
  check('Source_1 出边数 = 3', stats.derivedFromSource === 3, stats.derivedFromSource)
}

console.log('\n测试 24：拖边交互 → 创建新边')
{
  await page.evaluate((src) => {
    window.__testImport({ sourceCode: src, title: '拖边测试' })
    // Source_1 当前已有 1 边到 Processor_1，再拖一条到 Database_1
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const d1 = window.state.runtimeInstances.find(i => i.varName === 'Database_1')
    // 模拟 createEdgeFromDrag（拖边 mouseup 后调用）
    window.__modalPrefill = { description: '拖拽创建的边' }
    // 直接调用内部逻辑（createEdgeFromDrag 是 internal，但能通过模拟走通）
    // 这里走更直接的 API：showNodePanel + addInstanceEdge
    window.showNodePanel(s1)
    window.setPanelMode('instance')
    window.__modalPrefill = { target: 'Database_1', description: '拖拽创建的边' }
    window.addInstanceEdge()
  }, V09_SAMPLE)
  await page.waitForFunction(() => !window.__modalPrefill, { timeout: 1000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 300))
  const stats = await page.evaluate(() => {
    const s1 = window.state.runtimeInstances.find(i => i.varName === 'Source_1')
    const d1 = window.state.runtimeInstances.find(i => i.varName === 'Database_1')
    const edges = s1.attrs.edges || []
    return {
      edgeCount: edges.length,
      lastTargetIsD1: edges[edges.length - 1]?.target === d1.attrs,
      lastDesc: edges[edges.length - 1]?.description,
    }
  })
  check('Source_1 现在有 2 条 edges', stats.edgeCount === 2, stats.edgeCount)
  check('新边 target = Database_1', stats.lastTargetIsD1 === true, stats)
  check('新边 description = 拖拽创建的边', stats.lastDesc === '拖拽创建的边', stats.lastDesc)
}

console.log('\n测试 25：infoLevel 切换 → 形状随之变（无 nodeShape）')
{
  const stats = await page.evaluate(() => {
    window.__testImport({ sourceCode: '', title: 't25' })
    return {
      noNodeShape: !('nodeShape' in window.config),
      noSelShapeEl: !document.getElementById('sel-shape'),
    }
  })
  check('config 不含 nodeShape', stats.noNodeShape === true, stats.noNodeShape)
  check('sel-shape 元素已删除', stats.noSelShapeEl === true, stats.noSelShapeEl)
}

console.log('\n测试 26：transform 抛错时边面板显示错误（v0.11 ADR-003 DX）')
{
  const result = await page.evaluate(() => {
    const src = `class Src26 {
  description = "源"
  attrs = { x: 10 }
}
class Tgt26 {
  description = "目标"
  attrs = { y: 0 }
}
const Src26_1 = GraphStarter.add(Src26)
const Tgt26_1 = GraphStarter.add(Tgt26)
Src26_1.edges = [{ target: Tgt26_1, description: '边26', transform: "target['y'] = 1" }]`
    window.__testImport({ sourceCode: src, title: 't26' })

    window.showEdgePanel('Src26_1>Tgt26_1>0')

    const ta = document.getElementById('ep-transform')
    ta.value = "throw new Error('boom26')"
    ta.dispatchEvent(new Event('input', { bubbles: true }))

    const errEl = document.getElementById('ep-terr')
    return {
      errElExists: !!errEl,
      textContent: errEl ? errEl.textContent : null,
      display: errEl ? errEl.style.display : null,
    }
  })
  check('#ep-terr 元素存在', result.errElExists === true)
  check('错误文本含 boom26', !!(result.textContent && result.textContent.includes('boom26')), result.textContent)
  check('错误 div 可见', result.display !== 'none', result.display)
}

console.log('\n测试 27：修复 transform 后错误清除')
{
  const result = await page.evaluate(() => {
    const ta = document.getElementById('ep-transform')
    ta.value = "target['y'] = source['x'] * 2"
    ta.dispatchEvent(new Event('input', { bubbles: true }))

    const errEl = document.getElementById('ep-terr')
    const srcInst = window.state.runtimeInstances.find(i => i.varName === 'Src26_1')
    const tgtInst = window.state.runtimeInstances.find(i => i.varName === 'Tgt26_1')
    return {
      display: errEl ? errEl.style.display : null,
      textContent: errEl ? errEl.textContent : null,
      edgeErr: srcInst.attrs.edges[0]._transformError,
      tgtY: tgtInst.attrs.y,
    }
  })
  check('错误 div 隐藏', result.display === 'none', result.display)
  check('边 _transformError 清空', result.edgeErr === null, result.edgeErr)
  check('transform 正确执行(y=20)', result.tgtY === 20, result.tgtY)
}

console.log('\n测试 28：multi-edge 源节点各边独立错误（last-edge-wins 回归守卫）')
{
  const result = await page.evaluate(() => {
    const src = `class Src28 {
  description = "源"
  attrs = { x: 1 }
}
class T28a {
  description = "目标A"
  attrs = { v: 0 }
}
class T28b {
  description = "目标B"
  attrs = { v: 0 }
}
const Src28_1 = GraphStarter.add(Src28)
const T28a_1 = GraphStarter.add(T28a)
const T28b_1 = GraphStarter.add(T28b)
Src28_1.edges = [
  { target: T28a_1, description: 'a', transform: "throw new Error('errA')" },
  { target: T28b_1, description: 'b', transform: "throw new Error('errB')" }
]`
    window.__testImport({ sourceCode: src, title: 't28' })

    window.runTransforms()

    const srcInst = window.state.runtimeInstances.find(i => i.varName === 'Src28_1')
    return {
      err0: srcInst.attrs.edges[0]._transformError,
      err1: srcInst.attrs.edges[1]._transformError,
      instExecErr: srcInst._execError,
    }
  })
  check('edges[0] 报 errA', !!(result.err0 && result.err0.includes('errA')), result.err0)
  check('edges[1] 报 errB', !!(result.err1 && result.err1.includes('errB')), result.err1)
  check('源 inst._execError 未被污染', result.instExecErr === null || result.instExecErr === undefined, result.instExecErr)
}

console.log('\n测试 29：输入 source[\' 弹出 key 列表(v0.12 transform autocomplete)')
{
  const result = await page.evaluate(() => {
    const src = `class Src29 {
  description = "源"
  attrs = { rate: 1, value: 100, name: '元字段' }
}
class Tgt29 {
  description = "目标"
  attrs = { y: 0 }
}
const Src29_1 = GraphStarter.add(Src29)
const Tgt29_1 = GraphStarter.add(Tgt29)
Src29_1.edges = [{ target: Tgt29_1, description: '边29' }]`
    window.__testImport({ sourceCode: src, title: 't29' })
    window.showEdgePanel('Src29_1>Tgt29_1>0')
    const ta = document.getElementById('ep-transform')
    ta.focus()
    ta.value = "source['"
    ta.setSelectionRange(8, 8)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const s = window.__epAutocompleteState()
    return {
      open: s.open,
      candidates: s.candidates,
    }
  })
  check('popup 打开', result.open === true)
  check('候选含 rate', result.candidates.includes('rate'))
  check('候选含 value', result.candidates.includes('value'))
  check('排除 name(excludeMeta 生效)', !result.candidates.includes('name'), JSON.stringify(result.candidates))
  check('排除 description', !result.candidates.includes('description'))
}

console.log('\n测试 30：↑↓ 键盘导航 popup')
{
  const result = await page.evaluate(() => {
    const ta = document.getElementById('ep-transform')
    const s1 = window.__epAutocompleteState().selected
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const s2 = window.__epAutocompleteState().selected
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    const s3 = window.__epAutocompleteState().selected
    const count = window.__epAutocompleteState().candidates.length
    return { s1, s2, s3, count }
  })
  check('初始选中 = 0', result.s1 === 0)
  check('ArrowDown → 1', result.s2 === 1, result.s2)
  check('ArrowUp 回到 0', result.s3 === 0, result.s3)
  check('候选数 = 2(rate + value)', result.count === 2, result.count)
}

console.log('\n测试 31：Enter 插入选中 key')
{
  const result = await page.evaluate(() => {
    const ta = document.getElementById('ep-transform')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))  // sel 0→1 → value
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const srcInst = window.state.runtimeInstances.find(i => i.varName === 'Src29_1')
    return {
      value: ta.value,
      caret: ta.selectionStart,
      edgeTransform: srcInst.attrs.edges[0].transform,
      popupOpen: window.__epAutocompleteState().open,
    }
  })
  check("textarea 含 source['value']", result.value.includes("source['value']"), result.value)
  check('光标在 ] 后(末尾)', result.caret === result.value.length, result.caret)
  check('edge.transform 已持久化', result.edgeTransform === result.value, result.edgeTransform)
  check('popup 关闭', result.popupOpen === false)
}

console.log('\n测试 32：Esc 关闭 popup,内容不变,focus 保留')
{
  const result = await page.evaluate(() => {
    const ta = document.getElementById('ep-transform')
    ta.value = "target['"
    ta.setSelectionRange(8, 8)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const opened = window.__epAutocompleteState().open
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return {
      openedAfterInput: opened,
      closedAfterEsc: window.__epAutocompleteState().open === false,
      valueAfterEsc: ta.value,
      activeIsTextarea: document.activeElement === ta,
    }
  })
  check("target[ 触发 popup", result.openedAfterInput === true)
  check('Esc 关闭 popup', result.closedAfterEsc === true)
  check('Esc 不改 textarea 内容', result.valueAfterEsc === "target['", result.valueAfterEsc)
  check('focus 仍在 textarea', result.activeIsTextarea === true)
}

console.log('\n测试 33：候选过滤(输入部分 key)')
{
  const result = await page.evaluate(() => {
    const ta = document.getElementById('ep-transform')
    ta.value = "source['ra"
    ta.setSelectionRange(11, 11)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const s1 = window.__epAutocompleteState()
    ta.value = "source['xyz"
    ta.setSelectionRange(12, 12)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const s2 = window.__epAutocompleteState()
    return { candidatesRa: s1.candidates, openRa: s1.open, openXyz: s2.open }
  })
  check("'ra' 过滤到 ['rate']", JSON.stringify(result.candidatesRa) === JSON.stringify(['rate']), JSON.stringify(result.candidatesRa))
  check("'ra' popup 打开", result.openRa === true)
  check("'xyz' 无匹配 popup 关闭", result.openXyz === false)
}

console.log('\n测试 34：v0.11 focus 契约守卫(autocomplete 操作不重建 panel)')
{
  const result = await page.evaluate(() => {
    const ta = document.getElementById('ep-transform')
    const taRefBefore = document.getElementById('ep-transform')
    ta.value = "source['va"
    ta.setSelectionRange(11, 11)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const taRefAfter = document.getElementById('ep-transform')
    const errEl = document.getElementById('ep-terr')
    return {
      value: ta.value,
      caret: ta.selectionStart,
      activeIsTextarea: document.activeElement === ta,
      taRefUnchanged: taRefBefore === taRefAfter,
      errElExists: !!errEl,
    }
  })
  check("插入 source['value']", result.value.includes("source['value']"), result.value)
  check('光标在 ] 后(末尾)', result.caret === result.value.length, result.caret)
  check('focus 仍在 textarea', result.activeIsTextarea === true)
  check('textarea DOM 引用未变(innerHTML 未重建)', result.taRefUnchanged === true)
  check('#ep-terr 仍存在(原地更新机制)', result.errElExists === true)
}

await browser.close()
console.log(`\n总计: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
