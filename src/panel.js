// v0.9 panel：双模式（类型/实例）UI，实例级 edges 模型
//
// 类型模式：编辑 cls.description / cls.name / cls.attrs（无 edges）
// 实例模式：编辑 inst.attrs override + inst.attrs.edges 数组（每条边 target + description）
//
// panelMode 不入 sourceCode，存 state.panelMode[varName] 内存 map
// Code 模式：panel 全只读，segmented control 禁用，加/删按钮不显示

import { state, config } from './state.js'
import { render } from './renderer.js'
import { pushUndo, delInstance, delEdge } from './editor.js'
import { save, syncCodeFromRuntime } from './io.js'
import { propagate } from './engine.js'
import { esc } from './utils.js'
import { _equal } from './codegraph.js'
import { showModal } from './input.js'

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

function getPanelMode(varName) {
  return state.panelMode[varName] === 'type' ? 'type' : 'instance'
}

// 类型模式默认值传播——改 cls.attrs[key] 后，
// 同 class 的未 override 实例（attrs[key] deep-equal 旧 default）自动同步
function propagateDefaultChange(cls, key, oldDefault, newDefault) {
  for (const other of state.runtimeInstances) {
    if (other.className !== cls.id) continue
    if (_equal(other.attrs[key], oldDefault)) {
      other.attrs[key] = (newDefault !== null && typeof newDefault === 'object')
        ? JSON.parse(JSON.stringify(newDefault)) : newDefault
    }
  }
}

function refValueToVarName(attrsObj) {
  if (!attrsObj || typeof attrsObj !== 'object') return ''
  const t = state.runtimeInstances.find(i => i.attrs === attrsObj)
  return t ? t.varName : ''
}

// v0.9 边操作（实例级 attrs.edges 数组）
function getInstanceEdges(inst) {
  if (!Array.isArray(inst.attrs.edges)) inst.attrs.edges = []
  return inst.attrs.edges
}

function setEdgeTarget(inst, idx, targetVarName) {
  const edges = getInstanceEdges(inst)
  if (idx < 0 || idx >= edges.length) return
  if (!targetVarName) {
    edges[idx].target = null
    return
  }
  const target = state.runtimeInstances.find(i => i.varName === targetVarName)
  edges[idx].target = target ? target.attrs : null
}

function setEdgeDescription(inst, idx, description) {
  const edges = getInstanceEdges(inst)
  if (idx < 0 || idx >= edges.length) return
  edges[idx].description = description
}

export function setPanelMode(mode) {
  if (mode !== 'type' && mode !== 'instance') return
  if (state.editMode === 'code') return
  const cur = state.selInstance
  if (!cur) return
  state.panelMode[cur.varName] = mode
  showNodePanel(cur)
}
window.setPanelMode = setPanelMode

// ============ Instance/Type Panel ============
export function showNodePanel(inst, highlightRef) {
  state.panelUndoPushed = false
  state.selInstance = inst
  const cls = state.classes[inst.className]
  const codeMode = state.editMode === 'code'
  const mode = getPanelMode(inst.varName)
  const isType = mode === 'type'
  panelTitle.textContent = codeMode ? '查看实例（Code 模式只读）' :
    (isType ? '编辑类型（影响所有实例）' : '编辑实例')

  let html = '<div class="panel-id">' + esc(inst.varName) + '</div>'
  html += '<div class="panel-sub">' + esc(inst.className) + '</div>'

  const typeActive = isType ? ' active' : ''
  const instActive = !isType ? ' active' : ''
  const toggleDis = codeMode ? ' disabled' : ''
  html += '<div class="edit-mode-group panel-mode-toggle" style="margin:8px 0">' +
    '<button class="edit-mode-btn' + typeActive + '" data-pmode="type" onclick="setPanelMode(\'type\')"' + toggleDis + '>类型</button>' +
    '<button class="edit-mode-btn' + instActive + '" data-pmode="instance" onclick="setPanelMode(\'instance\')"' + toggleDis + '>实例</button>' +
    '</div>'

  if (isType && cls) {
    const cnt = state.runtimeInstances.filter(i => i.className === inst.className).length
    if (cnt > 1) {
      html += '<div class="panel-warn">⚠ 该 class 有 ' + cnt + ' 个实例，类型修改将影响全部</div>'
    }
  }

  // 描述区：类型模式编辑 cls.description；实例模式编辑 inst.attrs.description override
  const descVal = isType
    ? (cls ? (cls.description || '') : '')
    : ((inst.attrs.description != null) ? inst.attrs.description : (cls ? (cls.description || '') : ''))
  const descLabel = isType ? '类描述（class 默认）' : '节点描述（留空用 class 默认）'
  html += '<div class="field">' +
    '<span class="fl">' + esc(descLabel) + '</span>' +
    '<textarea id="np-desc"' + (codeMode ? ' disabled' : '') + '>' + esc(descVal) + '</textarea>' +
    '</div>'

  // 名称区：类型模式编辑 cls.name；实例模式编辑 inst.attrs.name override
  const nameVal = isType
    ? (cls ? (cls.name || '') : '')
    : ((inst.attrs.name != null) ? inst.attrs.name : (cls ? (cls.name || '') : ''))
  const nameLabel = isType ? '节点名称（class 默认）' : '节点名称（留空用 class 默认）'
  html += '<div class="field">' +
    '<span class="fl">' + esc(nameLabel) + '</span>' +
    '<input type="text" id="np-name" value="' + esc(nameVal) + '"' + (codeMode ? ' disabled' : '') + '>' +
    '</div>'

  if (!codeMode && config.execMode === 'manual' && !isType) {
    html += '<div id="propagate-row" style="display:flex;gap:6px;margin-bottom:8px">' +
      '<button onclick="runPropagate(state.selNode.id)" style="flex:1;padding:5px;border:1px solid var(--tbtnb);background:var(--tbtn);border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;color:var(--ifc2)">▶ 传播</button>' +
      '</div>'
  }

  // 外观 - 颜色（仅实例模式有意义；颜色是实例级）
  if (!isType) {
    const color = state.visualState.colors[inst.varName] || '#1976d2'
    html += '<div class="prop-title" style="margin-top:4px">外观</div>' +
      '<div class="prop-row">' +
        '<span style="font-size:12px;color:var(--flbl);min-width:40px">颜色</span>' +
        '<input type="color" id="np-color" value="' + color + '" style="width:50px;height:28px;padding:0;border:1px solid var(--ibd);border-radius:4px;cursor:pointer"' + (codeMode ? ' disabled' : '') + '>' +
        '<button class="btn-reset-color" style="padding:2px 8px;font-size:11px;border:1px solid var(--ibd);background:var(--ibg);border-radius:4px;cursor:pointer;color:var(--ifc)" onclick="resetNodeColor()"' + (codeMode ? ' disabled' : '') + '>重置</button>' +
      '</div>'
  }

  // varName 只读
  html += '<div class="field"><span class="fl">变量名</span><input type="text" value="' + esc(inst.varName) + '" disabled style="opacity:0.6"></div>'

  // 属性区
  if (cls) {
    const propSuffix = isType ? '（class 默认）' : '（实例 override）'
    html += '<div class="prop-title" style="margin-top:8px">属性' + esc(propSuffix) + '</div><div id="props-cont"></div>'
    if (!codeMode) {
      html += '<button class="btn-add-prop" onclick="addProperty()" style="margin-top:4px">+ 加属性</button>'
    }
  }

  // 边区（仅实例模式：边是实例级 attrs.edges 数组）
  if (cls && !isType) {
    html += '<div class="prop-title" style="margin-top:12px">输出边（指向其他实例）</div><div id="edges-cont"></div>'
    if (!codeMode) {
      html += '<button class="btn-add-prop" onclick="addInstanceEdge()" style="margin-top:4px">+ 加边</button>'
    }
  }

  if (!codeMode && !isType) {
    html += '<button class="btn-copy" onclick="copySelectedNode()">复制实例</button>'
    html += '<button class="btn-del" onclick="delNode(selNode)">删除实例</button>'
  }

  panelBody.innerHTML = html
  panel.classList.remove('hidden')

  // 渲染每个属性
  if (cls) {
    const cont = document.getElementById('props-cont')
    // 合并键并集：类型模式只看 cls.attrs；实例模式看 cls.attrs + inst.attrs
    const allKeys = isType
      ? Object.keys(cls.attrs || {}).filter(k => !k.startsWith('__') && k !== 'edges')
      : [...new Set([
          ...Object.keys(cls.attrs || {}).filter(k => !k.startsWith('__') && k !== 'edges'),
          ...Object.keys(inst.attrs).filter(k => !k.startsWith('__') && k !== 'edges'),
        ])]
    for (const propName of allKeys) {
      if (propName === 'name' || propName === 'description') continue
      _renderPropField({ propName, cont, inst, cls, codeMode, isType })
    }
  }

  // 实例模式：渲染边列表
  if (!isType && cls) {
    _renderEdgesList(inst, codeMode)
  }

  // handlers
  if (!codeMode) {
    if (!isType) {
      const colorInp = document.getElementById('np-color')
      if (colorInp) {
        colorInp.oninput = function() {
          if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
          state.visualState.colors[inst.varName] = this.value
          render(); save()
        }
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
    // name handler: 类型模式写 cls.name + 传播；实例模式写 attrs.name
    const nameInp = document.getElementById('np-name')
    if (nameInp) {
      nameInp.oninput = function() {
        if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
        if (isType && cls) {
          cls.name = this.value
        } else {
          inst.attrs.name = this.value
        }
        syncCodeFromRuntime(); render(); triggerPropagate(inst.varName)
      }
    }
    // description handler
    const descEl = document.getElementById('np-desc')
    if (descEl) {
      descEl.oninput = function() {
        if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
        if (isType && cls) {
          cls.description = this.value
        } else {
          inst.attrs.description = this.value
        }
        syncCodeFromRuntime(); render()
      }
    }
  }

  if (highlightRef) {
    const block = panelBody.querySelector('.edge-edit-block[data-edge-idx="' + highlightRef + '"]')
    if (block) {
      block.style.background = 'var(--addp-hbg)'
      block.scrollIntoView({ behavior: 'auto', block: 'center' })
    }
  }
}

// 属性字段渲染
function _renderPropField({ propName, cont, inst, cls, codeMode, isType }) {
  const curVal = isType ? cls.attrs[propName] : (inst.attrs[propName] !== undefined ? inst.attrs[propName] : cls.attrs[propName])
  const row = document.createElement('div')
  row.className = 'field'

  function writeVal(newVal) {
    if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
    if (isType) {
      const oldDefault = cls.attrs[propName]
      cls.attrs[propName] = newVal
      propagateDefaultChange(cls, propName, oldDefault, newVal)
    } else {
      inst.attrs[propName] = newVal
    }
    syncCodeFromRuntime(); render(); triggerPropagate(inst.varName)
  }

  const t = typeof curVal
  const labelSuffix = isType ? '（默认）' : ''
  const canDel = isType ? (propName in (cls.attrs || {})) : (inst.attrs[propName] !== undefined)
  const delBtn = (codeMode || !canDel) ? '' : '<button class="btn-del-prop" data-prop="' + esc(propName) + '" style="padding:2px 8px;font-size:11px;border:1px solid var(--delbd);background:var(--delb);color:var(--delc);border-radius:4px;cursor:pointer;margin-left:6px">删</button>'
  if (t === 'number') {
    row.innerHTML = '<span class="fl">' + esc(propName) + esc(labelSuffix) + '</span>' +
      '<div style="display:flex;align-items:center">' +
      '<input type="number" step="any" id="np-attr-' + esc(propName) + '" value="' + esc(String(curVal)) + '"' + (codeMode ? ' disabled' : '') + '>' +
      delBtn + '</div>'
    cont.appendChild(row)
    if (!codeMode) {
      row.querySelector('input').oninput = function() {
        const v = parseFloat(this.value)
        writeVal(isNaN(v) ? 0 : v)
      }
    }
  } else if (t === 'boolean') {
    row.innerHTML = '<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ifc)">' +
      '<input type="checkbox" id="np-attr-' + esc(propName) + '"' + (curVal ? ' checked' : '') + (codeMode ? ' disabled' : '') + '> ' +
      esc(propName) + esc(labelSuffix) + '</label>' + delBtn
    cont.appendChild(row)
    if (!codeMode) {
      row.querySelector('input').onchange = function() { writeVal(this.checked) }
    }
  } else {
    row.innerHTML = '<span class="fl">' + esc(propName) + esc(labelSuffix) + '</span>' +
      '<div style="display:flex;align-items:center">' +
      '<input type="text" id="np-attr-' + esc(propName) + '" value="' + esc(curVal == null ? '' : String(curVal)) + '"' + (codeMode ? ' disabled' : '') + ' style="flex:1">' +
      delBtn + '</div>'
    cont.appendChild(row)
    if (!codeMode) {
      row.querySelector('input').oninput = function() { writeVal(this.value) }
    }
  }
  if (!codeMode) {
    const del = row.querySelector('.btn-del-prop')
    if (del) del.onclick = function() { deleteProperty(this.dataset.prop) }
  }
}

// 渲染实例边列表（实例模式）：每条边 = target 下拉 + description 输入 + 删除按钮
function _renderEdgesList(inst, codeMode) {
  const cont = document.getElementById('edges-cont')
  if (!cont) return
  const edges = getInstanceEdges(inst)
  if (!edges.length) {
    cont.innerHTML = '<div style="font-size:11px;color:var(--flbl);opacity:0.7;padding:4px 0">（暂无输出边）</div>'
    return
  }
  cont.innerHTML = edges.map((e, i) => {
    const curId = refValueToVarName(e.target)
    let opts = '<option value="">（无）</option>'
    for (const cand of state.runtimeInstances) {
      if (cand.varName === inst.varName) continue
      opts += '<option value="' + esc(cand.varName) + '"' + (cand.varName === curId ? ' selected' : '') + '>' +
        esc(cand.varName) + ' · ' + esc(cand.className) + '</option>'
    }
    return '<div class="edge-edit-block" data-edge-idx="' + i + '" style="padding:8px;margin-bottom:6px;border:1px solid var(--propbd);border-radius:5px;background:var(--addpbg)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:11px;color:var(--flbl)">→ 目标</span>' +
        (codeMode ? '' : '<button class="btn-del-edge" data-edge-idx="' + i + '" style="padding:2px 8px;font-size:11px;border:1px solid var(--delbd);background:var(--delb);color:var(--delc);border-radius:4px;cursor:pointer">删除</button>') +
      '</div>' +
      '<select class="edge-target-sel" data-edge-idx="' + i + '"' + (codeMode ? ' disabled' : '') + ' style="width:100%;padding:4px 6px;border:1px solid var(--ibd);border-radius:4px;font-size:12px;background:var(--ibg);color:var(--ifc);margin-bottom:4px">' + opts + '</select>' +
      '<input type="text" class="edge-desc-input" data-edge-idx="' + i + '" value="' + esc(e.description || '') + '"' + (codeMode ? ' disabled' : '') + ' style="width:100%;padding:4px 6px;border:1px solid var(--ibd);border-radius:4px;font-size:12px;background:var(--ibg);color:var(--ifc)" placeholder="边描述（可选）">' +
    '</div>'
  }).join('')
  if (codeMode) return
  cont.querySelectorAll('.edge-target-sel').forEach(sel => {
    sel.onchange = function() {
      const idx = parseInt(this.dataset.edgeIdx)
      if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
      setEdgeTarget(inst, idx, this.value)
      syncCodeFromRuntime(); render(); triggerPropagate(inst.varName)
    }
  })
  cont.querySelectorAll('.edge-desc-input').forEach(inp => {
    inp.oninput = function() {
      const idx = parseInt(this.dataset.edgeIdx)
      if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
      setEdgeDescription(inst, idx, this.value)
      syncCodeFromRuntime(); render()
    }
  })
  cont.querySelectorAll('.btn-del-edge').forEach(btn => {
    btn.onclick = function() {
      const idx = parseInt(this.dataset.edgeIdx)
      removeInstanceEdge(idx)
    }
  })
}

// 加属性（modal 收集 name + value）
export async function addProperty() {
  if (state.editMode === 'code') return
  const cur = state.selInstance
  if (!cur) return
  const cls = state.classes[cur.className]
  if (!cls) return
  const mode = getPanelMode(cur.varName)
  const isType = mode === 'type'
  // 收集已用 key（class attrs + 所有同 class 实例 attrs + 保留字）
  const reserved = new Set(['name', 'description', 'edges', 'constructor', 'prototype'])
  const used = new Set([
    ...Object.keys(cls.attrs || {}),
    ...(isType ? [] : Object.keys(cur.attrs)),
  ])
  const values = await showModal({
    title: isType ? '加 class 默认属性' : '加实例属性',
    submitLabel: '加',
    fields: [
      {
        name: 'key',
        label: '属性名',
        type: 'text',
        default: '',
        validate: v => {
          if (!v.trim()) return '不能为空'
          if (reserved.has(v)) return v + ' 是保留字'
          if (used.has(v)) return '与现有属性冲突'
          return null
        },
      },
      {
        name: 'value',
        label: '值（数字 / true/false / 字符串；空表示 null）',
        type: 'text',
        default: '',
      },
    ],
  })
  if (!values) return
  pushUndo()
  // 解析 value
  let parsed = null
  const raw = values.value.trim()
  if (raw !== '') {
    if (raw === 'true') parsed = true
    else if (raw === 'false') parsed = false
    else if (!isNaN(Number(raw)) && raw !== '') parsed = Number(raw)
    else parsed = raw
  }
  if (isType) {
    cls.attrs[values.key] = parsed
    // 同 class 实例：如果没 override，预填默认值（保持一致）
    for (const other of state.runtimeInstances) {
      if (other.className !== cls.id) continue
      if (!(values.key in other.attrs)) other.attrs[values.key] = parsed
    }
  } else {
    cur.attrs[values.key] = parsed
  }
  syncCodeFromRuntime(); render()
  showNodePanel(cur, values.key)
}

// 删属性
export function deleteProperty(propName) {
  if (state.editMode === 'code') return
  const cur = state.selInstance
  if (!cur) return
  const cls = state.classes[cur.className]
  if (!cls) return
  const mode = getPanelMode(cur.varName)
  const isType = mode === 'type'
  pushUndo()
  if (isType) {
    delete cls.attrs[propName]
    // 同 class 实例：如果 attrs[propName] 等于刚删的默认值，也清掉（用户期待"删除"语义）
    for (const other of state.runtimeInstances) {
      if (other.className !== cls.id) continue
      delete other.attrs[propName]
    }
  } else {
    delete cur.attrs[propName]
  }
  syncCodeFromRuntime(); render()
  showNodePanel(cur)
}

// 加边（实例模式）：弹 modal 收集 target + description，push 到 inst.attrs.edges
export async function addInstanceEdge() {
  if (state.editMode === 'code') return
  const cur = state.selInstance
  if (!cur) return
  const candidates = state.runtimeInstances
    .filter(i => i.varName !== cur.varName)
    .map(i => i.varName)
  if (!candidates.length) {
    alert('没有其他实例可作为目标')
    return
  }
  const values = await showModal({
    title: '加输出边',
    submitLabel: '加',
    fields: [
      {
        name: 'target',
        label: '目标实例',
        type: 'datalist',
        options: candidates,
        default: candidates[0],
        validate: v => candidates.includes(v) ? null : '请选现有实例',
      },
      { name: 'description', label: '描述（可选）', type: 'text', default: '' },
    ],
  })
  if (!values) return
  pushUndo()
  const target = state.runtimeInstances.find(i => i.varName === values.target)
  if (!Array.isArray(cur.attrs.edges)) cur.attrs.edges = []
  cur.attrs.edges.push({ target: target ? target.attrs : null, description: values.description })
  syncCodeFromRuntime(); render()
  showNodePanel(cur)
}

// 删除实例边（按 idx）
export function removeInstanceEdge(idx) {
  if (state.editMode === 'code') return
  const cur = state.selInstance
  if (!cur) return
  const edges = getInstanceEdges(cur)
  if (idx < 0 || idx >= edges.length) return
  pushUndo()
  edges.splice(idx, 1)
  if (edges.length === 0) delete cur.attrs.edges
  syncCodeFromRuntime(); render()
  showNodePanel(cur)
}

window.addProperty = addProperty
window.deleteProperty = deleteProperty
window.addInstanceEdge = addInstanceEdge
window.removeInstanceEdge = removeInstanceEdge

// 兼容别名
export { showNodePanel as showInstancePanel }
