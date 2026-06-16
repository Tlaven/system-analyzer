// Polyfill
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (r > w / 2) r = w / 2
    if (r > h / 2) r = h / 2
    this.moveTo(x + r, y)
    this.arcTo(x + w, y, x + w, y + h, r)
    this.arcTo(x + w, y + h, x, y + h, r)
    this.arcTo(x, y + h, x, y, r)
    this.arcTo(x, y, x + w, y, r)
    return this
  }
}

// Constants
export const NODE_MIN_W = 120, NODE_MAX_W = 240, NODE_H = 52
export const NODE_RADIUS = 8, NODE_PAD = 16
export const PORT_R = 6, PORT_HIT = 10, ARROW_SZ = 10, EDGE_HIT = 12, DRAG_TH = 4
export const MAX_UNDO = 50
export const PALETTES = {
  classic: {
    name: '经典',
    light: { bg: '#fafafa', grid: 'rgba(0,0,0,0.06)', nodeBg: '#fff', nodeBorder: '#d0d0d0', text: '#333', text2: '#555', text3: '#888', edge: '#666', accent: '#1976d2', css: {
      '--bg':'#fafafa','--tlbg':'rgba(255,255,255,.92)','--tlbdr':'#e0e0e0','--tbtn':'#fff','--tbtnb':'#d0d0d0','--tbtnc':'#444','--tbtn-hbg':'#eef6ff','--tbtn-hb':'#90caf9','--tbtn-hc':'#1565c0','--tsep':'#e0e0e0','--ttext':'#888','--tthov':'#f0f0f0','--pnl':'#fff','--pnls':'rgba(0,0,0,.08)','--pnlhd':'#222','--pnlcl':'#aaa','--pnlch':'#666','--flbl':'#888','--ibg':'#fff','--ibd':'#ddd','--ifc':'#333','--ifc2':'#1976d2','--propbd':'#e0e0e0','--propbtn':'#fff','--propbtc':'#999','--propbt-hbg':'#fff0f0','--propbt-hb':'#ef9a9a','--propbt-hc':'#e53935','--addpbg':'#fafafa','--addpbd':'#ddd','--addp-hbg':'#f0f4ff','--addp-hb':'#90caf9','--addp-hc':'#1976d2','--delb':'#fff','--delbd':'#e57373','--delc':'#e57373','--del-hbg':'#fff5f5','--pid':'#bbb','--psubbg':'#f8f8f8','--psubc':'#999','--eh':'#bbb','--ehkbg':'#f0f0f0','--ehkbd':'#e0e0e0','--tinpbg':'#fff','--accent':'#1976d2',
    }},
    dark: { bg: '#1a1a2e', grid: 'rgba(255,255,255,0.06)', nodeBg: '#2a2a3e', nodeBorder: '#555', text: '#e0e0e0', text2: '#ccc', text3: '#999', edge: '#aaa', accent: '#64b5f6', css: {
      '--bg':'#1a1a2e','--tlbg':'rgba(30,30,50,.95)','--tlbdr':'#333','--tbtn':'#2a2a3e','--tbtnb':'#555','--tbtnc':'#ccc','--tbtn-hbg':'#333','--tbtn-hb':'#64b5f6','--tbtn-hc':'#64b5f6','--tsep':'#444','--ttext':'#888','--tthov':'#333','--pnl':'#222','--pnls':'rgba(0,0,0,.4)','--pnlhd':'#ddd','--pnlcl':'#666','--pnlch':'#999','--flbl':'#999','--ibg':'#333','--ibd':'#555','--ifc':'#ddd','--ifc2':'#64b5f6','--propbd':'#555','--propbtn':'#333','--propbtc':'#999','--propbt-hbg':'#3a2a2a','--propbt-hb':'#c62828','--propbt-hc':'#ef5350','--addpbg':'#2a2a3e','--addpbd':'#555','--addp-hbg':'#333','--addp-hb':'#64b5f6','--addp-hc':'#64b5f6','--delb':'#2a2a3e','--delbd':'#c62828','--delc':'#ef5350','--del-hbg':'#3a2020','--pid':'#666','--psubbg':'#2a2a3e','--psubc':'#999','--eh':'#666','--ehkbg':'#333','--ehkbd':'#555','--tinpbg':'#333','--accent':'#64b5f6',
    }},
  },
  ocean: {
    name: '海洋',
    light: { bg: '#f0f8ff', grid: 'rgba(0,0,0,0.05)', nodeBg: '#fff', nodeBorder: '#90caf9', text: '#2c3e50', text2: '#546e7a', text3: '#90a4ae', edge: '#42a5f5', accent: '#0288d1', css: {
      '--bg':'#e8f4fc','--tlbg':'rgba(232,244,252,.95)','--tlbdr':'#b0d4f1','--tbtn':'#dceefb','--tbtnb':'#90caf9','--tbtnc':'#1565c0','--tbtn-hbg':'#c5e3f8','--tbtn-hb':'#42a5f5','--tbtn-hc':'#0d47a1','--tsep':'#b0d4f1','--ttext':'#546e7a','--tthov':'#c5e3f8','--pnl':'#eef6fc','--pnls':'rgba(2,136,209,.1)','--pnlhd':'#0d47a1','--pnlcl':'#64b5f6','--pnlch':'#1565c0','--flbl':'#607d8b','--ibg':'#eef6fc','--ibd':'#90caf9','--ifc':'#263238','--ifc2':'#0288d1','--propbd':'#b0d4f1','--propbtn':'#eef6fc','--propbtc':'#78909c','--propbt-hbg':'#fce4ec','--propbt-hb':'#ef9a9a','--propbt-hc':'#c62828','--addpbg':'#e3f2fd','--addpbd':'#90caf9','--addp-hbg':'#bbdefb','--addp-hb':'#42a5f5','--addp-hc':'#1565c0','--delb':'#eef6fc','--delbd':'#ef9a9a','--delc':'#c62828','--del-hbg':'#fce4ec','--pid':'#90a4ae','--psubbg':'#e3f2fd','--psubc':'#607d8b','--eh':'#90a4ae','--ehkbg':'#e3f2fd','--ehkbd':'#b0d4f1','--tinpbg':'#eef6fc','--accent':'#0288d1',
    }},
    dark: { bg: '#0d1b2a', grid: 'rgba(255,255,255,0.05)', nodeBg: '#1b263b', nodeBorder: '#415a77', text: '#e0e6ed', text2: '#b0bec5', text3: '#78909c', edge: '#64b5f6', accent: '#00acc1', css: {
      '--bg':'#0d1b2a','--tlbg':'rgba(13,27,42,.95)','--tlbdr':'#415a77','--tbtn':'#1b263b','--tbtnb':'#415a77','--tbtnc':'#b0bec5','--tbtn-hbg':'#1b2a41','--tbtn-hb':'#00acc1','--tbtn-hc':'#4dd0e1','--tsep':'#415a77','--ttext':'#78909c','--tthov':'#1b2a41','--pnl':'#132139','--pnls':'rgba(0,0,0,.5)','--pnlhd':'#b0bec5','--pnlcl':'#546e7a','--pnlch':'#90a4ae','--flbl':'#78909c','--ibg':'#1b2a41','--ibd':'#415a77','--ifc':'#cfd8dc','--ifc2':'#00acc1','--propbd':'#415a77','--propbtn':'#1b2a41','--propbtc':'#78909c','--propbt-hbg':'#3a1a1a','--propbt-hb':'#c62828','--propbt-hc':'#ef5350','--addpbg':'#1b2a41','--addpbd':'#415a77','--addp-hbg':'#1a3040','--addp-hb':'#00acc1','--addp-hc':'#4dd0e1','--delb':'#1b2a41','--delbd':'#c62828','--delc':'#ef5350','--del-hbg':'#3a1a1a','--pid':'#546e7a','--psubbg':'#1b2a41','--psubc':'#78909c','--eh':'#546e7a','--ehkbg':'#1b2a41','--ehkbd':'#415a77','--tinpbg':'#1b2a41','--accent':'#00acc1',
    }},
  },
  forest: {
    name: '森林',
    light: { bg: '#f5f5f0', grid: 'rgba(0,0,0,0.05)', nodeBg: '#fff', nodeBorder: '#a5d6a7', text: '#2d3436', text2: '#636e72', text3: '#b2bec3', edge: '#6d4c41', accent: '#2e7d32', css: {
      '--bg':'#f1f5eb','--tlbg':'rgba(241,245,235,.95)','--tlbdr':'#a5d6a7','--tbtn':'#e8f0df','--tbtnb':'#a5d6a7','--tbtnc':'#2e7d32','--tbtn-hbg':'#d7e8cc','--tbtn-hb':'#66bb6a','--tbtn-hc':'#1b5e20','--tsep':'#a5d6a7','--ttext':'#636e72','--tthov':'#d7e8cc','--pnl':'#f0f7eb','--pnls':'rgba(46,125,50,.1)','--pnlhd':'#1b5e20','--pnlcl':'#81c784','--pnlch':'#388e3c','--flbl':'#6d8a6e','--ibg':'#f0f7eb','--ibd':'#a5d6a7','--ifc':'#2d3436','--ifc2':'#2e7d32','--propbd':'#c8e6c9','--propbtn':'#f0f7eb','--propbtc':'#81c784','--propbt-hbg':'#fce4ec','--propbt-hb':'#ef9a9a','--propbt-hc':'#c62828','--addpbg':'#e8f0df','--addpbd':'#a5d6a7','--addp-hbg':'#d7e8cc','--addp-hb':'#66bb6a','--addp-hc':'#2e7d32','--delb':'#f0f7eb','--delbd':'#ef9a9a','--delc':'#c62828','--del-hbg':'#fce4ec','--pid':'#a5d6a7','--psubbg':'#e8f0df','--psubc':'#6d8a6e','--eh':'#a5d6a7','--ehkbg':'#e8f0df','--ehkbd':'#c8e6c9','--tinpbg':'#f0f7eb','--accent':'#2e7d32',
    }},
    dark: { bg: '#1b2a1b', grid: 'rgba(255,255,255,0.05)', nodeBg: '#2d3b2d', nodeBorder: '#4a6741', text: '#e0e6e0', text2: '#a5d6a7', text3: '#81c784', edge: '#8d9f8d', accent: '#66bb6a', css: {
      '--bg':'#1b2a1b','--tlbg':'rgba(27,42,27,.95)','--tlbdr':'#4a6741','--tbtn':'#2d3b2d','--tbtnb':'#4a6741','--tbtnc':'#a5d6a7','--tbtn-hbg':'#2a4025','--tbtn-hb':'#66bb6a','--tbtn-hc':'#81c784','--tsep':'#4a6741','--ttext':'#81c784','--tthov':'#2a4025','--pnl':'#243323','--pnls':'rgba(0,0,0,.5)','--pnlhd':'#a5d6a7','--pnlcl':'#4a6741','--pnlch':'#81c784','--flbl':'#81c784','--ibg':'#2a4025','--ibd':'#4a6741','--ifc':'#c8e6c9','--ifc2':'#66bb6a','--propbd':'#4a6741','--propbtn':'#2a4025','--propbtc':'#81c784','--propbt-hbg':'#3a1a1a','--propbt-hb':'#c62828','--propbt-hc':'#ef5350','--addpbg':'#2a4025','--addpbd':'#4a6741','--addp-hbg':'#2a4025','--addp-hb':'#66bb6a','--addp-hc':'#81c784','--delb':'#2a4025','--delbd':'#c62828','--delc':'#ef5350','--del-hbg':'#3a1a1a','--pid':'#4a6741','--psubbg':'#2a4025','--psubc':'#81c784','--eh':'#4a6741','--ehkbg':'#2a4025','--ehkbd':'#4a6741','--tinpbg':'#2a4025','--accent':'#66bb6a',
    }},
  },
  warm: {
    name: '暖橙',
    light: { bg: '#fff8f0', grid: 'rgba(0,0,0,0.06)', nodeBg: '#fff', nodeBorder: '#ffcc80', text: '#3e2723', text2: '#5d4037', text3: '#a1887f', edge: '#bf360c', accent: '#e65100', css: {
      '--bg':'#fef5e7','--tlbg':'rgba(254,245,231,.95)','--tlbdr':'#ffcc80','--tbtn':'#fde8d0','--tbtnb':'#ffcc80','--tbtnc':'#bf360c','--tbtn-hbg':'#fcdcb8','--tbtn-hb':'#ff9800','--tbtn-hc':'#e65100','--tsep':'#ffcc80','--ttext':'#8d6e63','--tthov':'#fcdcb8','--pnl':'#fef5e7','--pnls':'rgba(230,81,0,.1)','--pnlhd':'#bf360c','--pnlcl':'#ff8a65','--pnlch':'#e65100','--flbl':'#8d6e63','--ibg':'#fef5e7','--ibd':'#ffcc80','--ifc':'#3e2723','--ifc2':'#e65100','--propbd':'#ffcc80','--propbtn':'#fef5e7','--propbtc':'#a1887f','--propbt-hbg':'#fce4ec','--propbt-hb':'#ef9a9a','--propbt-hc':'#c62828','--addpbg':'#fde8d0','--addpbd':'#ffcc80','--addp-hbg':'#fcdcb8','--addp-hb':'#ff9800','--addp-hc':'#e65100','--delb':'#fef5e7','--delbd':'#ef9a9a','--delc':'#c62828','--del-hbg':'#fce4ec','--pid':'#ffcc80','--psubbg':'#fde8d0','--psubc':'#8d6e63','--eh':'#ffcc80','--ehkbg':'#fde8d0','--ehkbd':'#ffcc80','--tinpbg':'#fef5e7','--accent':'#e65100',
    }},
    dark: { bg: '#1a1210', grid: 'rgba(255,255,255,0.05)', nodeBg: '#2d2018', nodeBorder: '#6d4c41', text: '#efebe9', text2: '#bcaaa4', text3: '#8d6e63', edge: '#ff8a65', accent: '#ff7043', css: {
      '--bg':'#1a1210','--tlbg':'rgba(26,18,16,.95)','--tlbdr':'#6d4c41','--tbtn':'#2d2018','--tbtnb':'#6d4c41','--tbtnc':'#bcaaa4','--tbtn-hbg':'#3a2818','--tbtn-hb':'#ff7043','--tbtn-hc':'#ff8a65','--tsep':'#6d4c41','--ttext':'#8d6e63','--tthov':'#3a2818','--pnl':'#2d2018','--pnls':'rgba(0,0,0,.5)','--pnlhd':'#bcaaa4','--pnlcl':'#6d4c41','--pnlch':'#a1887f','--flbl':'#8d6e63','--ibg':'#3a2818','--ibd':'#6d4c41','--ifc':'#d7ccc8','--ifc2':'#ff7043','--propbd':'#6d4c41','--propbtn':'#3a2818','--propbtc':'#8d6e63','--propbt-hbg':'#3a1a1a','--propbt-hb':'#c62828','--propbt-hc':'#ef5350','--addpbg':'#3a2818','--addpbd':'#6d4c41','--addp-hbg':'#3a2818','--addp-hb':'#ff7043','--addp-hc':'#ff8a65','--delb':'#3a2818','--delbd':'#c62828','--delc':'#ef5350','--del-hbg':'#3a1a1a','--pid':'#6d4c41','--psubbg':'#3a2818','--psubc':'#8d6e63','--eh':'#6d4c41','--ehkbg':'#3a2818','--ehkbd':'#6d4c41','--tinpbg':'#3a2818','--accent':'#ff7043',
    }},
  },
  violet: {
    name: '紫罗兰',
    light: { bg: '#f8f5ff', grid: 'rgba(0,0,0,0.05)', nodeBg: '#fff', nodeBorder: '#ce93d8', text: '#311b92', text2: '#5e35b1', text3: '#9575cd', edge: '#7b1fa2', accent: '#6a1b9a', css: {
      '--bg':'#f5f0fa','--tlbg':'rgba(245,240,250,.95)','--tlbdr':'#ce93d8','--tbtn':'#ede4f5','--tbtnb':'#ce93d8','--tbtnc':'#4a148c','--tbtn-hbg':'#e1d0ed','--tbtn-hb':'#ab47bc','--tbtn-hc':'#6a1b9a','--tsep':'#ce93d8','--ttext':'#7e57c2','--tthov':'#e1d0ed','--pnl':'#f3ecf9','--pnls':'rgba(106,27,154,.1)','--pnlhd':'#4a148c','--pnlcl':'#ab47bc','--pnlch':'#6a1b9a','--flbl':'#7e57c2','--ibg':'#f3ecf9','--ibd':'#ce93d8','--ifc':'#311b92','--ifc2':'#6a1b9a','--propbd':'#e1bee7','--propbtn':'#f3ecf9','--propbtc':'#9575cd','--propbt-hbg':'#fce4ec','--propbt-hb':'#ef9a9a','--propbt-hc':'#c62828','--addpbg':'#ede4f5','--addpbd':'#ce93d8','--addp-hbg':'#e1d0ed','--addp-hb':'#ab47bc','--addp-hc':'#6a1b9a','--delb':'#f3ecf9','--delbd':'#ef9a9a','--delc':'#c62828','--del-hbg':'#fce4ec','--pid':'#ce93d8','--psubbg':'#ede4f5','--psubc':'#7e57c2','--eh':'#ce93d8','--ehkbg':'#ede4f5','--ehkbd':'#e1bee7','--tinpbg':'#f3ecf9','--accent':'#6a1b9a',
    }},
    dark: { bg: '#1a1025', grid: 'rgba(255,255,255,0.05)', nodeBg: '#2d1f3d', nodeBorder: '#5e35b1', text: '#e8e0f0', text2: '#b39ddb', text3: '#7e57c2', edge: '#ce93d8', accent: '#9575cd', css: {
      '--bg':'#1a1025','--tlbg':'rgba(26,16,37,.95)','--tlbdr':'#5e35b1','--tbtn':'#2d1f3d','--tbtnb':'#5e35b1','--tbtnc':'#b39ddb','--tbtn-hbg':'#3a204a','--tbtn-hb':'#9575cd','--tbtn-hc':'#ce93d8','--tsep':'#5e35b1','--ttext':'#7e57c2','--tthov':'#3a204a','--pnl':'#2d1f3d','--pnls':'rgba(0,0,0,.5)','--pnlhd':'#b39ddb','--pnlcl':'#5e35b1','--pnlch':'#9575cd','--flbl':'#7e57c2','--ibg':'#3a204a','--ibd':'#5e35b1','--ifc':'#d1c4e9','--ifc2':'#9575cd','--propbd':'#5e35b1','--propbtn':'#3a204a','--propbtc':'#7e57c2','--propbt-hbg':'#3a1a2a','--propbt-hb':'#c62828','--propbt-hc':'#ef5350','--addpbg':'#3a204a','--addpbd':'#5e35b1','--addp-hbg':'#3a204a','--addp-hb':'#9575cd','--addp-hc':'#ce93d8','--delb':'#3a204a','--delbd':'#c62828','--delc':'#ef5350','--del-hbg':'#3a1a2a','--pid':'#5e35b1','--psubbg':'#3a204a','--psubc':'#7e57c2','--eh':'#5e35b1','--ehkbg':'#3a204a','--ehkbd':'#5e35b1','--tinpbg':'#3a204a','--accent':'#9575cd',
    }},
  },
}

export function lerpColorStr(c1, c2, t) {
  if (t <= 0) return c1; if (t >= 1) return c2
  const p = s => {
    const m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    if (m) return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16), 1]
    const mr = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
    if (mr) return [parseInt(mr[1]), parseInt(mr[2]), parseInt(mr[3]), mr[4] !== undefined ? parseFloat(mr[4]) : 1]
    return null
  }
  const a = p(c1), b = p(c2)
  if (!a || !b) return t < 0.5 ? c1 : c2
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  const al = a[3] + (b[3] - a[3]) * t
  return al < 1 ? `rgba(${r},${g},${bl},${al.toFixed(2)})` : `rgb(${r},${g},${bl})`
}

function lerpObj(light, dark, t) {
  const r = {}
  for (const k of Object.keys(light)) {
    if (k === 'css') continue
    const lv = light[k], dv = dark[k]
    if (typeof lv === 'string' && typeof dv === 'string') {
      r[k] = lerpColorStr(lv, dv, t)
    } else if (Array.isArray(lv) && Array.isArray(dv)) {
      r[k] = lv.map((v, i) => lerpColorStr(v, dv[i] || v, t))
    } else {
      r[k] = t < 0.5 ? lv : dv
    }
  }
  if (light.css && dark.css) {
    r.css = {}
    for (const k of Object.keys(light.css)) {
      r.css[k] = lerpColorStr(light.css[k], dark.css[k], t)
    }
  }
  return r
}

export function getPaletteColors() {
  const p = PALETTES[config.palette] || PALETTES.classic
  const t = Math.max(0, Math.min(1, (config.brightness || 0) / 100))
  return lerpObj(p.light, p.dark, t)
}

// Style config (mutable, persisted)
export const config = {
  layout: 'manual', edgeStyle: 'straight', nodeShape: 'rounded',
  infoLevel: 'minimal', positionMode: 'manual', edgeAnim: 'none',
  brightness: 0, palette: 'classic',
  execMode: 'off',
}

// ============ v0.6 code-as-truth state ============
// 模型变更：
//   - sourceCode 是唯一真相源（class 定义 + 启动代码同一段字符串）
//   - runtimeInstances 是派生（执行 sourceCode 得到）
//   - classes 是派生（parser + scanClass）
//   - visualState 存不入代码的视图信息（位置、颜色）
//   - 实例身份 = varName（启动代码里的变量名）
import { DEFAULT_BOOTSTRAP } from './bootstrap.js'

export const state = {
  // v0.6 核心
  sourceCode: DEFAULT_BOOTSTRAP,
  runtimeInstances: [],
  classes: {},
  visualState: {
    positions: {},     // varName -> { x, y }
    colors: {},        // varName -> color string
  },

  // 视图（保留为顶层，方便访问）
  viewX: 0, viewY: 0, viewScale: 1,

  // 选择（用 varName 字符串，避免 RuntimeInstance 引用过期）
  selVarName: null,
  selEdge: null,
  hoverVarName: null,
  dragVarName: null,

  // 交互状态
  mode: null,
  isDown: false, sX: 0, sY: 0, moved: false,

  // 图元数据
  graphId: 'g_' + Date.now(), graphTitle: '系统模型',

  // 撤销栈（sourceCode 字符串快照）
  undoStack: [],
  panelUndoPushed: false,

  // 动画/物理
  animFrame: null, physTime: 0, dragHeat: 0,

  // 执行
  tickCount: 0, execHistory: [],

  // 输入
  spaceHeld: false, panState: null,
  mouseSX: 0, mouseSY: 0,
  mPos: { x: 0, y: 0 },
  snapLines: [],
  searchQuery: '',
}

// ============ 兼容别名层 ============
// v0.5 大量代码用 state.selInstance / state.nodes / state.hoverInstance / state.dragInstance。
// v0.6 改为 varName 字符串存储，通过 getter 返回 RuntimeInstance。
function _findByVarName(varName) {
  if (!varName) return null
  return state.runtimeInstances.find(i => i.varName === varName) || null
}

Object.defineProperty(state, 'selInstance', {
  get() { return _findByVarName(state.selVarName) },
  set(inst) { state.selVarName = inst ? inst.varName : null },
  configurable: true,
})
Object.defineProperty(state, 'selNode', {
  get() { return _findByVarName(state.selVarName) },
  set(inst) { state.selVarName = inst ? inst.varName : null },
  configurable: true,
})
Object.defineProperty(state, 'instances', {
  get() { return state.runtimeInstances },
  configurable: true,
})
Object.defineProperty(state, 'nodes', {
  get() { return state.runtimeInstances },
  configurable: true,
})
Object.defineProperty(state, 'hoverInstance', {
  get() { return _findByVarName(state.hoverVarName) },
  set(inst) { state.hoverVarName = inst ? inst.varName : null },
  configurable: true,
})
Object.defineProperty(state, 'hoverNode', {
  get() { return _findByVarName(state.hoverVarName) },
  set(inst) { state.hoverVarName = inst ? inst.varName : null },
  configurable: true,
})
Object.defineProperty(state, 'dragInstance', {
  get() { return _findByVarName(state.dragVarName) },
  set(inst) { state.dragVarName = inst ? inst.varName : null },
  configurable: true,
})
Object.defineProperty(state, 'dragNode', {
  get() { return _findByVarName(state.dragVarName) },
  set(inst) { state.dragVarName = inst ? inst.varName : null },
  configurable: true,
})

// Theme
export let isDark = false
export function setIsDark(v) { isDark = v }
