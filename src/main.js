import { state, config } from './state.js'
import { render } from './renderer.js'
import { load, save, importSource, wrapInstance } from './io.js'
import { runSource } from './codegraph.js'
import { DEFAULT_BOOTSTRAP } from './bootstrap.js'
import { fitToView } from './physics.js'
import { loadConfig, applyTheme } from './config.js'
import { initInput } from './input.js'
import { fromB64 } from './utils.js'
import { mountCodeView } from './codeview.js'

export function resize() {
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth
  const h = window.innerHeight
  const canvas = document.getElementById('canvas')
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  render()
}

function init() {
  loadConfig()
  config.positionMode = 'manual'
  applyTheme()
  resize()

  let loaded = false
  const hash = location.hash.slice(1)
  if (hash) {
    try {
      const data = JSON.parse(fromB64(hash))
      importSource(data)
      save()
      loaded = true
    } catch (e) {
      console.warn('URL hash 解析失败', e)
    }
    history.replaceState(null, '', location.pathname)
  }
  if (!loaded) {
    loaded = load()
  }
  if (!loaded) {
    // 第一次启动：state.sourceCode 默认是 DEFAULT_BOOTSTRAP，但 runtimeInstances 为空 → runSource
    runSource(state.sourceCode, state)
    for (const inst of state.runtimeInstances) wrapInstance(inst)
    const titleEl = document.getElementById('title-text')
    if (titleEl) titleEl.textContent = state.graphTitle
  }

  fitToView()
  initInput()
  mountCodeView()
}

window.onresize = resize
init()
