// ==UserScript==
// @name         MReader: Marxists.org Mobile Readability
// @namespace    mreader.marxists
// @version      0.1.0
// @description  Fix mobile typography/layout overflow on marxists.org; modular and extensible (font size, dark mode ready)
// @author       MReader
// @match        https://www.marxists.org/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

/*
Development note:
- To test against your local sample page, add an extra match in your editor manually:
  // @match file:///Users/oydodo/Desktop/AppProject/MReader/sample/sample.htm
  Do not keep it enabled when publishing.
*/

(function () {
  'use strict'

  // -----------------------------
  // Config and Feature Flags
  // -----------------------------
  const CONFIG_KEY = 'mreader:marxists:config'

  const defaultConfig = {
    enabled: true,
    compactMargins: true,
    wrapTables: true,
    fontSizePx: 16, // placeholder for future UI
    darkMode: false, // placeholder for future UI
    allowList: [
      /https?:\/\/www\.marxists\.org\/.*/i
    ],
    denyList: [
      // Add paths to skip if needed, e.g., /(\/search|\/glossary)/
    ]
  }

  // -----------------------------
  // Storage Helpers (Tampermonkey GM_*)
  // -----------------------------
  const storage = {
    load() {
      try {
        const raw = GM_getValue(CONFIG_KEY, '')
        if (!raw) return { ...defaultConfig }
        const parsed = JSON.parse(raw)
        return { ...defaultConfig, ...parsed }
      } catch (e) {
        return { ...defaultConfig }
      }
    },
    save(cfg) {
      try {
        GM_setValue(CONFIG_KEY, JSON.stringify(cfg))
      } catch (e) {
        // no-op
      }
    }
  }

  // -----------------------------
  // DOM Utilities
  // -----------------------------
  const dom = {
    qs(sel, root) { return (root || document).querySelector(sel) },
    qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)) },
    addStyle(css) { try { GM_addStyle(css) } catch (_) { const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el) } },
    ensureViewportMeta() {
      let meta = document.querySelector('meta[name="viewport"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'viewport'
        meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover'
        // If we are at document-start, head may not exist yet; defer until it does
        const append = () => {
          (document.head || document.documentElement).appendChild(meta)
        }
        if (!document.head) {
          new MutationObserver((_, obs) => {
            if (document.head) { append(); obs.disconnect() }
          }).observe(document.documentElement, { childList: true, subtree: true })
        } else {
          append()
        }
      }
    },
    onReady(fn) {
      if (document.readyState === 'complete' || document.readyState === 'interactive') return fn()
      document.addEventListener('DOMContentLoaded', fn, { once: true })
    }
  }

  // -----------------------------
  // Router / Guards
  // -----------------------------
  function isAllowedUrl(config) {
    const url = location.href
    if (config.denyList.some((re) => re.test(url))) return false
    if (config.allowList.some((re) => re.test(url))) return true
    return false
  }

  // -----------------------------
  // CSS Assembly (Feature Modules)
  // -----------------------------
  function cssBase(config) {
    const bodyMaxWidth = config.compactMargins ? '52ch' : '64ch'
    const sidePadding = config.compactMargins ? '12px' : '16px'
    const fontSize = `${config.fontSizePx || 16}px`
    return [
      'html { box-sizing: border-box; -webkit-text-size-adjust: 100%; }',
      '*, *::before, *::after { box-sizing: inherit; }',
      `:root { --mreader-font-size: ${fontSize}; }`,
      `body { font-size: var(--mreader-font-size); line-height: 1.65; max-width: ${bodyMaxWidth}; margin: 0 auto; padding: 0 ${sidePadding}; overflow-wrap: break-word; word-wrap: break-word; }`,
      // Try to target common content containers if present, without breaking layout
      '#content, #main, #BodyContent, article { max-width: 100%; }',
      // Images and media
      'img, svg, video, canvas, iframe { max-width: 100% !important; height: auto !important; }',
      // Tables
      config.wrapTables ? 'table { display: block; width: 100% !important; overflow-x: auto; -webkit-overflow-scrolling: touch; border-collapse: collapse; }' : '',
      config.wrapTables ? 'thead, tbody, tfoot, tr { width: 100%; }' : '',
      // Code blocks
      'pre { white-space: pre-wrap; word-break: break-word; overflow: auto; -webkit-overflow-scrolling: touch; }',
      'code, kbd, samp { white-space: pre-wrap; word-break: break-word; }',
      // Links long URLs
      'a { overflow-wrap: anywhere; }',
      // Prevent legacy fixed widths from forcing overflow
      'body, #content, #main, #BodyContent, .content, .main { width: auto !important; }',
      // Dark mode placeholder
      config.darkMode ? 'html { color-scheme: dark; } body { background: #0b0b0b; color: #e5e5e5; } a { color: #7ab4ff; }' : ''
    ].filter(Boolean).join('\n')
  }

  // -----------------------------
  // JS Feature Modules (idempotent)
  // -----------------------------
  function neutralizeFixedWidthContainers() {
    const selector = [
      'body > div[style*="width:"]',
      '#content[style*="width:"]',
      '#main[style*="width:"]',
      '#BodyContent[style*="width:"]',
      'table[width]',
      'td[width]',
      'div[width]'
    ].join(',')
    dom.qsa(selector).forEach((el) => {
      try {
        // Prefer max-width over fixed width
        el.style.maxWidth = '100%'
        el.style.width = 'auto'
        el.style.overflow = el.style.overflow || 'hidden'
      } catch (_) {}
    })
  }

  function markFramesAndColumns() {
    // marxists.org sometimes uses nested tables/cols for layout; ensure no viewport overflow
    dom.qsa('table').forEach((t) => {
      t.style.maxWidth = '100%'
    })
    dom.qsa('td, th').forEach((c) => {
      if (c.hasAttribute('width')) c.removeAttribute('width')
    })
  }

  // -----------------------------
  // Minimal Settings UI (floating button)
  // -----------------------------
  function buildUI(config, onChange) {
    if (document.getElementById('mreader-ui')) return
    const root = document.createElement('div')
    root.id = 'mreader-ui'
    root.style.position = 'fixed'
    root.style.right = '12px'
    root.style.bottom = '12px'
    root.style.zIndex = '2147483647'

    const btn = document.createElement('button')
    btn.textContent = 'MR'
    btn.setAttribute('aria-label', 'MReader settings')
    btn.style.padding = '10px 12px'
    btn.style.borderRadius = '20px'
    btn.style.border = '1px solid rgba(0,0,0,0.2)'
    btn.style.background = '#ffffff'
    btn.style.color = '#111'
    btn.style.boxShadow = '0 2px 10px rgba(0,0,0,0.15)'
    btn.style.fontSize = '14px'

    const panel = document.createElement('div')
    panel.style.position = 'absolute'
    panel.style.right = '0'
    panel.style.bottom = '42px'
    panel.style.minWidth = '200px'
    panel.style.padding = '12px'
    panel.style.borderRadius = '8px'
    panel.style.border = '1px solid rgba(0,0,0,0.15)'
    panel.style.background = '#ffffff'
    panel.style.color = '#111'
    panel.style.boxShadow = '0 6px 20px rgba(0,0,0,0.18)'
    panel.style.display = 'none'

    const mkToggle = (label, key) => {
      const row = document.createElement('label')
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.style.gap = '8px'
      row.style.margin = '6px 0'
      const chk = document.createElement('input')
      chk.type = 'checkbox'
      chk.checked = !!config[key]
      chk.addEventListener('change', () => {
        config[key] = chk.checked
        storage.save(config)
        onChange(config)
      })
      const span = document.createElement('span')
      span.textContent = label
      row.appendChild(chk)
      row.appendChild(span)
      return row
    }

    const enabledRow = mkToggle('Enable improvements', 'enabled')
    const compactRow = mkToggle('Compact margins', 'compactMargins')
    const tableRow = mkToggle('Wrap wide tables', 'wrapTables')

    // Placeholders for future features
    const fontInfo = document.createElement('div')
    fontInfo.textContent = 'Font size, Dark mode coming next.'
    fontInfo.style.fontSize = '12px'
    fontInfo.style.opacity = '0.75'
    fontInfo.style.marginTop = '6px'

    panel.appendChild(enabledRow)
    panel.appendChild(compactRow)
    panel.appendChild(tableRow)
    panel.appendChild(fontInfo)

    btn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    })

    root.appendChild(btn)
    root.appendChild(panel)
    document.documentElement.appendChild(root)
  }

  function removeUI() {
    const ui = document.getElementById('mreader-ui')
    if (ui && ui.parentNode) ui.parentNode.removeChild(ui)
  }

  // -----------------------------
  // Main Apply
  // -----------------------------
  const state = {
    applied: false
  }

  function apply(config) {
    if (!isAllowedUrl(config)) return
    dom.ensureViewportMeta()

    if (!config.enabled) {
      removeUI()
      return
    }

    // Inject CSS
    dom.addStyle(cssBase(config))

    // JS cleanups (idempotent)
    dom.onReady(() => {
      neutralizeFixedWidthContainers()
      markFramesAndColumns()
      buildUI(config, (newCfg) => {
        // Re-apply dynamic CSS when settings change
        // We cannot remove GM_addStyle injections easily; instead, we add a single style tag with fixed id.
        const tagId = 'mreader-style-base'
        let styleEl = document.getElementById(tagId)
        const css = cssBase(newCfg)
        if (!styleEl) {
          styleEl = document.createElement('style')
          styleEl.id = tagId
          styleEl.textContent = css
          document.head.appendChild(styleEl)
        } else {
          styleEl.textContent = css
        }
      })

      // Ensure a managed style tag exists for reactivity
      const tagId = 'mreader-style-base'
      if (!document.getElementById(tagId)) {
        const styleEl = document.createElement('style')
        styleEl.id = tagId
        styleEl.textContent = cssBase(config)
        document.head.appendChild(styleEl)
      }
    })
  }

  // -----------------------------
  // Boot
  // -----------------------------
  const cfg = storage.load()
  if (isAllowedUrl(cfg)) {
    apply(cfg)
    // Provide quick menu toggle
    let toggleId = null
    try {
      toggleId = GM_registerMenuCommand('MReader: Toggle enable', () => {
        const next = { ...cfg, enabled: !cfg.enabled }
        storage.save(next)
        location.reload()
      })
    } catch (_) {}

    // Clean up on unload
    window.addEventListener('unload', () => {
      try { if (toggleId) GM_unregisterMenuCommand(toggleId) } catch (_) {}
    })
  }
})()

