import { config, getPaletteColors } from './state.js'

export function loadConfig() {
  try {
    const s = localStorage.getItem('sa_config')
    if (s) {
      const c = JSON.parse(s)
      // Migrate old theme field to brightness
      if (c.theme !== undefined) {
        c.brightness = c.theme === 'dark' ? 70 : 0
        delete c.theme
      }
      Object.assign(config, { brightness: 0, palette: 'classic' }, c)
    }
  } catch(e) {}
}

export function saveConfig() {
  try{localStorage.setItem('sa_config',JSON.stringify(config))}catch(e){}
}

export function applyTheme() {
  const pc = getPaletteColors()
  const css = pc.css || {}
  const root = document.documentElement
  for (const [key, val] of Object.entries(css)) {
    root.style.setProperty(key, val)
  }
}


