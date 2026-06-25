// v0.13: 从 input.js 抽出。input.js 是事件层(panel/click/drag),
// showModal 是 UI 原语(模态对话框)。panel.js 也需要弹模态(添加属性/边),
// 原本 panel→input 反向 import showModal 是设计异味,本文件斩断那条箭头。
//
// showModal 是纯 DOM 函数,不依赖任何 module-level state。唯一外部契约是
// window.__sa_test.modalPrefill(e2e 测试钩子,可预填表单值绕过交互)。

window.__sa_test = window.__sa_test || {}

// 通用 modal:返回 Promise<values | null>(取消时 null)
// fields: [{ name, label, type: 'text'|'datalist', default, options?, validate? }]
//   validate(value, allValues) 返回字符串错误信息或 null
// 测试钩子:设置 window.__sa_test.modalPrefill = { fieldName: value, ... } 可绕过 UI 直接返回预填值
export function showModal({ title, fields, submitLabel = '确定' }) {
  // 测试钩子:绕过 UI
  if (window.__sa_test.modalPrefill) {
    const prefill = window.__sa_test.modalPrefill
    window.__sa_test.modalPrefill = null
    for (const f of fields) {
      const v = prefill[f.name]
      if (v === undefined) continue
      const err = f.validate ? f.validate(v, prefill) : null
      if (err) return Promise.resolve(null)
    }
    return Promise.resolve(prefill)
  }
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    const box = document.createElement('div')
    box.className = 'modal-box'
    box.style.width = '380px'

    const titleEl = document.createElement('div')
    titleEl.textContent = title
    titleEl.style.cssText = 'font-size:15px;font-weight:600;color:var(--pnlhd);margin-bottom:14px'
    box.appendChild(titleEl)

    const inputs = {}
    const errorEls = {}
    for (const f of fields) {
      const wrap = document.createElement('div')
      wrap.className = 'field'
      const lbl = document.createElement('span')
      lbl.className = 'fl'
      lbl.textContent = f.label
      wrap.appendChild(lbl)

      let input
      if (f.type === 'datalist') {
        const listId = 'modal-datalist-' + f.name + '-' + Date.now()
        const dl = document.createElement('datalist')
        dl.id = listId
        for (const opt of (f.options || [])) {
          const o = document.createElement('option')
          o.value = opt
          dl.appendChild(o)
        }
        document.body.appendChild(dl)
        input = document.createElement('input')
        input.type = 'text'
        input.setAttribute('list', listId)
      } else {
        input = document.createElement('input')
        input.type = 'text'
      }
      input.value = f.default || ''
      input.dataset.fieldName = f.name
      wrap.appendChild(input)
      inputs[f.name] = input

      const errEl = document.createElement('div')
      errEl.style.cssText = 'font-size:11px;color:#e53935;margin-top:3px;min-height:14px'
      errorEls[f.name] = errEl
      wrap.appendChild(errEl)

      box.appendChild(wrap)
    }

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px'
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.style.cssText = 'padding:6px 16px;border:1px solid var(--tbtnb);background:var(--tbtn);border-radius:5px;cursor:pointer;font-size:13px;font-family:inherit;color:var(--tbtnc)'
    const submitBtn = document.createElement('button')
    submitBtn.textContent = submitLabel
    submitBtn.className = 'btn-primary'
    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(submitBtn)
    box.appendChild(btnRow)

    overlay.appendChild(box)
    document.body.appendChild(overlay)

    let settled = false
    const cleanup = () => {
      document.body.removeChild(overlay)
      // 清理可能添加的 datalist
      document.querySelectorAll('datalist[id^="modal-datalist-"]').forEach(dl => dl.remove())
    }
    const finish = (val) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(val)
    }
    const attemptSubmit = () => {
      const values = {}
      let firstErrField = null
      for (const f of fields) {
        const v = inputs[f.name].value.trim()
        values[f.name] = v
        let err = null
        if (f.validate) err = f.validate(v, values)
        errorEls[f.name].textContent = err || ''
        if (err && !firstErrField) firstErrField = inputs[f.name]
      }
      if (firstErrField) {
        firstErrField.focus()
        return
      }
      finish(values)
    }

    cancelBtn.onclick = () => finish(null)
    submitBtn.onclick = attemptSubmit
    overlay.onclick = e => { if (e.target === overlay) finish(null) }
    box.onclick = e => e.stopPropagation()

    // Enter 提交、Esc 取消
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); attemptSubmit() }
      else if (e.key === 'Escape') { e.preventDefault(); finish(null) }
    })

    // 焦点初始落在第一个字段
    setTimeout(() => {
      const first = inputs[fields[0].name]
      if (first) { first.focus(); first.select() }
    }, 0)
  })
}
