// v0.6 panel：选中实例/边 → 编辑属性 → 触发 syncCodeFromRuntime（序列化回 sourceCode）
//
// 变化（vs v0.5）：
//   - 不再 import renameInstance（v0.6 varName 不可改）
//   - 不再 import getClassLabel（v0.6 label = className）
//   - 属性/引用/edgeMeta 修改后调 syncCodeFromRuntime()
//   - 颜色从 visualState.colors[varName] 读写（不是 inst.visual.color）
//   - 实例身份从 inst.id 改为 inst.varName

import { state, config } from './state.js'
import { render } from './renderer.js'
import { pushUndo, delInstance, delEdge } from './editor.js'
import { save, setEdgeMeta, syncCodeFromRuntime } from './io.js'
import { propagate } from './engine.js'
import { esc } from './utils.js'

const $ = s => document.querySelector(s)
const panel = $('#panel')
const panelTitle = $('#panel-title')
const panelBody = $('#panel-body')

let _propagateTimer
function triggerPropagate(varName) {
  if (config.execMode === 'off') return
  clearTimeout(_propagateTimer)
  _propagateTimer = setTimeout(() => {
    if (config.execMode === 'auto') propagate(varName)
  }, 300)
}

export function hidePanel() {
  panel.classList.add('hidden')
}

// 找出引用值（目标 attrs 对象）对应的 varName
function refValueToVarName(attrsObj) {
  if (!attrsObj || typeof attrsObj !== 'object') return ''
  const t = state.runtimeInstances.find(i => i.attrs === attrsObj)
  return t ? t.varName : ''
}

// 设置引用槽：把目标实例的 attrs 对象绑定到 inst.attrs[ref]
function setReference(inst, refName, targetVarName) {
  if (!targetVarName) {
    inst.attrs[refName] = null
    return
  }
  const target = state.runtimeInstances.find(i => i.varName === targetVarName)
  inst.attrs[refName] = target ? target.attrs : null
}

// ============ Instance Panel ============
export function showNodePanel(inst) {
  state.panelUndoPushed = false
  state.selInstance = inst
  const cls = state.classes[inst.className]
  panelTitle.textContent = '编辑实例'
  let html = '<div class="panel-id">' + esc(inst.varName) + '</div>'
  html += '<div class="panel-sub">' + esc(inst.className) + '</div>'

  if (cls && cls.description) {
    html += '<div class="panel-sub" style="font-style:italic;margin:4px 0">' + esc(cls.description) + '</div>'
  }

  if (config.execMode === 'manual') {
    html += '<div id="propagate-row" style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button onclick="runPropagate(state.selNode.id)" style="flex:1;padding:5px;border:1px solid var(--tbtnb);background:var(--tbtn);border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;color:var(--ifc2)">▶ 传播</button>' +
      '</div>'
  }

  // 外观 - 颜色
  const color = state.visualState.colors[inst.varName] || '#1976d2'
  html += '<div class="prop-title" style="margin-top:4px">外观</div>' +
    '<div class="prop-row">' +
      '<span style="font-size:12px;color:var(--flbl);min-width:40px">颜色</span>' +
      '<input type="color" id="np-color" value="' + color + '" style="width:50px;height:28px;padding:0;border:1px solid var(--ibd);border-radius:4px;cursor:pointer">' +
      '<button class="btn-reset-color" style="padding:2px 8px;font-size:11px;border:1px solid var(--ibd);background:var(--ibg);border-radius:4px;cursor:pointer;color:var(--ifc)" onclick="resetNodeColor()">重置</button>' +
    '</div>'

  // varName 只读（v0.6 varName 不可改）
  html += '<div class="field"><span class="fl">变量名</span><input type="text" value="' + esc(inst.varName) + '" disabled style="opacity:0.6"></div>'

  if (cls) {
    html += '<div class="prop-title" style="margin-top:8px">属性</div><div id="props-cont"></div>'
  }

  html += '<button class="btn-del" onclick="delNode(selNode)">删除实例</button>'

  panelBody.innerHTML = html
  panel.classList.remove('hidden')

  // 渲染每个属性
  if (cls) {
    const cont = document.getElementById('props-cont')
    for (const propName of cls.properties) {
      const isRef = cls.references.includes(propName)
      const curVal = inst.attrs[propName]
      const row = document.createElement('div')
      row.className = 'field'
      if (isRef) {
        const curId = refValueToVarName(curVal)
        let opts = '<option value="">（无）</option>'
        for (const cand of state.runtimeInstances) {
          if (cand.varName === inst.varName) continue
          opts += '<option value="' + esc(cand.varName) + '"' + (cand.varName === curId ? ' selected' : '') + '>' +
            esc(cand.varName) + ' · ' + esc(cand.className) + '</option>'
        }
        row.innerHTML = '<span class="fl">' + esc(propName) + ' → （引用）</span>' +
          '<select id="np-ref-' + esc(propName) + '">' + opts + '</select>'
        cont.appendChild(row)
        row.querySelector('select').onchange = function() {
          if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
          setReference(inst, propName, this.value)
          syncCodeFromRuntime(); render(); triggerPropagate(inst.varName)
        }
      } else {
        const t = typeof curVal
        if (t === 'number') {
          row.innerHTML = '<span class="fl">' + esc(propName) + '</span>' +
            '<input type="number" step="any" id="np-attr-' + esc(propName) + '" value="' + esc(String(curVal)) + '">'
          cont.appendChild(row)
          row.querySelector('input').oninput = function() {
            if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
            const v = parseFloat(this.value)
            inst.attrs[propName] = isNaN(v) ? 0 : v
            syncCodeFromRuntime(); triggerPropagate(inst.varName)
          }
        } else if (t === 'boolean') {
          row.innerHTML = '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ifc)">' +
            '<input type="checkbox" id="np-attr-' + esc(propName) + '"' + (curVal ? ' checked' : '') + '> ' +
            esc(propName) + '</label>'
          cont.appendChild(row)
          row.querySelector('input').onchange = function() {
            if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
            inst.attrs[propName] = this.checked
            syncCodeFromRuntime(); triggerPropagate(inst.varName)
          }
        } else {
          row.innerHTML = '<span class="fl">' + esc(propName) + '</span>' +
            '<input type="text" id="np-attr-' + esc(propName) + '" value="' + esc(curVal == null ? '' : String(curVal)) + '">'
          cont.appendChild(row)
          row.querySelector('input').oninput = function() {
            if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
            inst.attrs[propName] = this.value
            syncCodeFromRuntime(); triggerPropagate(inst.varName)
          }
        }
      }
    }
  }

  // 颜色
  document.getElementById('np-color').oninput = function() {
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    state.visualState.colors[inst.varName] = this.value
    render(); save()
  }
  window.resetNodeColor = function() {
    const cur = state.selInstance
    if (!cur) return
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    delete state.visualState.colors[cur.varName]
    const inp = document.getElementById('np-color')
    if (inp) inp.value = '#1976d2'
    render(); save()
  }
}

// ============ Edge Panel ============
export function showEdgePanel(e) {
  state.panelUndoPushed = false
  state.selEdge = e
  panelTitle.textContent = '编辑边'
  const s = state.runtimeInstances.find(i => i.varName === e.source_instance)
  const t = state.runtimeInstances.find(i => i.varName === e.target_instance)
  panelBody.innerHTML =
    '<div class="panel-id">' + e.id + '</div>' +
    '<div class="panel-sub">' + (s ? esc(s.varName) : '') + '.' + esc(e.source_ref) + ' → ' +
      (t ? esc(t.varName) : '') + '.' + esc(e.target_attr) + '</div>' +
    '<div class="field"><span class="fl">标签</span><input type="text" id="ep-label" value="' + esc(e.label) + '"></div>' +
    '<div class="field"><span class="fl">关系符号</span><input type="text" id="ep-rel" value="' + esc(e.relation) + '" placeholder="+, -, ?, = 或自定义"></div>' +
    '<div class="field"><span class="fl">描述</span><textarea id="ep-desc">' + esc(e.description || '') + '</textarea></div>' +
    '<div class="field"><span class="fl">权重</span><input type="number" step="0.1" id="ep-wt" value="' + e.weight + '"></div>' +
    '<div class="panel-sub" style="margin-top:8px">边的元数据存储于源实例。删除边会清空源实例的引用槽 ' + esc(e.source_ref) + '。</div>' +
    '<button class="btn-del" onclick="delEdge(selEdge)">删除边</button>'
  panel.classList.remove('hidden')

  const flush = (patch) => {
    const src = state.runtimeInstances.find(i => i.varName === e.source_instance)
    if (!src) return
    const meta = {
      label: document.getElementById('ep-label').value,
      relation: document.getElementById('ep-rel').value,
      description: document.getElementById('ep-desc').value,
      weight: parseFloat(document.getElementById('ep-wt').value) || 0,
      ...patch,
    }
    Object.assign(e, meta)
    setEdgeMeta(src, e.target_instance, e.target_attr, meta)
    syncCodeFromRuntime()
  }
  document.getElementById('ep-label').oninput = function() {
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    flush({ label: this.value }); render()
  }
  document.getElementById('ep-rel').oninput = function() {
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    flush({ relation: this.value }); render()
  }
  document.getElementById('ep-desc').oninput = function() {
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    flush({ description: this.value })
  }
  document.getElementById('ep-wt').oninput = function() {
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    flush({ weight: parseFloat(this.value) || 0 })
  }
}

// 兼容别名
export { showNodePanel as showInstancePanel }
