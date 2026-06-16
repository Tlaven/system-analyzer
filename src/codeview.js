// v0.6 代码编辑器：CodeMirror 6 wrapper
//
// 角色：sourceCode 的唯一编辑入口（class 定义 + 启动代码）
//
// 数据流：
//   用户输入 → debounce 400ms → commitCode → runSource → save + render
//   panel 改属性 → syncCodeFromRuntime → dispatch sa-source-updated → refreshFromState
//
// 错误处理：sourceCode 语法错误时，runSource 抛异常，编辑器保留用户输入（让用户继续改），
// runtimeInstances 不更新（保持上一次成功状态）。

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { state } from './state.js'
import { runSource } from './codegraph.js'
import { wrapInstance, save } from './io.js'
import { render } from './renderer.js'
import { pushUndo } from './editor.js'

let editor = null
let debounceTimer = null
let lastAppliedCode = null
let errorMarker = null

export function mountCodeView() {
  const container = document.getElementById('code-panel-body')
  if (!container) {
    console.warn('[codeview] #code-panel-body 不存在')
    return
  }
  if (editor) return

  editor = new EditorView({
    state: EditorState.create({
      doc: state.sourceCode,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        javascript(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            commitCode(editor.state.doc.toString())
          }, 400)
        }),
      ],
    }),
    parent: container,
  })
  lastAppliedCode = state.sourceCode

  // 监听 sa-source-updated 事件（panel/serialize 触发）→ 同步编辑器
  window.addEventListener('sa-source-updated', refreshFromState)
}

export function setCode(code) {
  if (!editor) return
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: code },
  })
  lastAppliedCode = code
}

export function getCode() {
  return editor ? editor.state.doc.toString() : ''
}

// state.sourceCode 变化时同步到编辑器（去重：避免反馈循环）
export function refreshFromState() {
  if (!editor) return
  const cur = state.sourceCode
  if (cur === lastAppliedCode) return  // 已应用
  const editorCur = editor.state.doc.toString()
  if (cur === editorCur) { lastAppliedCode = cur; return }  // 编辑器已是这个值
  setCode(cur)
}

// 用户输入触发：try runSource，成功才更新 state.sourceCode + runtimeInstances
function commitCode(code) {
  if (code === lastAppliedCode) return
  pushUndo()
  try {
    runSource(code, state)
    for (const inst of state.runtimeInstances) wrapInstance(inst)
    state.sourceCode = code
    lastAppliedCode = code
    clearError()
    save()
    render()
  } catch (e) {
    showError(e.message)
    // 保留 state.sourceCode = 上次成功的；编辑器内容保留用户输入
    // 用户继续改对后会成功
  }
}

function showError(msg) {
  const err = document.getElementById('code-panel-error')
  if (err) {
    err.textContent = '⚠ ' + msg
    err.classList.remove('hidden')
  }
}

function clearError() {
  const err = document.getElementById('code-panel-error')
  if (err) {
    err.textContent = ''
    err.classList.add('hidden')
  }
}

export function toggleCodeView() {
  const panel = document.getElementById('code-panel')
  if (!panel) return
  panel.classList.toggle('hidden')
  if (!panel.classList.contains('hidden')) {
    refreshFromState()
  }
}

// 显式提交（按 Ctrl+Enter 等）
export function commitCodeNow() {
  clearTimeout(debounceTimer)
  commitCode(getCode())
}
