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
import { propagate, runTransforms } from './engine.js'
import { esc } from './utils.js'
import { getInstanceAttrKeys } from './attrkeys.js'
import { _equal, invalidateEdges } from './codegraph.js'
import { showModal } from './input.js'

const $ = s => document.querySelector(s)
const panel = $('#panel')

// panel session 内只 push 一次 undo。每次 showEdgePanel / showNodePanel 入口重置 panelUndoPushed=false。
function markUndo() {
  if (!state.panelUndoPushed) { pushUndo(); state.panelUndoPushed = true }
}
const panelTitle = $('#panel-title')
const panelBody = $('#panel-body')

let _propagateTimer
function triggerPropagate(varName) {
  clearTimeout(_propagateTimer)
  _propagateTimer = setTimeout(() => {
    if (config.execMode === 'auto') {
      propagate(varName); render()
    } else {
      // off / manual:transform 仍跑(ADR-003 OQ#2:transform 像 Excel formula)
      runTransforms(); render()
    }
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
    invalidateEdges()
    return
  }
  const target = state.runtimeInstances.find(i => i.varName === targetVarName)
  edges[idx].target = target ? target.attrs : null
  invalidateEdges()
}

function setEdgeDescription(inst, idx, description) {
  const edges = getInstanceEdges(inst)
  if (idx < 0 || idx >= edges.length) return
  edges[idx].description = description
  invalidateEdges()
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

// ============ Edge Panel(独立,跟 Node Panel 平级;ADR-003 OQ#1) ============
// edgeId 格式 `<srcVar>><tgtVar>>idx`,idx 是 source.attrs.edges 数组里的位置(io.js:46)。
// 渲染 description / source+target 属性列表提示 / transform textarea。
export function showEdgePanel(edgeId) {
  state.panelUndoPushed = false
  const parts = String(edgeId).split('>')
  if (parts.length < 3) return
  const srcVar = parts[0]
  const idx = parseInt(parts[parts.length - 1], 10)
  const srcInst = state.runtimeInstances.find(i => i.varName === srcVar)
  if (!srcInst) return
  const edges = Array.isArray(srcInst.attrs.edges) ? srcInst.attrs.edges : []
  const edge = edges[idx]
  if (!edge || !edge.target || typeof edge.target !== 'object') return
  const tgtInst = state.runtimeInstances.find(i => i.attrs === edge.target)
  if (!tgtInst) return

  state.selEdge = edgeId
  const codeMode = state.editMode === 'code'

  const srcCls = state.classes[srcInst.className]
  const tgtCls = state.classes[tgtInst.className]
  const srcLabel = srcInst.attrs.name || (srcCls && srcCls.name) || srcInst.className || srcInst.varName
  const tgtLabel = tgtInst.attrs.name || (tgtCls && tgtCls.name) || tgtInst.className || tgtInst.varName

  panelTitle.textContent = codeMode ? '查看边（Code 模式只读）' : '编辑边'
  let html = '<div class="panel-id">' + esc(srcInst.varName) + ' → ' + esc(tgtInst.varName) + '</div>'
  html += '<div class="panel-sub">' + esc(srcLabel) + ' → ' + esc(tgtLabel) + '</div>'

  const desc = (edge.description != null) ? edge.description : ''
  html += '<div class="field">' +
    '<span class="fl">边描述</span>' +
    '<input type="text" id="ep-desc" value="' + esc(desc) + '"' + (codeMode ? ' disabled' : '') + '>' +
    '</div>'

  const srcKeys = getInstanceAttrKeys(srcInst, { excludeMeta: true })
  const tgtKeys = getInstanceAttrKeys(tgtInst, { excludeMeta: true })
  html += '<div class="prop-title" style="margin-top:8px">属性引用提示（照抄 key 名）</div>'
  html += '<div class="panel-hint" style="font-size:11px;color:var(--flbl);margin:4px 0;font-family:monospace">source: ' + (srcKeys.length ? srcKeys.map(esc).join(' | ') : '(无)') + '</div>'
  html += '<div class="panel-hint" style="font-size:11px;color:var(--flbl);margin:4px 0;font-family:monospace">target: ' + (tgtKeys.length ? tgtKeys.map(esc).join(' | ') : '(无)') + '</div>'

  const transform = (typeof edge.transform === 'string') ? edge.transform : ''
  html += '<div class="field">' +
    '<span class="fl">transform(JS 语句片段,用 source[\'k\'] / target[\'k\'] 访问)</span>' +
    '<textarea id="ep-transform"' + (codeMode ? ' disabled' : '') + ' placeholder="target[\'Y\'] = source[\'X\'] * 0.02" style="font-family:monospace;font-size:12px;min-height:80px">' + esc(transform) + '</textarea>' +
    '</div>'
  // v0.11: transform 错误显示区(无条件渲染,oninput 时原地更新避免丢 textarea focus)
  const terr = edge._transformError
  const terrStyle = 'color:#e53935;font-family:monospace;font-size:11px;white-space:pre-wrap;margin-top:4px' + (terr ? '' : ';display:none')
  html += '<div id="ep-terr" style="' + terrStyle + '">' + (terr ? '⚠ ' + esc(terr) : '') + '</div>'

  if (!codeMode) {
    html += '<button class="btn-del" onclick="delCurrentEdge()" style="margin-top:8px">删除边</button>'
  }

  panelBody.innerHTML = html
  panel.classList.remove('hidden')

  if (!codeMode) {
    const descInp = document.getElementById('ep-desc')
    if (descInp) {
      descInp.oninput = function() {
        markUndo()
        edge.description = this.value
        syncCodeFromRuntime(); render()
      }
    }
    const transformEl = document.getElementById('ep-transform')
    if (transformEl) {
      transformEl.oninput = () => _onTransformInput(transformEl, edge)
      _attachTransformAutocomplete(transformEl, edge, srcInst, tgtInst)
    }
    window.delCurrentEdge = function() {
      markUndo()
      const arr = srcInst.attrs.edges
      if (Array.isArray(arr) && idx >= 0 && idx < arr.length) arr.splice(idx, 1)
      state.selEdge = null
      invalidateEdges()
      syncCodeFromRuntime(); render(); hidePanel()
    }
  }
}
window.showEdgePanel = showEdgePanel

// v0.12: transform oninput handler(autocomplete 插入后复用,保证与手敲行为一致)
// v0.11 focus 契约:原地更新 #ep-terr,不 re-render panel,保留 textarea focus + 光标
function _onTransformInput(textarea, edge) {
  markUndo()
  edge.transform = textarea.value
  syncCodeFromRuntime()
  // 立即重算 transform(绕过 execMode,ADR-003 OQ#2:transform 像 Excel formula)
  runTransforms(); render()
  // v0.11: 原地更新错误显示
  const errEl = document.getElementById('ep-terr')
  if (errEl) {
    const msg = edge._transformError
    if (msg) {
      errEl.textContent = '⚠ ' + msg
      errEl.style.display = ''
    } else {
      errEl.style.display = 'none'
      errEl.textContent = ''
    }
  }
}

// v0.12: transform autocomplete —— 用户输入 source[' / target[' 时弹 key 列表
// 设计:保留原生 textarea(不换 CodeMirror),自写轻量 popup;popup + mirror 挂 panelBody 内
// 随 innerHTML 重建销毁(0 泄漏);坐标用 mirror div 测量 + getBoundingClientRect 差值
function _attachTransformAutocomplete(textarea, edge, srcInst, tgtInst) {
  if (state.editMode === 'code') return  // Code 模式 textarea disabled

  let popup = null
  let mirror = null
  let candidates = []
  let selectedIdx = 0
  let open = false

  // 检测光标位置:在 source[' 或 target[' 内则返回 {which, partial, startPos};否则 null
  function detectTrigger() {
    const caret = textarea.selectionStart
    const before = textarea.value.slice(0, caret)
    const m = before.match(/(source|target)\s*\[\s*['"]([^'"\[]*)$/)
    if (!m) return null
    const partial = m[2]
    return {
      which: m[1],
      partial: partial,
      startPos: caret - partial.length,
    }
  }

  function buildCandidates(which, partial) {
    const inst = which === 'source' ? srcInst : tgtInst
    return getInstanceAttrKeys(inst, { excludeMeta: true }).filter(k => k.startsWith(partial))
  }

  function ensureMirror() {
    if (mirror && mirror.parentNode) return mirror
    mirror = document.createElement('div')
    mirror.id = 'ep-transform-mirror'
    const cs = getComputedStyle(textarea)
    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.top = '0'
    mirror.style.left = '0'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    mirror.style.fontFamily = cs.fontFamily
    mirror.style.fontSize = cs.fontSize
    mirror.style.lineHeight = cs.lineHeight
    mirror.style.padding = cs.padding
    mirror.style.border = cs.border
    mirror.style.boxSizing = cs.boxSizing
    mirror.style.width = textarea.clientWidth + 'px'
    panelBody.appendChild(mirror)
    return mirror
  }

  function getCaretCoords() {
    const m = ensureMirror()
    m.textContent = ''
    m.appendChild(document.createTextNode(textarea.value.slice(0, textarea.selectionStart)))
    const marker = document.createElement('span')
    marker.textContent = '​'
    m.appendChild(marker)
    const panelRect = panel.getBoundingClientRect()
    const taRect = textarea.getBoundingClientRect()
    const cs = getComputedStyle(textarea)
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) || 16
    return {
      x: (taRect.left - panelRect.left) + marker.offsetLeft,
      y: (taRect.top - panelRect.top) + marker.offsetTop + lineHeight + 2,
    }
  }

  function closePopup() {
    if (popup) { popup.remove(); popup = null }
    if (mirror) { mirror.remove(); mirror = null }
    open = false
    candidates = []
    selectedIdx = 0
  }

  function renderPopup(trigger) {
    candidates = buildCandidates(trigger.which, trigger.partial)
    if (!candidates.length) { closePopup(); return }
    if (!popup) {
      popup = document.createElement('div')
      popup.id = 'ep-ac-popup'
      popup.addEventListener('mousedown', e => e.preventDefault())  // 阻止 textarea 失焦
      panelBody.appendChild(popup)
    }
    selectedIdx = 0
    popup.innerHTML = candidates.map((k, i) =>
      '<div class="ep-ac-item' + (i === 0 ? ' sel' : '') + '" data-idx="' + i + '">' + esc(k) + '</div>'
    ).join('')
    Array.from(popup.querySelectorAll('.ep-ac-item')).forEach((el, i) => {
      el.addEventListener('mousedown', e => {
        e.preventDefault()
        selectedIdx = i
        insertSelected()
      })
    })
    const coords = getCaretCoords()
    popup.style.left = coords.x + 'px'
    popup.style.top = coords.y + 'px'
    open = true
  }

  function moveSel(delta) {
    if (!candidates.length) return
    selectedIdx = (selectedIdx + delta + candidates.length) % candidates.length
    Array.from(popup.children).forEach((el, i) => {
      el.classList.toggle('sel', i === selectedIdx)
    })
    const sel = popup.children[selectedIdx]
    if (sel) sel.scrollIntoView({ block: 'nearest' })
  }

  function insertSelected() {
    if (!open || !candidates.length) { closePopup(); return }
    const trigger = detectTrigger()
    if (!trigger) { closePopup(); return }
    const key = candidates[selectedIdx]
    const caret = textarea.selectionStart
    textarea.value = textarea.value.slice(0, trigger.startPos) + key + "']" + textarea.value.slice(caret)
    const newCaret = trigger.startPos + key.length + 2  // 跳过 key + ']
    textarea.setSelectionRange(newCaret, newCaret)
    closePopup()
    _onTransformInput(textarea, edge)  // 与手敲走同一路径:runTransforms + 原地错误更新
  }

  function refresh() {
    const trigger = detectTrigger()
    if (!trigger) { closePopup(); return }
    if (open) {
      // popup 已开,只刷新候选(保留选中索引到合法范围)
      const next = buildCandidates(trigger.which, trigger.partial)
      if (!next.length) { closePopup(); return }
      candidates = next
      if (selectedIdx >= candidates.length) selectedIdx = 0
      if (popup) {
        popup.innerHTML = candidates.map((k, i) =>
          '<div class="ep-ac-item' + (i === selectedIdx ? ' sel' : '') + '" data-idx="' + i + '">' + esc(k) + '</div>'
        ).join('')
        Array.from(popup.querySelectorAll('.ep-ac-item')).forEach((el, i) => {
          el.addEventListener('mousedown', e => {
            e.preventDefault()
            selectedIdx = i
            insertSelected()
          })
        })
        const coords = getCaretCoords()
        popup.style.left = coords.x + 'px'
        popup.style.top = coords.y + 'px'
      }
    } else {
      renderPopup(trigger)
    }
  }

  textarea.addEventListener('input', refresh)
  textarea.addEventListener('click', refresh)
  textarea.addEventListener('keydown', e => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertSelected() }
    else if (e.key === 'Escape') { e.preventDefault(); closePopup() }
  })
  textarea.addEventListener('blur', () => setTimeout(closePopup, 150))

  window.__epAutocompleteState = () => ({
    open,
    candidates: candidates.slice(),
    selected: selectedIdx,
  })
}

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
      ? getInstanceAttrKeys(cls)
      : [...new Set([
          ...getInstanceAttrKeys(cls),
          ...getInstanceAttrKeys(inst),
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
          markUndo()
          state.visualState.colors[inst.varName] = this.value
          render(); save()
        }
      }
      window.resetNodeColor = function() {
        const cur = state.selInstance
        if (!cur) return
        markUndo()
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
        markUndo()
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
        markUndo()
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
    markUndo()
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
      markUndo()
      setEdgeTarget(inst, idx, this.value)
      syncCodeFromRuntime(); render(); triggerPropagate(inst.varName)
    }
  })
  cont.querySelectorAll('.edge-desc-input').forEach(inp => {
    inp.oninput = function() {
      const idx = parseInt(this.dataset.edgeIdx)
      markUndo()
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
  invalidateEdges()
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
  invalidateEdges()
  syncCodeFromRuntime(); render()
  showNodePanel(cur)
}

window.addProperty = addProperty
window.deleteProperty = deleteProperty
window.addInstanceEdge = addInstanceEdge
window.removeInstanceEdge = removeInstanceEdge

// 兼容别名
export { showNodePanel as showInstancePanel }
