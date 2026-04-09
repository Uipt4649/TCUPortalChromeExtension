const SEARCH_HIGHLIGHT_CLASS = "tcu-search-highlight";
const SEARCH_ACTIVE_CLASS = "tcu-search-active";
const INLINE_SEARCH_BAR_ID = "tcu-inline-search-bar";
const INLINE_SEARCH_STYLE_ID = "tcu-inline-search-style";
const INLINE_SEARCH_LAUNCHER_ID = "tcu-inline-search-launcher";
const APP_SHELL_ID = "tcu-portal-app-shell";
const APP_SHELL_STYLE_ID = "tcu-portal-app-shell-style";
const WEEKLY_UI_STYLE_ID = "tcu-weekly-ui-style";
const ALL_NOTICE_MODAL_ID = "tcu-all-notice-modal";
const UI_MODE_KEY = "tcu_custom_ui_enabled_v1";
const UI_TOGGLE_ID = "tcu-ui-mode-toggle";
const UI_STYLE_VERSION_KEY = "tcu_ui_style_version";
const UI_STYLE_VERSION = "apple-skin-v4";
const CUSTOM_WEEKLY_EVENTS_KEY = "tcu_custom_weekly_events_v2";
const PENDING_NAVIGATION_KEY = "tcu_pending_navigation_v1";
const DEEP_SEARCH_MAX_PAGES = 45;
const DEEP_SEARCH_CACHE_MS = 1000 * 60 * 5;
const NOTICE_CATEGORIES = [
  { key: "lecture", label: "講義のお知らせ", icon: "📘", pattern: /講義のお知らせ|講義からのお知らせ|授業のお知らせ|講義関連/i },
  { key: "univ", label: "大学からのお知らせ", icon: "🏫", pattern: /大学からのお知らせ|大学のお知らせ/i },
  { key: "personal", label: "あなた宛のお知らせ", icon: "📩", pattern: /あなた宛のお知らせ|あなた宛|個人宛/i },
  { key: "teacher", label: "教員からのお知らせ", icon: "👩‍🏫", pattern: /教員からのお知らせ|教員のお知らせ|先生からのお知らせ/i },
  { key: "public", label: "誰でも投稿", icon: "🗂️", pattern: /誰でも投稿|みんなの投稿|投稿一覧/i },
];

const searchState = {
  matches: [],
  currentIndex: -1,
  keyword: "",
};

let weeklyObserver = null;
let weeklyViewOffset = 0;
const deepSearchPromises = new Map();
const deepSearchCacheByKeyword = new Map();
const searchEntryStore = new Map();

const UX_SETTINGS_KEY = "tcu_portal_ux_settings_v1";
const defaultUxSettings = {
  enabled: true,
  compact: false,
  focus: false,
  fontScale: 15,
  contentWidth: 1240,
};

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_error) {
    // ignore storage-denied frames
  }
}

function safeStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (_error) {
    // ignore storage-denied frames
  }
}

function getPendingNavigation() {
  try {
    const raw = safeStorageGet(PENDING_NAVIGATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function setPendingNavigation(entry) {
  const payload = {
    href: String(entry?.href || ""),
    source: String(entry?.source || ""),
    title: normalizeText(entry?.title || ""),
    createdAt: Date.now(),
  };
  safeStorageSet(PENDING_NAVIGATION_KEY, JSON.stringify(payload));
}

function clearPendingNavigation() {
  safeStorageRemove(PENDING_NAVIGATION_KEY);
}

function getUxSettings() {
  try {
    const raw = safeStorageGet(UX_SETTINGS_KEY);
    if (!raw) {
      return { ...defaultUxSettings };
    }
    const parsed = JSON.parse(raw);
    return { ...defaultUxSettings, ...parsed };
  } catch (_error) {
    return { ...defaultUxSettings };
  }
}

function setUxSettings(nextSettings) {
  safeStorageSet(UX_SETTINGS_KEY, JSON.stringify(nextSettings));
}

function ensurePortalUiStyle(settings) {
  let style = document.getElementById("tcu-portal-ui-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "tcu-portal-ui-style";
    document.head.appendChild(style);
  }

  if (!settings.enabled) {
    style.textContent = "";
    document.documentElement.classList.remove("tcu-ux-enhanced", "tcu-ux-compact", "tcu-ux-focus");
    return;
  }

  document.documentElement.classList.add("tcu-ux-enhanced");
  document.documentElement.classList.toggle("tcu-ux-compact", settings.compact);
  document.documentElement.classList.toggle("tcu-ux-focus", settings.focus);

  style.textContent = `
    :root {
      --tcu-bg: #f5f5f7;
      --tcu-surface: rgba(255, 255, 255, 0.78);
      --tcu-text: #1d1d1f;
      --tcu-muted: #6e6e73;
      --tcu-line: rgba(29, 29, 31, 0.12);
      --tcu-accent: #0071e3;
      --tcu-accent-soft: #e8f3ff;
      --tcu-radius: 16px;
      --tcu-font-size: ${settings.fontScale}px;
      --tcu-row-padding: ${settings.compact ? 6 : 10}px;
    }

    html.tcu-ux-enhanced body {
      background: linear-gradient(180deg, #fafafa 0%, var(--tcu-bg) 100%) !important;
      color: var(--tcu-text) !important;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Yu Gothic", sans-serif !important;
      font-size: var(--tcu-font-size) !important;
      line-height: 1.5 !important;
      letter-spacing: 0.1px !important;
      -webkit-font-smoothing: antialiased !important;
    }

    html.tcu-ux-enhanced body::before {
      content: "";
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 56px;
      background: rgba(245, 245, 247, 0.82);
      border-bottom: 1px solid rgba(29, 29, 31, 0.08);
      backdrop-filter: blur(18px);
      z-index: 999;
      pointer-events: none;
    }

    html.tcu-ux-enhanced body > * {
      position: relative;
      z-index: 1;
    }

    html.tcu-ux-enhanced table,
    html.tcu-ux-enhanced [class*="schedule"],
    html.tcu-ux-enhanced [id*="schedule"] {
      background-image: none !important;
    }

    html.tcu-ux-enhanced [class*="notice"],
    html.tcu-ux-enhanced [class*="news"],
    html.tcu-ux-enhanced [class*="box"],
    html.tcu-ux-enhanced [class*="panel"],
    html.tcu-ux-enhanced [id*="notice"],
    html.tcu-ux-enhanced [id*="news"],
    html.tcu-ux-enhanced [id*="box"],
    html.tcu-ux-enhanced [id*="panel"] {
      background: var(--tcu-surface) !important;
      border: 1px solid var(--tcu-line) !important;
      border-radius: var(--tcu-radius) !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08) !important;
      backdrop-filter: blur(10px);
      overflow: hidden !important;
    }

    html.tcu-ux-enhanced [class*="notice"] h1,
    html.tcu-ux-enhanced [class*="notice"] h2,
    html.tcu-ux-enhanced [class*="notice"] h3,
    html.tcu-ux-enhanced [class*="news"] h1,
    html.tcu-ux-enhanced [class*="news"] h2,
    html.tcu-ux-enhanced [class*="news"] h3 {
      font-size: clamp(18px, 2.2vw, 28px) !important;
      letter-spacing: -0.35px !important;
      font-weight: 700 !important;
    }

    html.tcu-ux-enhanced table {
      border-collapse: separate !important;
      border-spacing: 0 !important;
      width: 100% !important;
      background: #ffffff !important;
      border: 1px solid var(--tcu-line) !important;
      border-radius: 18px !important;
      overflow: hidden !important;
      box-shadow: 0 10px 22px rgba(0, 0, 0, 0.06) !important;
    }

    html.tcu-ux-enhanced th,
    html.tcu-ux-enhanced td {
      border-bottom: 1px solid #e6edf6 !important;
      padding: var(--tcu-row-padding) 12px !important;
      vertical-align: top !important;
      color: var(--tcu-text) !important;
      font-size: 0.95em !important;
    }

    html.tcu-ux-enhanced tr:nth-child(even) td {
      background: #fafcff !important;
    }

    html.tcu-ux-enhanced tr:hover td {
      background: var(--tcu-accent-soft) !important;
    }

    html.tcu-ux-enhanced h1,
    html.tcu-ux-enhanced h2,
    html.tcu-ux-enhanced h3,
    html.tcu-ux-enhanced [class*="title"],
    html.tcu-ux-enhanced [class*="header"] {
      color: #0b2f55 !important;
      letter-spacing: 0.2px !important;
    }

    html.tcu-ux-enhanced a {
      color: var(--tcu-accent) !important;
      font-weight: 500 !important;
      text-decoration-thickness: 1.5px !important;
      text-underline-offset: 2px !important;
    }

    html.tcu-ux-enhanced .tcu-weekly-header {
      position: sticky;
      top: 0;
      z-index: 2;
      backdrop-filter: blur(12px);
    }

    html.tcu-ux-enhanced .new,
    html.tcu-ux-enhanced .label-new,
    html.tcu-ux-enhanced [class*="new"] {
      border-radius: 999px !important;
      padding: 2px 8px !important;
      font-size: 0.72em !important;
      font-weight: 700 !important;
      background: #ffe7e7 !important;
      color: #9f1239 !important;
      border: 1px solid #fecaca !important;
    }

    html.tcu-ux-enhanced button,
    html.tcu-ux-enhanced input[type="button"],
    html.tcu-ux-enhanced input[type="submit"] {
      border-radius: 8px !important;
      border: 1px solid #cbd5e1 !important;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08) !important;
      font-weight: 700 !important;
    }

    html.tcu-ux-enhanced.tcu-ux-focus [class*="sidebar"],
    html.tcu-ux-enhanced.tcu-ux-focus [id*="sidebar"],
    html.tcu-ux-enhanced.tcu-ux-focus [class*="right"],
    html.tcu-ux-enhanced.tcu-ux-focus [id*="right"] {
      opacity: 0.35 !important;
      filter: saturate(0.8) blur(0.1px);
    }
  `;
}

function ensureUxControlPanel() {
  if (document.getElementById("tcu-ux-launcher")) {
    return;
  }

  const launcher = document.createElement("button");
  launcher.id = "tcu-ux-launcher";
  launcher.type = "button";
  launcher.textContent = "Portal UX";
  launcher.style.position = "fixed";
  launcher.style.bottom = "12px";
  launcher.style.right = "12px";
  launcher.style.zIndex = "2147483646";
  launcher.style.padding = "8px 12px";
  launcher.style.border = "0";
  launcher.style.borderRadius = "999px";
  launcher.style.background = "linear-gradient(180deg, #3a3a3c, #1d1d1f)";
  launcher.style.color = "#fff";
  launcher.style.fontSize = "12px";
  launcher.style.fontWeight = "700";
  launcher.style.cursor = "pointer";
  launcher.style.boxShadow = "0 6px 18px rgba(15, 23, 42, 0.25)";

  const panel = document.createElement("div");
  panel.id = "tcu-ux-panel";
  panel.style.position = "fixed";
  panel.style.bottom = "52px";
  panel.style.right = "12px";
  panel.style.width = "260px";
  panel.style.padding = "12px";
  panel.style.borderRadius = "12px";
  panel.style.border = "1px solid rgba(29, 29, 31, 0.12)";
  panel.style.background = "rgba(255,255,255,0.86)";
  panel.style.backdropFilter = "blur(14px)";
  panel.style.boxShadow = "0 14px 34px rgba(0, 0, 0, 0.14)";
  panel.style.zIndex = "2147483646";
  panel.style.display = "none";
  panel.style.fontFamily = "\"Avenir Next\", \"Hiragino Sans\", sans-serif";
  panel.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">Portal UX Settings</div>
    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin:6px 0;">
      <span>デザイン改善を有効化</span>
      <input id="tcu-ux-enabled" type="checkbox" />
    </label>
    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin:6px 0;">
      <span>コンパクト表示</span>
      <input id="tcu-ux-compact" type="checkbox" />
    </label>
    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin:6px 0;">
      <span>集中モード</span>
      <input id="tcu-ux-focus" type="checkbox" />
    </label>
    <div style="font-size:12px;margin-top:10px;">文字サイズ</div>
    <input id="tcu-ux-font" type="range" min="13" max="18" step="1" style="width:100%;" />
    <div style="font-size:12px;margin-top:10px;">表示幅</div>
    <input id="tcu-ux-width" type="range" min="980" max="1440" step="20" style="width:100%;" />
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const enabledInput = panel.querySelector("#tcu-ux-enabled");
  const compactInput = panel.querySelector("#tcu-ux-compact");
  const focusInput = panel.querySelector("#tcu-ux-focus");
  const fontInput = panel.querySelector("#tcu-ux-font");
  const widthInput = panel.querySelector("#tcu-ux-width");

  const syncInputs = () => {
    const current = getUxSettings();
    enabledInput.checked = current.enabled;
    compactInput.checked = current.compact;
    focusInput.checked = current.focus;
    fontInput.value = String(current.fontScale);
    widthInput.value = String(current.contentWidth);
  };

  const applyFromInputs = () => {
    const next = {
      enabled: enabledInput.checked,
      compact: compactInput.checked,
      focus: focusInput.checked,
      fontScale: Number(fontInput.value),
      contentWidth: Number(widthInput.value),
    };
    setUxSettings(next);
    ensurePortalUiStyle(next);
  };

  launcher.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    syncInputs();
  });

  [enabledInput, compactInput, focusInput, fontInput, widthInput].forEach((element) => {
    element.addEventListener("input", applyFromInputs);
    element.addEventListener("change", applyFromInputs);
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureHighlightStyle() {
  if (document.getElementById("tcu-search-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "tcu-search-style";
  style.textContent = `
    .${SEARCH_HIGHLIGHT_CLASS} {
      background-color: #fef08a;
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }
    .${SEARCH_HIGHLIGHT_CLASS}.${SEARCH_ACTIVE_CLASS} {
      background-color: #f59e0b;
      color: #111827;
      outline: 1px solid #b45309;
    }
  `;
  document.head.appendChild(style);
}

function isSearchableTextNode(node) {
  if (!node || !node.parentElement) {
    return false;
  }

  const parent = node.parentElement;
  if (parent.closest(`#${INLINE_SEARCH_BAR_ID}`) || parent.closest("#tcu-ux-panel") || parent.closest("#tcu-ux-launcher")) {
    return false;
  }
  const tag = parent.tagName;
  if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT"].includes(tag)) {
    return false;
  }

  if (parent.closest(`.${SEARCH_HIGHLIGHT_CLASS}`)) {
    return false;
  }

  return node.nodeValue && node.nodeValue.trim().length > 0;
}

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (isSearchableTextNode(currentNode)) {
      nodes.push(currentNode);
    }
    currentNode = walker.nextNode();
  }

  return nodes;
}

function clearHighlights() {
  const highlighted = document.querySelectorAll(`span.${SEARCH_HIGHLIGHT_CLASS}`);

  highlighted.forEach((span) => {
    const textNode = document.createTextNode(span.textContent || "");
    const parent = span.parentNode;
    if (!parent) {
      return;
    }

    parent.replaceChild(textNode, span);
    parent.normalize();
  });

  searchState.matches = [];
  searchState.currentIndex = -1;
}

function setActiveMatch(index) {
  if (searchState.matches.length === 0) {
    searchState.currentIndex = -1;
    return;
  }

  const normalizedIndex = ((index % searchState.matches.length) + searchState.matches.length) % searchState.matches.length;
  searchState.currentIndex = normalizedIndex;

  searchState.matches.forEach((node, i) => {
    if (i === normalizedIndex) {
      node.classList.add(SEARCH_ACTIVE_CLASS);
      node.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } else {
      node.classList.remove(SEARCH_ACTIVE_CLASS);
    }
  });
}

function highlightKeyword(keyword) {
  clearHighlights();
  searchState.keyword = keyword;

  if (!keyword) {
    return;
  }

  ensureHighlightStyle();

  const escaped = escapeRegex(keyword);
  const regex = new RegExp(`(${escaped})`, "gi");
  const textNodes = collectTextNodes(document.body);

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue || "";
    if (!regex.test(text)) {
      regex.lastIndex = 0;
      return;
    }
    regex.lastIndex = 0;

    const parts = text.split(regex);
    if (parts.length <= 1) {
      return;
    }

    const fragment = document.createDocumentFragment();

    parts.forEach((part, index) => {
      if (!part) {
        return;
      }

      if (index % 2 === 1) {
        const span = document.createElement("span");
        span.className = SEARCH_HIGHLIGHT_CLASS;
        span.textContent = part;
        searchState.matches.push(span);
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });

    const parent = textNode.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(fragment, textNode);
  });

  if (searchState.matches.length > 0) {
    setActiveMatch(0);
  }
}

function getResultPayload() {
  return {
    count: searchState.matches.length,
    current: searchState.currentIndex < 0 ? 0 : searchState.currentIndex,
  };
}

function canSafelyClick(element) {
  const tag = element.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") {
    return true;
  }

  if (tag === "A") {
    const href = (element.getAttribute("href") || "").trim().toLowerCase();
    if (!href || href === "#" || href.startsWith("javascript:")) {
      return true;
    }
    return false;
  }

  return element.getAttribute("role") === "button";
}

function collectExpandableElements() {
  const candidates = Array.from(
    document.querySelectorAll("button, summary, a, [role='button'], [aria-expanded='false']")
  );
  const keywordPattern = /詳細|表示|開く|もっと|全て|一覧|お知らせ/i;
  const seen = new Set();
  const result = [];

  candidates.forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (seen.has(element)) {
      return;
    }
    if (!canSafelyClick(element)) {
      return;
    }

    const label = (
      element.innerText ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
    ).trim();
    const collapsed = element.getAttribute("aria-expanded") === "false";

    if (!collapsed && !keywordPattern.test(label)) {
      return;
    }

    seen.add(element);
    result.push(element);
  });

  return result;
}

async function expandAndSearch(keyword) {
  const clickable = collectExpandableElements();
  clickable.forEach((element) => {
    element.click();
  });

  if (clickable.length > 0) {
    await sleep(700);
  }

  highlightKeyword(keyword);
}

function runSearch(type, keyword = "") {
  switch (type) {
    case "search":
      highlightKeyword(keyword.trim());
      break;
    case "next":
      if (searchState.matches.length > 0) {
        setActiveMatch(searchState.currentIndex + 1);
      }
      break;
    case "prev":
      if (searchState.matches.length > 0) {
        setActiveMatch(searchState.currentIndex - 1);
      }
      break;
    case "clear":
      clearHighlights();
      break;
    default:
      break;
  }
  return getResultPayload();
}

function updateInlineSearchStatus(statusElement, result, label = "") {
  if (!statusElement) {
    return;
  }
  if (result.count === 0) {
    statusElement.textContent = label || "一致なし";
    return;
  }
  statusElement.textContent = `${result.count}件中 ${result.current + 1}件目`;
}

function ensureInlineSearchBar() {
  if (window.top !== window) {
    return;
  }

  if (document.getElementById(INLINE_SEARCH_BAR_ID) || document.getElementById(INLINE_SEARCH_LAUNCHER_ID)) {
    return;
  }

  if (!document.body) {
    return;
  }

  if (!document.getElementById(INLINE_SEARCH_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = INLINE_SEARCH_STYLE_ID;
    style.textContent = `
      #${INLINE_SEARCH_BAR_ID} {
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        width: min(980px, calc(100vw - 24px));
        z-index: 2147483646;
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto auto auto;
        gap: 8px;
        align-items: center;
        padding: 10px 12px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid rgba(29, 29, 31, 0.14);
        box-shadow: 0 16px 38px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(18px);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      #${INLINE_SEARCH_BAR_ID}.is-open {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(-50%) translateY(0);
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-input {
        min-width: 180px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 9px 11px;
        font-size: 13px;
        color: #0f172a;
        background: #f8fafc;
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-input:focus {
        outline: none;
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-btn {
        border: 0;
        border-radius: 10px;
        padding: 9px 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-btn.primary {
        background: #0071e3;
        color: #fff;
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-btn.accent {
        background: #34c759;
        color: #fff;
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-btn.neutral {
        background: #e2e8f0;
        color: #0f172a;
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-status {
        grid-column: 1 / 2;
        font-size: 12px;
        color: #1d1d1f;
        font-weight: 700;
        text-align: left;
        padding-left: 2px;
      }
      #${INLINE_SEARCH_BAR_ID} .tcu-inline-nav {
        grid-column: 2 / 5;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      @media (max-width: 1100px) {
        #${INLINE_SEARCH_BAR_ID} {
          grid-template-columns: 1fr 1fr;
        }
        #${INLINE_SEARCH_BAR_ID} .tcu-inline-input {
          grid-column: 1 / 3;
        }
        #${INLINE_SEARCH_BAR_ID} .tcu-inline-btn.primary,
        #${INLINE_SEARCH_BAR_ID} .tcu-inline-btn.accent {
          width: 100%;
        }
        #${INLINE_SEARCH_BAR_ID} .tcu-inline-status {
          grid-column: 1 / 3;
        }
        #${INLINE_SEARCH_BAR_ID} .tcu-inline-nav {
          grid-column: 1 / 3;
          justify-content: stretch;
        }
        #${INLINE_SEARCH_BAR_ID} .tcu-inline-nav .tcu-inline-btn {
          flex: 1;
        }
      }
      #${INLINE_SEARCH_LAUNCHER_ID} {
        position: fixed;
        top: 10px;
        left: 12px;
        z-index: 2147483646;
        border: 1px solid rgba(29, 29, 31, 0.14);
        border-radius: 999px;
        padding: 9px 14px;
        background: rgba(255, 255, 255, 0.84);
        color: #1d1d1f;
        font-size: 12px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", sans-serif;
        backdrop-filter: blur(14px);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  const launcher = document.createElement("button");
  launcher.id = INLINE_SEARCH_LAUNCHER_ID;
  launcher.type = "button";
  launcher.textContent = "Search";

  const bar = document.createElement("div");
  bar.id = INLINE_SEARCH_BAR_ID;
  bar.innerHTML = `
    <input class="tcu-inline-input" type="text" placeholder="ポータル内を検索（Enterで検索）" />
    <button class="tcu-inline-btn primary" type="button" data-action="search">検索</button>
    <button class="tcu-inline-btn accent" type="button" data-action="deepSearch">詳細検索</button>
    <button class="tcu-inline-btn neutral" type="button" data-action="toggle">閉じる</button>
    <span class="tcu-inline-status">準備OK</span>
    <div class="tcu-inline-nav">
      <button class="tcu-inline-btn neutral" type="button" data-action="prev">前</button>
      <button class="tcu-inline-btn neutral" type="button" data-action="next">次</button>
      <button class="tcu-inline-btn neutral" type="button" data-action="clear">クリア</button>
    </div>
  `;
  document.body.appendChild(launcher);
  document.body.appendChild(bar);

  const input = bar.querySelector(".tcu-inline-input");
  const status = bar.querySelector(".tcu-inline-status");
  const buttons = Array.from(bar.querySelectorAll(".tcu-inline-btn"));

  const handleAction = async (action) => {
    if (action === "toggle") {
      bar.classList.remove("is-open");
      return;
    }

    const keyword = (input.value || "").trim();
    if ((action === "search" || action === "deepSearch") && !keyword) {
      updateInlineSearchStatus(status, { count: 0, current: 0 }, "キーワードを入力");
      return;
    }

    if (action === "deepSearch") {
      updateInlineSearchStatus(status, { count: 0, current: 0 }, "展開して検索中...");
      await expandAndSearch(keyword);
      updateInlineSearchStatus(status, getResultPayload());
      return;
    }

    const result = runSearch(action, keyword);
    updateInlineSearchStatus(status, result);
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      handleAction(button.dataset.action || "");
    });
  });

  launcher.addEventListener("click", () => {
    bar.classList.toggle("is-open");
    if (bar.classList.contains("is-open")) {
      input.focus();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleAction("search");
    }
    if (event.key === "Escape") {
      bar.classList.remove("is-open");
    }
  });
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function isSafePortalHref(href) {
  const value = String(href || "").trim();
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  if (!/^https?:\/\//.test(lower)) {
    return false;
  }
  if (lower.startsWith("javascript:")) {
    return false;
  }
  if (lower.includes("logout")) {
    return false;
  }
  return true;
}

function navigatePortal(href) {
  if (!isSafePortalHref(href)) {
    return;
  }
  try {
    location.assign(href);
  } catch (_error) {
    location.href = href;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iconForLabel(label) {
  const text = normalizeText(label);
  if (/お知らせ|通知|news/i.test(text)) return "🔔";
  if (/授業|講義|時間割|schedule/i.test(text)) return "📚";
  if (/シラバス|科目/i.test(text)) return "📝";
  if (/リンク|library|文書/i.test(text)) return "📎";
  if (/キャリア|就職/i.test(text)) return "💼";
  if (/ホーム|top|home/i.test(text)) return "🏠";
  if (/設定|config|setting/i.test(text)) return "⚙️";
  if (/検索|search/i.test(text)) return "🔎";
  return "•";
}

function collectShellSections() {
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => ({
      text: normalizeText(a.textContent),
      href: a.href,
      host: a.host,
    }))
    .filter((item) => item.text.length >= 2 && item.href && item.host === location.host);

  const uniqueLinks = [];
  const seen = new Set();
  links.forEach((item) => {
    const key = `${item.text}__${item.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLinks.push(item);
    }
  });

  const noticeContainers = Array.from(document.querySelectorAll("div, section, article"))
    .filter((el) => normalizeText(el.textContent).includes("お知らせ"))
    .filter((el) => el.querySelectorAll("a[href]").length >= 3)
    .slice(0, 8);

  const sections = [];
  noticeContainers.forEach((container, index) => {
    const titleCandidate =
      container.querySelector("h1, h2, h3, h4, th, .title, .header, strong")?.textContent || "";
    const title = normalizeText(titleCandidate) || `お知らせ ${index + 1}`;
    const items = Array.from(container.querySelectorAll("a[href]"))
      .map((a) => ({
        text: normalizeText(a.textContent),
        href: a.href,
      }))
      .filter((item) => item.text.length >= 2)
      .slice(0, 12);
    if (items.length > 0) {
      sections.push({ title, items });
    }
  });

  if (sections.length === 0) {
    sections.push({
      title: "リンク一覧",
      items: uniqueLinks.slice(0, 30).map((item) => ({ text: item.text, href: item.href })),
    });
  }

  return {
    quickLinks: uniqueLinks.slice(0, 14),
    sections,
  };
}

function ensurePortalAppShellStyle() {
  if (document.getElementById(APP_SHELL_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = APP_SHELL_STYLE_ID;
  style.textContent = `
    body.tcu-appshell-mode > *:not(#${APP_SHELL_ID}) {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    #${APP_SHELL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      grid-template-rows: 68px 1fr;
      background: #f5f5f7;
      color: #1d1d1f;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Yu Gothic", sans-serif;
      pointer-events: auto !important;
    }
    #${APP_SHELL_ID} *,
    #${APP_SHELL_ID} button,
    #${APP_SHELL_ID} a,
    #${APP_SHELL_ID} input,
    #${APP_SHELL_ID} select {
      pointer-events: auto !important;
    }
    #${APP_SHELL_ID} .tcu-topbar {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: center;
      gap: 14px;
      padding: 12px 22px;
      border-bottom: 1px solid rgba(29, 29, 31, 0.06);
      background: rgba(245, 245, 247, 0.84);
      backdrop-filter: blur(18px);
    }
    #${APP_SHELL_ID} .tcu-menu-btn {
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
      cursor: pointer;
      font-size: 18px;
      font-weight: 700;
      color: #1d1d1f;
    }
    #${APP_SHELL_ID} .tcu-brand {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #${APP_SHELL_ID} .tcu-brand-icon {
      font-size: 18px;
    }
    #${APP_SHELL_ID} .tcu-brand-main {
      font-size: clamp(24px, 2.8vw, 38px);
      font-weight: 700;
      letter-spacing: -0.6px;
      line-height: 1;
    }
    #${APP_SHELL_ID} .tcu-brand-sub {
      color: #6e6e73;
      font-size: 12px;
      margin-top: 2px;
    }
    #${APP_SHELL_ID} .tcu-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }
    #${APP_SHELL_ID} .tcu-btn {
      border: 0;
      border-radius: 999px;
      padding: 9px 14px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    #${APP_SHELL_ID} .tcu-btn .icon {
      margin-right: 6px;
    }
    #${APP_SHELL_ID} .tcu-btn.primary {
      background: #0071e3;
      color: #fff;
    }
    #${APP_SHELL_ID} .tcu-btn.neutral {
      background: #e8e8ed;
      color: #1d1d1f;
    }
    #${APP_SHELL_ID} .tcu-layout {
      display: grid;
      grid-template-columns: 260px 1fr;
      min-height: 0;
    }
    #${APP_SHELL_ID} .tcu-sidebar {
      background: rgba(255, 255, 255, 0.64);
      border-right: 1px solid rgba(29, 29, 31, 0.09);
      padding: 16px 12px;
      overflow: auto;
    }
    #${APP_SHELL_ID} .tcu-nav-title {
      margin: 0 0 10px;
      font-size: 11px;
      color: #6e6e73;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    #${APP_SHELL_ID} .tcu-nav-btn {
      width: 100%;
      margin-bottom: 6px;
      padding: 11px 12px;
      border: 0;
      border-radius: 12px;
      text-align: left;
      font-size: 13px;
      font-weight: 600;
      color: #1d1d1f;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${APP_SHELL_ID} .tcu-nav-btn:hover,
    #${APP_SHELL_ID} .tcu-nav-btn.active {
      background: rgba(0, 113, 227, 0.1);
      color: #005bb5;
    }
    #${APP_SHELL_ID} .tcu-main {
      overflow: auto;
      padding: 26px 26px 30px;
      display: grid;
      gap: 20px;
      align-content: start;
    }
    #${APP_SHELL_ID} .tcu-hero {
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 2px 2px 0;
      box-shadow: none;
    }
    #${APP_SHELL_ID} .tcu-hero h1 {
      margin: 0;
      font-size: clamp(34px, 4.2vw, 56px);
      line-height: 1.08;
      letter-spacing: -1px;
    }
    #${APP_SHELL_ID} .tcu-hero p {
      margin: 10px 0 0;
      color: #6e6e73;
      font-size: 18px;
      letter-spacing: -0.2px;
    }
    #${APP_SHELL_ID} .tcu-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    #${APP_SHELL_ID} .tcu-card {
      background: #fff;
      border: 1px solid rgba(29, 29, 31, 0.07);
      border-radius: 24px;
      padding: 20px 20px 18px;
      box-shadow: 0 14px 28px rgba(0, 0, 0, 0.08);
    }
    #${APP_SHELL_ID} .tcu-card-title {
      margin: 0 0 14px;
      font-size: 24px;
      font-weight: 700;
      color: #1d1d1f;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.4px;
    }
    #${APP_SHELL_ID} .tcu-weekly-block {
      border-radius: 14px;
      border: 1px solid rgba(29, 29, 31, 0.08);
      background: #fff;
      overflow: auto;
      max-height: 58vh;
      padding: 12px;
    }
    #${APP_SHELL_ID} .tcu-weekly-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
    }
    #${APP_SHELL_ID} .tcu-weekly-cell {
      border-radius: 12px;
      border: 1px solid rgba(29, 29, 31, 0.08);
      background: #f8fbff;
      padding: 10px;
      min-height: 90px;
      display: grid;
      align-content: space-between;
      gap: 8px;
    }
    #${APP_SHELL_ID} .tcu-weekly-day {
      font-size: 12px;
      font-weight: 700;
      color: #1d1d1f;
    }
    #${APP_SHELL_ID} .tcu-weekly-link {
      font-size: 12px;
      color: #005bb5;
      text-decoration: none;
      line-height: 1.4;
      display: block;
      border-radius: 8px;
      padding: 6px 7px;
      background: rgba(0, 113, 227, 0.08);
    }
    #${APP_SHELL_ID} .tcu-weekly-link.custom {
      color: #7c2d12;
      background: #fff7ed;
      border: 1px solid #fed7aa;
    }
    #${APP_SHELL_ID} .tcu-weekly-empty {
      color: #6e6e73;
      font-size: 13px;
    }
    #${APP_SHELL_ID} .tcu-weekly-controls {
      display: grid;
      grid-template-columns: 170px 1fr auto;
      gap: 8px;
      margin-bottom: 10px;
      align-items: center;
    }
    #${APP_SHELL_ID} .tcu-weekly-controls select,
    #${APP_SHELL_ID} .tcu-weekly-controls input {
      border: 1px solid rgba(29, 29, 31, 0.14);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      background: #fff;
      color: #1d1d1f;
      min-width: 0;
    }
    #${APP_SHELL_ID} .tcu-week-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    #${APP_SHELL_ID} .tcu-week-nav-btn {
      border: 0;
      border-radius: 999px;
      width: 32px;
      height: 32px;
      font-size: 16px;
      font-weight: 700;
      background: #e8e8ed;
      color: #1d1d1f;
      cursor: pointer;
    }
    #${APP_SHELL_ID} .tcu-week-nav-label {
      font-size: 13px;
      font-weight: 700;
      color: #1d1d1f;
      min-width: 220px;
      text-align: center;
    }
    #${APP_SHELL_ID} .tcu-notice-action {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    #${APP_SHELL_ID} .tcu-notice-list {
      display: grid;
      gap: 8px;
      max-height: 38vh;
      overflow: auto;
    }
    #${APP_SHELL_ID} .tcu-notice-item {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      align-items: center;
      text-decoration: none;
      color: #1d1d1f;
      border-radius: 12px;
      border: 1px solid rgba(29, 29, 31, 0.08);
      padding: 10px;
      background: #fbfbfd;
    }
    #${APP_SHELL_ID} .tcu-notice-item:hover {
      border-color: rgba(0, 113, 227, 0.3);
      box-shadow: 0 8px 16px rgba(0, 113, 227, 0.1);
    }
    #${APP_SHELL_ID} .tcu-search-controls {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      margin-bottom: 10px;
      align-items: center;
    }
    #${APP_SHELL_ID} .tcu-search-input {
      border: 1px solid rgba(29, 29, 31, 0.14);
      border-radius: 10px;
      padding: 9px 11px;
      font-size: 13px;
      background: #fff;
      color: #1d1d1f;
      min-width: 0;
    }
    #${APP_SHELL_ID} .tcu-search-results {
      display: grid;
      gap: 8px;
      max-height: 34vh;
      overflow: auto;
    }
    #${APP_SHELL_ID} .tcu-search-item {
      display: grid;
      grid-template-columns: 30px 1fr;
      gap: 10px;
      align-items: start;
      text-decoration: none;
      color: #1d1d1f;
      border-radius: 12px;
      border: 1px solid rgba(29, 29, 31, 0.08);
      padding: 9px 10px;
      background: #fbfbfd;
    }
    #${APP_SHELL_ID} .tcu-search-item:hover {
      border-color: rgba(0, 113, 227, 0.3);
      box-shadow: 0 8px 16px rgba(0, 113, 227, 0.1);
    }
    #${APP_SHELL_ID} .tcu-search-icon {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 14px;
      background: radial-gradient(circle at 30% 20%, #f5f9ff 0%, #e5efff 60%, #dce8ff 100%);
      border: 1px solid rgba(0, 113, 227, 0.25);
    }
    #${APP_SHELL_ID} .tcu-search-title {
      font-size: 13px;
      line-height: 1.45;
      color: #005bb5;
      font-weight: 600;
    }
    #${APP_SHELL_ID} .tcu-search-meta {
      margin-top: 2px;
      font-size: 11px;
      color: #6e6e73;
    }
    #${APP_SHELL_ID} .tcu-notice-icon {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 20px;
      background: radial-gradient(circle at 30% 20%, #f5f9ff 0%, #e5efff 60%, #dce8ff 100%);
      border: 1px solid rgba(0, 113, 227, 0.25);
    }
    #${APP_SHELL_ID} .tcu-notice-text {
      font-size: 13px;
      line-height: 1.45;
      color: #005bb5;
      font-weight: 600;
    }
    #${APP_SHELL_ID} .tcu-notice-section {
      border: 1px solid rgba(29, 29, 31, 0.08);
      border-radius: 14px;
      background: #fbfbfd;
      padding: 10px;
    }
    #${APP_SHELL_ID} .tcu-notice-sections-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    #${APP_SHELL_ID} .tcu-notice-section-head {
      display: grid;
      justify-items: center;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      text-align: center;
    }
    #${APP_SHELL_ID} .tcu-notice-category-icon {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      font-size: 30px;
      background: radial-gradient(circle at 30% 20%, #f5f9ff 0%, #e5efff 60%, #dce8ff 100%);
      border: 1px solid rgba(0, 113, 227, 0.28);
    }
    #${APP_SHELL_ID} .tcu-notice-section-title {
      font-size: 14px;
      font-weight: 700;
      color: #1d1d1f;
      letter-spacing: -0.2px;
    }
    #${APP_SHELL_ID} .tcu-notice-mini-list {
      display: grid;
      gap: 6px;
      max-height: 260px;
      overflow: auto;
    }
    #${APP_SHELL_ID} .tcu-notice-mini-item {
      display: grid;
      grid-template-columns: 22px 1fr;
      align-items: start;
      gap: 8px;
      text-decoration: none;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(29, 29, 31, 0.08);
      background: #fff;
      color: #005bb5;
      font-size: 13px;
      line-height: 1.45;
    }
    #${APP_SHELL_ID} .tcu-notice-mini-item:hover {
      border-color: rgba(0, 113, 227, 0.3);
      box-shadow: 0 8px 16px rgba(0, 113, 227, 0.1);
    }
    #${APP_SHELL_ID} .tcu-notice-mini-bullet {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      font-size: 11px;
      font-weight: 700;
      color: #1d1d1f;
      background: #e8f3ff;
      border: 1px solid rgba(0, 113, 227, 0.26);
    }
    #${APP_SHELL_ID} .tcu-feature-viewer {
      border-radius: 14px;
      border: 1px solid rgba(29, 29, 31, 0.08);
      background: #fff;
      overflow: hidden;
      min-height: 420px;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    #${APP_SHELL_ID} .tcu-feature-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      border-bottom: 1px solid rgba(29, 29, 31, 0.08);
      background: #f8fafc;
    }
    #${APP_SHELL_ID} .tcu-feature-title {
      font-size: 12px;
      font-weight: 700;
      color: #1d1d1f;
      margin-right: auto;
    }
    #${APP_SHELL_ID} .tcu-feature-frame {
      width: 100%;
      min-height: 580px;
      border: 0;
      background: #fff;
    }
    #${APP_SHELL_ID}.menu-collapsed .tcu-layout {
      grid-template-columns: 0 1fr;
    }
    #${APP_SHELL_ID}.menu-collapsed .tcu-sidebar {
      width: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
    }
    @media (max-width: 980px) {
      #${APP_SHELL_ID} .tcu-layout {
        grid-template-columns: 1fr;
      }
      #${APP_SHELL_ID} .tcu-sidebar {
        display: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function buildNoticeItemsHtml(links) {
  if (links.length === 0) {
    return "<div>表示できるお知らせが見つかりませんでした。</div>";
  }
  return links
    .map(
      (item) => `
        <a class="tcu-notice-item tcu-open-raw-link" href="${item.href}" data-href="${escapeHtml(item.href)}" target="_self">
          <span class="tcu-notice-icon">🔔</span>
          <span class="tcu-notice-text">${item.text}</span>
        </a>
      `
    )
    .join("");
}

function collectNoticeSections() {
  return collectNoticeSectionsFromDocument(document, location.href, true);
}

function collectNoticeSectionsFromDocument(doc, baseHref = location.href, excludeAppShell = false) {
  const sections = NOTICE_CATEGORIES.map((category) => ({
    ...category,
    items: [],
  }));

  const isNoticeLikeContext = (text) => {
    const t = normalizeText(text);
    if (!t) return false;
    const hasDate = /\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}\(\w\)|\d{1,2}\/\d{1,2}\s*\(/.test(t);
    const hasNoticeSignals = /新着|New|NEW|件の新着|全て見る|もっと見る|お知らせ/.test(t);
    return hasDate || hasNoticeSignals;
  };
  const isNoticeRowLike = (text) => {
    const t = normalizeText(text);
    if (!t) return false;
    const hasDate = /\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}\(\w\)|\d{1,2}\/\d{1,2}\s*\([日月火水木金土]\)/.test(t);
    const hasNew = /\bnew\b|新着/i.test(t);
    return hasDate || hasNew;
  };

  const isPortalMenuLike = (text) => {
    const t = normalizeText(text);
    return /履修・成績|メッセージ受信一覧|成績照会|シラバス|各種変更|リンク集|文書ライブラリ|学生用文書ライブラリ|HOME|元UIに戻す/i.test(
      t
    );
  };

  const extractItemsFromHeading = (pattern) => {
    const headingNodes = Array.from(doc.querySelectorAll("h1,h2,h3,h4,th,strong,div,span,a,p"))
      .filter((el) => (excludeAppShell ? !isInsideAppShell(el) : true))
      .filter((el) => pattern.test(normalizeText(el.textContent)))
      .slice(0, 20);

    const found = [];
    const seen = new Set();
    headingNodes.forEach((heading) => {
      const root = heading.closest("table, section, article, div, td, li");
      if (!root) return;
      const rootText = normalizeText(root.textContent);
      if (!isNoticeLikeContext(rootText)) return;
      Array.from(root.querySelectorAll("a[href]")).forEach((a) => {
        const text = normalizeText(a.textContent);
        const href = resolveAnchorHref(a, baseHref);
        const rowText = normalizeText(a.closest("tr, li, div, section, article, td")?.textContent || "");
        if (!href || text.length < 2) return;
        if (isPortalMenuLike(text)) return;
        if (/全て見る|一覧|もっと見る|過去|次へ|前へ/i.test(text)) return;
        if (!isNoticeRowLike(rowText)) return;
        const key = `${text}__${href}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ text, href, source: baseHref });
      });
    });
    return found;
  };

  const findCategoryContainers = (pattern) => {
    const headerCandidates = Array.from(doc.querySelectorAll("h1,h2,h3,h4,th,strong,div,span,a,p"))
      .filter((el) => (excludeAppShell ? !isInsideAppShell(el) : true))
      .filter((el) => pattern.test(normalizeText(el.textContent)))
      .slice(0, 40);

    const roots = [];
    const seen = new Set();
    headerCandidates.forEach((header) => {
      const root = header.closest("table, section, article, div, td, li");
      if (!root) return;
      if (excludeAppShell && isInsideAppShell(root)) return;
      const key = root;
      if (seen.has(key)) return;
      const rootText = normalizeText(root.textContent);
      if (!isNoticeLikeContext(rootText)) return;
      const links = Array.from(root.querySelectorAll("a[href]"));
      if (links.length < 2) return;
      seen.add(key);
      roots.push(root);
    });

    if (roots.length > 0) {
      return roots;
    }

    return Array.from(doc.querySelectorAll("section, article, div, table"))
      .filter((el) => (excludeAppShell ? !isInsideAppShell(el) : true))
      .filter((el) => pattern.test(normalizeText(el.textContent)))
      .filter((el) => isNoticeLikeContext(el.textContent))
      .slice(0, 12);
  };

  const pushItem = (section, item) => {
    if (!item?.href || !item?.text) return;
    if (section.items.some((existing) => existing.href === item.href && existing.text === item.text)) {
      return;
    }
    section.items.push(item);
  };

  sections.forEach((section) => {
    const strictItems = extractItemsFromHeading(section.pattern);
    if (strictItems.length > 0) {
      strictItems.forEach((item) => pushItem(section, item));
      return;
    }
    const matchedContainers = findCategoryContainers(section.pattern);
    matchedContainers.forEach((container) => {
      Array.from(container.querySelectorAll("a[href]"))
        .filter((a) => (excludeAppShell ? !isInsideAppShell(a) : true))
        .forEach((a) => {
          const href = resolveAnchorHref(a, baseHref);
          const text = normalizeText(a.textContent);
          if (!href || text.length < 2) return;
          if (/全て見る|一覧|もっと見る|過去|次へ|前へ/i.test(text)) return;
          if (isPortalMenuLike(text)) return;
          const rowText = normalizeText(a.closest("tr, li, div, section, article, td")?.textContent || "");
          if (!isNoticeRowLike(rowText)) return;
          pushItem(section, { text, href, source: baseHref });
        });
    });
  });

  const allAnchors = Array.from(doc.querySelectorAll("a[href]")).filter((a) => (excludeAppShell ? !isInsideAppShell(a) : true));
  sections.forEach((section) => {
    if (section.items.length > 0) return;
    allAnchors.forEach((a) => {
      const title = normalizeText(a.textContent);
      const context = normalizeText(a.closest("tr, li, div, section, article")?.textContent || "");
      if (!section.pattern.test(`${title} ${context}`)) return;
      const href = resolveAnchorHref(a, baseHref);
      if (!href || title.length < 2) return;
      if (/全て見る|一覧|もっと見る|過去|次へ|前へ/i.test(title)) return;
      if (isPortalMenuLike(title)) return;
      if (!isNoticeRowLike(context)) return;
      pushItem(section, { text: title, href, source: baseHref });
    });
  });

  return sections;
}

function guessPortalTopUrl() {
  try {
    const origin = location.origin;
    const m = location.pathname.match(/^\/([^/]+)\//);
    if (m?.[1]) {
      return `${origin}/${m[1]}/top.do`;
    }
    return `${origin}/tcu_web_v3/top.do`;
  } catch (_error) {
    return "";
  }
}

function mergeNoticeSections(baseSections, extraSections) {
  const byKey = new Map();
  [...baseSections, ...extraSections].forEach((section) => {
    const existing = byKey.get(section.key) || { ...section, items: [] };
    const seen = new Set(existing.items.map((item) => `${item.text}__${item.href}`));
    section.items.forEach((item) => {
      const key = `${item.text}__${item.href}`;
      if (!seen.has(key)) {
        seen.add(key);
        existing.items.push(item);
      }
    });
    byKey.set(section.key, existing);
  });
  return NOTICE_CATEGORIES.map((category) => byKey.get(category.key) || { ...category, items: [] });
}

async function collectNoticeSectionsWithFallback() {
  const localSections = collectNoticeSections();
  const topUrl = guessPortalTopUrl();
  if (!topUrl) {
    return localSections;
  }
  try {
    const doc = await fetchDocument(topUrl);
    const topSections = collectNoticeSectionsFromDocument(doc, topUrl, false);
    return topSections;
  } catch (_error) {
    return localSections;
  }
}

function buildNoticeSectionsHtml(sections, perSectionLimit = 4) {
  if (!sections || sections.length === 0) {
    return "<div>表示できるお知らせが見つかりませんでした。</div>";
  }

  const body = sections
    .map((section) => {
      const items = section.items.slice(0, perSectionLimit);
      const listHtml =
        items.length > 0
          ? items
              .map(
                (item, index) => `
                  <a class="tcu-notice-mini-item tcu-open-raw-link" href="${item.href}" data-href="${escapeHtml(
                    item.href
                  )}" data-source="${escapeHtml(item.source || location.href)}" data-title="${escapeHtml(item.text)}" target="_self">
                    <span class="tcu-notice-mini-bullet">${index + 1}</span>
                    <span>${escapeHtml(item.text)}</span>
                  </a>
                `
              )
              .join("")
          : `<div class="tcu-weekly-empty">お知らせなし</div>`;

      return `
        <section class="tcu-notice-section">
          <div class="tcu-notice-section-head">
            <div class="tcu-notice-category-icon">${section.icon}</div>
            <div class="tcu-notice-section-title">${section.label}</div>
          </div>
          <div class="tcu-notice-mini-list">${listHtml}</div>
        </section>
      `;
    })
    .join("");

  return `<div class="tcu-notice-sections-grid">${body}</div>`;
}

function collectSearchEntries() {
  const anchors = extractSearchAnchorsFromDocument(document, location.href)
    .filter((item) => item.title.length >= 2)
    .filter((item) => item.href)
    .filter((item) => isSafePortalHref(item.href));

  const seen = new Set();
  const unique = [];
  anchors.forEach((item) => {
    const key = `${item.title}__${item.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });
  return unique;
}

function toAbsolutePortalHref(href, baseHref = location.href) {
  try {
    const absolute = new URL(href, baseHref);
    if (absolute.host !== location.host) {
      return "";
    }
    absolute.hash = "";
    const normalized = absolute.href;
    return isSafePortalHref(normalized) ? normalized : "";
  } catch (_error) {
    return "";
  }
}

function extractUrlFromScriptText(scriptText, baseHref = location.href) {
  const text = String(scriptText || "");
  if (!text) {
    return "";
  }

  const absolute = text.match(/https?:\/\/[^\s"'`);]+/i)?.[0];
  if (absolute) {
    const normalized = toAbsolutePortalHref(absolute, baseHref);
    if (normalized) return normalized;
  }

  const quotedPath = text.match(/['"]((?:\/|\.\/|\.\.\/)?[^'"`]*?\.do[^'"`]*)['"]/i)?.[1];
  if (quotedPath) {
    const normalized = toAbsolutePortalHref(quotedPath, baseHref);
    if (normalized) return normalized;
  }

  const barePath = text.match(/(?:\/|\.\/|\.\.\/)?[A-Za-z0-9_/-]*\.do(?:\?[^'"\s`)]+)?/i)?.[0];
  if (barePath && barePath.includes(".do")) {
    const normalized = toAbsolutePortalHref(barePath, baseHref);
    if (normalized) return normalized;
  }

  return "";
}

function resolveAnchorHref(anchor, baseHref = location.href) {
  const rawHref = normalizeText(anchor.getAttribute("href") || "");
  const lowerHref = rawHref.toLowerCase();

  if (rawHref && rawHref !== "#" && !lowerHref.startsWith("javascript:")) {
    const resolved = toAbsolutePortalHref(rawHref, baseHref);
    if (resolved) return resolved;
  }

  if (lowerHref.startsWith("javascript:")) {
    const fromJsHref = extractUrlFromScriptText(rawHref, baseHref);
    if (fromJsHref) return fromJsHref;
  }

  const onclick = anchor.getAttribute("onclick") || "";
  const fromOnclick = extractUrlFromScriptText(onclick, baseHref);
  if (fromOnclick) return fromOnclick;

  return "";
}

function extractSearchAnchorsFromDocument(doc, baseHref) {
  const nodes = Array.from(doc.querySelectorAll("a[href]"));
  return nodes
    .map((a) => {
      const href = resolveAnchorHref(a, baseHref);
      return {
        title: normalizeText(a.textContent),
        href,
        meta: normalizeText(a.closest("tr, li, div, section, article")?.textContent || "").slice(0, 120),
        source: baseHref,
      };
    })
    .filter((item) => item.href);
}

function dedupeSearchEntries(entries) {
  const seen = new Set();
  const unique = [];
  entries.forEach((item) => {
    const key = `${item.title}__${item.href}__${item.source || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });
  return unique;
}

function buildKeywordSnippet(text, keywordLower) {
  const source = normalizeText(text);
  if (!source) {
    return "";
  }
  if (!keywordLower) {
    return source.slice(0, 120);
  }
  const lower = source.toLowerCase();
  const idx = lower.indexOf(keywordLower);
  if (idx < 0) {
    return source.slice(0, 120);
  }
  const start = Math.max(0, idx - 36);
  const end = Math.min(source.length, idx + keywordLower.length + 52);
  return source.slice(start, end);
}

async function fetchDocument(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  return new DOMParser().parseFromString(html, "text/html");
}

async function buildDeepSearchEntries(keyword = "", maxPages = DEEP_SEARCH_MAX_PAGES) {
  const keywordLower = normalizeText(keyword).toLowerCase();
  const visitedPages = new Set();
  const queued = [];
  const queuedSet = new Set();
  const allEntries = [];

  const enqueue = (href) => {
    const normalized = toAbsolutePortalHref(href);
    if (!normalized) return;
    if (visitedPages.has(normalized) || queuedSet.has(normalized)) return;
    queued.push(normalized);
    queuedSet.add(normalized);
  };

  enqueue(location.href);
  collectSearchEntries().forEach((item) => enqueue(item.href));

  while (queued.length > 0 && visitedPages.size < maxPages) {
    const pageUrl = queued.shift();
    if (!pageUrl || visitedPages.has(pageUrl)) {
      continue;
    }
    visitedPages.add(pageUrl);

    let doc = null;
    if (pageUrl === location.href) {
      doc = document;
    } else {
      try {
        doc = await fetchDocument(pageUrl);
      } catch (_error) {
        continue;
      }
    }

    const entries = extractSearchAnchorsFromDocument(doc, pageUrl).filter((item) => item.title.length >= 2);
    allEntries.push(...entries);
    entries.forEach((item) => enqueue(item.href));

    if (keywordLower) {
      const pageTitle = normalizeText(
        doc.querySelector("h1, h2, h3, title, .title, .header")?.textContent || ""
      );
      const pageText = normalizeText(doc.body?.textContent || "");
      if (pageTitle.toLowerCase().includes(keywordLower) || pageText.toLowerCase().includes(keywordLower)) {
        allEntries.push({
          title: pageTitle || `ページ: ${pageUrl}`,
          href: pageUrl,
          meta: buildKeywordSnippet(pageText, keywordLower),
          source: pageUrl,
        });
      }
    }
  }

  return dedupeSearchEntries(allEntries);
}

async function collectDeepSearchEntries(keyword = "") {
  const key = normalizeText(keyword).toLowerCase();
  const now = Date.now();
  const cached = deepSearchCacheByKeyword.get(key);
  if (cached && now - cached.builtAt < DEEP_SEARCH_CACHE_MS) {
    return cached.entries;
  }
  if (deepSearchPromises.has(key)) {
    return deepSearchPromises.get(key);
  }

  const promise = (async () => {
    try {
      const entries = await buildDeepSearchEntries(key);
      deepSearchCacheByKeyword.set(key, {
        builtAt: Date.now(),
        entries,
      });
      return entries;
    } finally {
      deepSearchPromises.delete(key);
    }
  })();

  deepSearchPromises.set(key, promise);
  return promise;
}

function collectPortalMenuLinks(entries) {
  const priorityPattern = /履修|メッセージ|教務掲示板|掲示板|シラバス|成績|各種変更|リンク集|文書ライブラリ|home|ホーム/i;
  const preferred = entries
    .filter((item) => priorityPattern.test(item.title))
    .filter((item) => !/ログアウト|終了|閉じる/i.test(item.title))
    .slice(0, 14);
  if (preferred.length >= 5) {
    return preferred;
  }
  return entries
    .filter((item) => !/ログアウト|終了|閉じる/i.test(item.title))
    .slice(0, 14);
}

function isSidebarPortalItem(title) {
  return /履修|メッセージ|教務掲示板|掲示板|シラバス|成績|各種変更|リンク集|文書ライブラリ|home|ホーム/i.test(
    title
  );
}

function renderSearchResults(container, entries, keyword = "") {
  if (!container) {
    return;
  }
  const q = normalizeText(keyword).toLowerCase();
  if (!q) {
    container.innerHTML = `<div class="tcu-weekly-empty">キーワードを入力してください。</div>`;
    return;
  }
  const filtered = entries.filter((item) => item.title.toLowerCase().includes(q) || item.meta.toLowerCase().includes(q));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="tcu-weekly-empty">一致する情報がありません。</div>`;
    return;
  }

  searchEntryStore.clear();
  container.innerHTML = filtered
    .slice(0, 80)
    .map((item, index) => {
      const entryId = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      searchEntryStore.set(entryId, item);
      return `
        <a class="tcu-search-item tcu-open-raw-link" href="${item.href}" data-href="${escapeHtml(
          item.href
        )}" data-source="${escapeHtml(item.source || "")}" data-title="${escapeHtml(item.title)}" data-entry-id="${entryId}" target="_self">
          <span class="tcu-search-icon">🔎</span>
          <span>
            <div class="tcu-search-title">${item.title}</div>
            <div class="tcu-search-meta">${item.meta}</div>
          </span>
        </a>
      `;
    })
    .join("");
}

function isLikelyPortalHome(url) {
  const text = String(url || "").toLowerCase();
  return /\/top\.do(?:\?|$)|\/home(?:\.do)?(?:\?|$)/.test(text);
}

function clickOriginalAnchorForEntry(entry) {
  if (!entry || entry.source !== location.href) {
    return false;
  }
  const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => !isInsideAppShell(a));
  const title = normalizeText(entry.title);
  const candidate = anchors.find((a) => {
    const anchorTitle = normalizeText(a.textContent);
    if (anchorTitle !== title) {
      return false;
    }
    const resolved = resolveAnchorHref(a, location.href);
    return resolved === entry.href;
  });
  if (!candidate) {
    return false;
  }
  setCustomUiEnabled(false);
  candidate.click();
  return true;
}

function tryHandlePendingNavigation() {
  const pending = getPendingNavigation();
  if (!pending) {
    return false;
  }

  const now = Date.now();
  if (!pending.createdAt || now - pending.createdAt > 1000 * 60 * 5) {
    clearPendingNavigation();
    return false;
  }

  if (!pending.source || pending.source !== location.href) {
    return false;
  }

  const anchors = Array.from(document.querySelectorAll("a[href]")).filter((a) => !isInsideAppShell(a));
  const target = anchors.find((a) => {
    const anchorTitle = normalizeText(a.textContent);
    const resolved = resolveAnchorHref(a, location.href);
    if (pending.href && resolved === pending.href) {
      return true;
    }
    if (pending.title && anchorTitle === pending.title) {
      return true;
    }
    return false;
  });

  if (!target) {
    return false;
  }

  clearPendingNavigation();
  setCustomUiEnabled(false);
  target.click();
  return true;
}

function loadCustomWeeklyEvents() {
  try {
    const raw = safeStorageGet(CUSTOM_WEEKLY_EVENTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function saveCustomWeeklyEvents(events) {
  safeStorageSet(CUSTOM_WEEKLY_EVENTS_KEY, JSON.stringify(events));
}

function getWeekStartDate(baseDate, offset) {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday + offset * 7);
  return date;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildWeekDays(offset) {
  const weekday = ["日", "月", "火", "水", "木", "金", "土"];
  const start = getWeekStartDate(new Date(), offset);
  const startKey = formatDateKey(start);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const label = `${current.getMonth() + 1}/${current.getDate()}(${weekday[current.getDay()]})`;
    days.push({
      key: `${startKey}-d${i}`,
      label,
      date: new Date(current.getFullYear(), current.getMonth(), current.getDate()),
      items: [],
    });
  }
  return { days };
}

function formatWeekRange(offset) {
  const start = getWeekStartDate(new Date(), offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function isInsideAppShell(element) {
  return Boolean(element?.closest?.(`#${APP_SHELL_ID}`));
}

function collectPortalWeeklyEvents(weeklyRoot, weekDays) {
  if (!weeklyRoot || weekDays.length === 0) {
    return new Map();
  }

  const eventsByDay = new Map(weekDays.map((day) => [day.key, []]));
  const dayMatchers = weekDays.map((day) => {
    const m = day.date.getMonth() + 1;
    const d = day.date.getDate();
    return {
      key: day.key,
      patterns: [`${m}/${d}`, `${m} / ${d}`, `${m}月${d}日`],
    };
  });

  const linkNodes = Array.from(weeklyRoot.querySelectorAll("a[href]"))
    .filter((a) => !isInsideAppShell(a))
    .filter((a) => isSafePortalHref(a.href));

  linkNodes.forEach((a) => {
    const text = normalizeText(a.textContent);
    if (!text || /全て見る|一覧|もっと|前週|次週|週|月曜?|火曜?|水曜?|木曜?|金曜?|土曜?|日曜?/i.test(text)) {
      return;
    }
    const context = normalizeText(a.closest("td, tr, li, div, section")?.textContent || "");
    const targetDay = dayMatchers.find((entry) => entry.patterns.some((pattern) => context.includes(pattern)));
    if (!targetDay) {
      return;
    }
    const list = eventsByDay.get(targetDay.key);
    if (!list) {
      return;
    }
    if (list.some((item) => item.text === text && item.href === a.href)) {
      return;
    }
    list.push({ type: "portal", text, href: a.href });
  });

  return eventsByDay;
}

function renderWeeklyCalendar(weeklyMount, _weeklyRoot, weekOffset = 0) {
  if (!weeklyMount) {
    return;
  }
  try {
    const { days: base } = buildWeekDays(weekOffset);
    const portalEvents = collectPortalWeeklyEvents(_weeklyRoot, base);
    const custom = loadCustomWeeklyEvents();
    const merged = base.map((day) => {
      const portal = portalEvents.get(day.key) || [];
      const add = custom
        .filter((item) => item.dayKey === day.key)
        .map((item) => ({ type: "custom", text: item.text }));
      return { ...day, items: [...portal, ...day.items, ...add] };
    });

    const html = merged
      .map((day) => {
        const items =
          day.items.length > 0
            ? day.items
                .map((item) => {
                  if (item.type === "custom") {
                    return `<div class="tcu-weekly-link custom">🗓️ ${item.text}</div>`;
                  }
                  return `<a class="tcu-weekly-link" href="${item.href}" target="_self">📌 ${item.text}</a>`;
                })
                .join("")
            : `<div class="tcu-weekly-empty">予定なし</div>`;

        return `
          <article class="tcu-weekly-cell" data-day-key="${day.key}">
            <div class="tcu-weekly-day">${day.label}</div>
            <div>${items}</div>
          </article>
        `;
      })
      .join("");

    weeklyMount.innerHTML = `<div class="tcu-weekly-summary">${html}</div>`;

    const daySelect = document.getElementById("tcu-weekly-day-select");
    if (daySelect) {
      daySelect.innerHTML = merged.map((day) => `<option value="${day.key}">${day.label}</option>`).join("");
    }

    const weekLabel = document.getElementById("tcu-week-nav-label");
    if (weekLabel) {
      weekLabel.textContent = `${formatWeekRange(weekOffset)}`;
    }
  } catch (_error) {
    weeklyMount.innerHTML = `<div class="tcu-weekly-empty">週間スケジュールの読込に失敗しました</div>`;
  }

}

function ensurePortalAppShell() {
  if (window.top !== window) {
    return;
  }
  if (document.getElementById(APP_SHELL_ID)) {
    return;
  }
  if (!document.body) {
    return;
  }

  const weeklyRoot = findWeeklyScheduleRoot();
  const noticeLinks = collectNoticeLinks().slice(0, 80);
  let noticeSections = collectNoticeSections();

  ensurePortalAppShellStyle();

  const shell = document.createElement("div");
  shell.id = APP_SHELL_ID;
  shell.className = "menu-open";
  shell.innerHTML = `
    <header class="tcu-topbar">
      <button class="tcu-menu-btn" type="button" id="tcu-shell-menu-btn">☰</button>
      <div class="tcu-brand"><span class="tcu-brand-icon">🎓</span><span class="tcu-brand-main">ポータル</span><span class="tcu-brand-sub">TCU Store-like UI</span></div>
      <div class="tcu-toolbar">
        <button class="tcu-btn neutral" id="tcu-shell-raw-btn" type="button"><span class="icon">⇄</span>元UIに戻す</button>
      </div>
    </header>
    <div class="tcu-layout">
      <aside class="tcu-sidebar">
        <p class="tcu-nav-title">Menu</p>
        <button class="tcu-nav-btn" id="tcu-shell-go-weekly"><span>📅</span><span>週間スケジュール</span></button>
        <button class="tcu-nav-btn" id="tcu-shell-go-search"><span>🔎</span><span>検索</span></button>
        <button class="tcu-nav-btn" id="tcu-shell-go-notice"><span>🔔</span><span>お知らせ一覧</span></button>
        <p class="tcu-nav-title">Portal</p>
        <div id="tcu-shell-portal-links"></div>
        <button class="tcu-nav-btn" id="tcu-shell-go-raw"><span>⇄</span><span>元UIに戻す</span></button>
      </aside>
      <main class="tcu-main">
        <section class="tcu-hero">
          <h1>🎓 大学のポータルサイトを、もっとシンプルに。</h1>
          <p>見たい情報だけを残した、Appleライクなフルスクリーン表示です。</p>
        </section>
        <section class="tcu-grid">
          <article class="tcu-card" id="tcu-shell-weekly-card">
            <h3 class="tcu-card-title"><span>📅</span><span>週間スケジュール</span></h3>
            <div class="tcu-week-nav">
              <button class="tcu-week-nav-btn" id="tcu-week-prev-btn" type="button">&lt;</button>
              <div class="tcu-week-nav-label" id="tcu-week-nav-label"></div>
              <button class="tcu-week-nav-btn" id="tcu-week-next-btn" type="button">&gt;</button>
            </div>
            <div class="tcu-weekly-controls">
              <select id="tcu-weekly-day-select"></select>
              <input id="tcu-weekly-event-input" type="text" placeholder="自由に予定を追加" />
              <button class="tcu-btn primary" id="tcu-weekly-add-btn" type="button">追加</button>
            </div>
            <div class="tcu-weekly-controls">
              <button class="tcu-btn neutral" id="tcu-weekly-refresh-btn" type="button">↻ ポータル反映</button>
              <button class="tcu-btn neutral" id="tcu-weekly-clear-btn" type="button">自分の予定を消去</button>
              <div></div>
            </div>
            <div class="tcu-weekly-block" id="tcu-weekly-calendar-mount"></div>
          </article>
          <article class="tcu-card" id="tcu-shell-search-card">
            <h3 class="tcu-card-title"><span>🔎</span><span>検索</span></h3>
            <div class="tcu-search-controls">
              <input class="tcu-search-input" id="tcu-shell-search-input" type="text" placeholder="授業名・キーワードで検索" />
              <button class="tcu-btn primary" id="tcu-shell-search-btn" type="button">検索</button>
              <button class="tcu-btn neutral" id="tcu-shell-search-clear-btn" type="button">クリア</button>
            </div>
            <div class="tcu-search-results" id="tcu-shell-search-results"></div>
          </article>
          <article class="tcu-card" id="tcu-shell-notice-card">
            <h3 class="tcu-card-title"><span>🔔</span><span>お知らせ</span></h3>
            <div class="tcu-notice-action">
              <button class="tcu-btn primary" id="tcu-shell-all-notice-btn" type="button"><span class="icon">🔔</span>今までのお知らせをすべて見る</button>
            </div>
            <div class="tcu-notice-list" id="tcu-shell-notice-list"></div>
          </article>
        </section>
      </main>
    </div>
  `;

  document.body.classList.add("tcu-appshell-mode");
  document.body.appendChild(shell);

  const noticeList = shell.querySelector("#tcu-shell-notice-list");
  const searchCard = shell.querySelector("#tcu-shell-search-card");
  const searchInput = shell.querySelector("#tcu-shell-search-input");
  const searchResults = shell.querySelector("#tcu-shell-search-results");
  const portalLinksWrap = shell.querySelector("#tcu-shell-portal-links");
  const weeklyMount = shell.querySelector("#tcu-weekly-calendar-mount");
  const weeklyDaySelect = shell.querySelector("#tcu-weekly-day-select");
  const weeklyEventInput = shell.querySelector("#tcu-weekly-event-input");
  const weeklyCard = shell.querySelector("#tcu-shell-weekly-card");
  const noticeCard = shell.querySelector("#tcu-shell-notice-card");
  const searchEntries = collectSearchEntries();
  const filteredSearchEntries = searchEntries.filter((item) => !isSidebarPortalItem(item.title));
  const portalMenuLinks = collectPortalMenuLinks(searchEntries);

  try {
    renderWeeklyCalendar(weeklyMount, weeklyRoot, weeklyViewOffset);
  } catch (_error) {
    // ignore initial render errors
  }
  if (noticeList) {
    try {
      noticeList.innerHTML = `<div class="tcu-weekly-empty">お知らせを読み込み中...</div>`;
    } catch (_error) {
      noticeList.innerHTML = `<div>お知らせの読込に失敗しました</div>`;
    }
  }
  (async () => {
    try {
      noticeSections = await collectNoticeSectionsWithFallback();
      if (noticeList) {
        noticeList.innerHTML = buildNoticeSectionsHtml(noticeSections, 4);
      }
    } catch (_error) {
      if (noticeList) {
        noticeList.innerHTML = buildNoticeSectionsHtml(noticeSections, 4);
      }
    }
  })();
  if (searchResults) {
    try {
      renderSearchResults(searchResults, filteredSearchEntries, "");
    } catch (_error) {
      searchResults.innerHTML = `<div class="tcu-weekly-empty">検索の初期化に失敗しました。</div>`;
    }
  }
  if (portalLinksWrap) {
    try {
      portalLinksWrap.innerHTML = portalMenuLinks
        .map(
          (item) =>
            `<button class="tcu-nav-btn tcu-shell-portal-link" data-href="${escapeHtml(item.href)}"><span>${iconForLabel(item.title)}</span><span>${escapeHtml(item.title)}</span></button>`
        )
        .join("");
    } catch (_error) {
      portalLinksWrap.innerHTML = "";
    }
  }

  const goRaw = () => {
    setCustomUiEnabled(false);
    applyUiMode();
  };

  const goWeekly = () => {
    weeklyCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const goSearch = () => {
    searchCard?.scrollIntoView({ behavior: "smooth", block: "start" });
    searchInput?.focus();
  };
  const goNotice = () => {
    noticeCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const doSearch = async () => {
    if (!searchResults) return;
    const keyword = searchInput?.value || "";
    if (!normalizeText(keyword)) {
      renderSearchResults(searchResults, filteredSearchEntries, "");
      return;
    }
    searchResults.innerHTML = `<div class="tcu-weekly-empty">ポータル全体を検索中...</div>`;
    try {
      const latestLocal = collectSearchEntries();
      const deepEntries = await collectDeepSearchEntries(keyword);
      const merged = dedupeSearchEntries([...latestLocal, ...deepEntries]);
      renderSearchResults(searchResults, merged, keyword);
    } catch (_error) {
      renderSearchResults(searchResults, filteredSearchEntries, keyword);
    }
  };
  const clearSearch = () => {
    if (!searchInput || !searchResults) return;
    searchInput.value = "";
    renderSearchResults(searchResults, filteredSearchEntries, "");
  };
  const addWeeklyEvent = () => {
    if (!weeklyDaySelect || !weeklyEventInput) return;
    const dayKey = weeklyDaySelect.value;
    const text = normalizeText(weeklyEventInput.value);
    if (!dayKey || !text) return;
    const events = loadCustomWeeklyEvents();
    events.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dayKey,
      text,
    });
    saveCustomWeeklyEvents(events);
    weeklyEventInput.value = "";
    renderWeeklyCalendar(weeklyMount, findWeeklyScheduleRoot(), weeklyViewOffset);
  };
  const refreshWeekly = () => {
    renderWeeklyCalendar(weeklyMount, findWeeklyScheduleRoot(), weeklyViewOffset);
  };
  const clearWeekly = () => {
    saveCustomWeeklyEvents([]);
    renderWeeklyCalendar(weeklyMount, findWeeklyScheduleRoot(), weeklyViewOffset);
  };
  const prevWeek = () => {
    weeklyViewOffset -= 1;
    renderWeeklyCalendar(weeklyMount, findWeeklyScheduleRoot(), weeklyViewOffset);
  };
  const nextWeek = () => {
    weeklyViewOffset += 1;
    renderWeeklyCalendar(weeklyMount, findWeeklyScheduleRoot(), weeklyViewOffset);
  };
  const openAllNotices = () => {
    const latestSections = noticeSections;
    if (noticeList) {
      noticeList.innerHTML = buildNoticeSectionsHtml(latestSections, 100);
      return;
    }
    const allPage = findAllNoticePageLink();
    if (allPage) {
      navigatePortal(allPage);
    }
    noticeCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  shell.addEventListener("click", (event) => {
    const rawLink = event.target?.closest?.("a.tcu-open-raw-link");
    if (rawLink && shell.contains(rawLink)) {
      const href = rawLink.getAttribute("data-href") || rawLink.getAttribute("href") || "";
      const source = rawLink.getAttribute("data-source") || "";
      const entryId = rawLink.getAttribute("data-entry-id") || "";
      if (href) {
        event.preventDefault();
        const entry = entryId ? searchEntryStore.get(entryId) : null;
        if (entry && clickOriginalAnchorForEntry(entry)) {
          return;
        }
        if (entry && entry.source && entry.source !== location.href) {
          setPendingNavigation(entry);
          setCustomUiEnabled(false);
          navigatePortal(entry.source);
          return;
        }
        if (isLikelyPortalHome(href) && source && source !== href) {
          setCustomUiEnabled(false);
          navigatePortal(source);
          return;
        }
        setCustomUiEnabled(false);
        navigatePortal(href);
      }
      return;
    }

    const button = event.target?.closest?.("button, .tcu-shell-portal-link");
    if (!button || !shell.contains(button)) {
      return;
    }
    try {
      if (button.classList.contains("tcu-shell-portal-link")) {
        const href = button.getAttribute("data-href");
        if (href) {
          navigatePortal(href);
        }
        return;
      }
      switch (button.id) {
        case "tcu-shell-menu-btn":
          shell.classList.toggle("menu-collapsed");
          return;
        case "tcu-shell-raw-btn":
        case "tcu-shell-go-raw":
          goRaw();
          return;
        case "tcu-shell-go-weekly":
          goWeekly();
          return;
        case "tcu-shell-go-search":
          goSearch();
          return;
        case "tcu-shell-go-notice":
          goNotice();
          return;
        case "tcu-shell-search-btn":
          doSearch();
          return;
        case "tcu-shell-search-clear-btn":
          clearSearch();
          return;
        case "tcu-weekly-add-btn":
          addWeeklyEvent();
          return;
        case "tcu-weekly-refresh-btn":
          refreshWeekly();
          return;
        case "tcu-weekly-clear-btn":
          clearWeekly();
          return;
        case "tcu-week-prev-btn":
          prevWeek();
          return;
        case "tcu-week-next-btn":
          nextWeek();
          return;
        case "tcu-shell-all-notice-btn":
          openAllNotices();
          return;
        default:
          return;
      }
    } catch (_error) {
      // Keep UI interactive even if one action fails.
    }
  });

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      doSearch();
    }
  });

  if (weeklyObserver) {
    weeklyObserver.disconnect();
    weeklyObserver = null;
  }
}

function ensureWeeklyScheduleStyle() {
  if (document.getElementById(WEEKLY_UI_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = WEEKLY_UI_STYLE_ID;
  style.textContent = `
    .tcu-weekly-enhanced {
      border-radius: 16px !important;
      border: 1px solid rgba(29, 29, 31, 0.12) !important;
      background: rgba(255, 255, 255, 0.92) !important;
      box-shadow: 0 14px 28px rgba(0, 0, 0, 0.10) !important;
      overflow: hidden !important;
      backdrop-filter: blur(8px);
    }
    .tcu-weekly-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(29, 29, 31, 0.08);
      background: linear-gradient(180deg, #ffffff 0%, #f8faff 100%);
    }
    .tcu-weekly-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: #e8f2ff;
      border: 1px solid rgba(0, 113, 227, 0.28);
      font-size: 18px;
    }
    .tcu-weekly-title {
      font-size: 15px;
      font-weight: 700;
      color: #1d1d1f;
      letter-spacing: -0.1px;
    }
    .tcu-all-notice-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 10px 0 12px;
      padding: 10px 14px;
      border: 0;
      border-radius: 999px;
      background: #0071e3;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 20px rgba(0, 113, 227, 0.25);
    }
    .tcu-all-notice-btn:hover {
      background: #0066cc;
    }
    #${ALL_NOTICE_MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0, 0, 0, 0.35);
      display: none;
      place-items: center;
    }
    #${ALL_NOTICE_MODAL_ID}.open {
      display: grid;
    }
    #${ALL_NOTICE_MODAL_ID} .modal-card {
      width: min(860px, calc(100vw - 24px));
      max-height: min(78vh, 760px);
      overflow: auto;
      border-radius: 16px;
      background: #fff;
      border: 1px solid rgba(29, 29, 31, 0.12);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", sans-serif;
    }
    #${ALL_NOTICE_MODAL_ID} .modal-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    #${ALL_NOTICE_MODAL_ID} .modal-title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: #1d1d1f;
    }
    #${ALL_NOTICE_MODAL_ID} .modal-close {
      border: 0;
      background: #f2f2f7;
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #${ALL_NOTICE_MODAL_ID} .modal-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }
    #${ALL_NOTICE_MODAL_ID} .modal-list a {
      display: block;
      padding: 10px 12px;
      border-radius: 10px;
      text-decoration: none;
      color: #005bb5;
      background: #f3f8ff;
      border: 1px solid #d8e8ff;
      font-size: 13px;
      line-height: 1.45;
    }
  `;
  document.head.appendChild(style);
}

function findWeeklyScheduleRoot() {
  const candidates = Array.from(document.querySelectorAll("div, section, article, table"));
  const primary = candidates.find((el) => {
    if (isInsideAppShell(el)) {
      return false;
    }
    const text = normalizeText(el.textContent);
    if (!text.includes("週間スケジュール")) {
      return false;
    }
    const dayMatches = text.match(/\d{1,2}\/\d{1,2}\([日月火水木金土]\)/g);
    return (dayMatches?.length || 0) >= 5;
  });
  if (primary) {
    return primary;
  }

  return (
    candidates.find((el) => !isInsideAppShell(el) && normalizeText(el.textContent).includes("週間スケジュール")) || null
  );
}

function enhanceWeeklyScheduleOnly() {
  const root = findWeeklyScheduleRoot();
  if (!root || root.classList.contains("tcu-weekly-enhanced")) {
    return;
  }

  root.classList.add("tcu-weekly-enhanced");
  const header = document.createElement("div");
  header.className = "tcu-weekly-header";
  header.innerHTML = `
    <div class="tcu-weekly-icon">📅</div>
    <div class="tcu-weekly-title">週間スケジュール</div>
  `;
  root.insertBefore(header, root.firstChild);
}

function collectNoticeLinks() {
  const linkNodes = Array.from(document.querySelectorAll("a[href]"));
  const links = linkNodes
    .map((a) => ({
      text: normalizeText(a.textContent),
      href: a.href,
    }))
    .filter((item) => item.text.length >= 2)
    .filter((item) => isSafePortalHref(item.href))
    .filter((item) => /お知らせ|講義|大学|あなた宛|news|通知/i.test(item.text));

  const seen = new Set();
  const unique = [];
  links.forEach((item) => {
    const key = `${item.text}__${item.href}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });
  return unique;
}

function findAllNoticePageLink() {
  const allLink = Array.from(document.querySelectorAll("a[href]")).find((a) =>
    /全て見る|一覧|もっと見る|過去|お知らせ一覧/i.test(normalizeText(a.textContent))
  );
  return isSafePortalHref(allLink?.href || "") ? allLink.href : "";
}

function ensureNoticeModal() {
  if (document.getElementById(ALL_NOTICE_MODAL_ID)) {
    return document.getElementById(ALL_NOTICE_MODAL_ID);
  }

  const modal = document.createElement("div");
  modal.id = ALL_NOTICE_MODAL_ID;
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h2 class="modal-title">すべてのお知らせ</h2>
        <button class="modal-close" type="button">閉じる</button>
      </div>
      <ul class="modal-list"></ul>
    </div>
  `;
  document.body.appendChild(modal);

  const close = modal.querySelector(".modal-close");
  close.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.remove("open");
    }
  });
  return modal;
}

function ensureAllNoticesButton() {
  if (document.getElementById("tcu-all-notice-btn")) {
    return;
  }

  const anchor = findWeeklyScheduleRoot() || document.body.firstElementChild || document.body;
  if (!anchor || !anchor.parentElement) {
    return;
  }

  const button = document.createElement("button");
  button.id = "tcu-all-notice-btn";
  button.className = "tcu-all-notice-btn";
  button.type = "button";
  button.innerHTML = `<span>🔔</span><span>今までのお知らせをすべて見る</span>`;
  anchor.parentElement.insertBefore(button, anchor.nextSibling);

  button.addEventListener("click", () => {
    const allPage = findAllNoticePageLink();
    if (allPage) {
      navigatePortal(allPage);
      return;
    }

    const links = collectNoticeLinks();
    const modal = ensureNoticeModal();
    const list = modal.querySelector(".modal-list");
    if (links.length === 0) {
      list.innerHTML = "<li>表示できるお知らせが見つかりませんでした。</li>";
    } else {
      list.innerHTML = links
        .map((item) => `<li><a href="${item.href}" target="_self">${item.text}</a></li>`)
        .join("");
    }
    modal.classList.add("open");
  });
}

function isCustomUiEnabled() {
  const saved = safeStorageGet(UI_MODE_KEY);
  return saved !== "0";
}

function setCustomUiEnabled(enabled) {
  safeStorageSet(UI_MODE_KEY, enabled ? "1" : "0");
}

function initializeUiStyleVersion() {
  const savedVersion = safeStorageGet(UI_STYLE_VERSION_KEY);
  if (savedVersion !== UI_STYLE_VERSION) {
    safeStorageSet(UI_STYLE_VERSION_KEY, UI_STYLE_VERSION);
    setCustomUiEnabled(true);
  }
}

function cleanupCustomUi() {
  if (weeklyObserver) {
    weeklyObserver.disconnect();
    weeklyObserver = null;
  }

  document.querySelectorAll(".tcu-weekly-header").forEach((el) => el.remove());
  document.querySelectorAll(".tcu-weekly-enhanced").forEach((el) => {
    el.classList.remove("tcu-weekly-enhanced");
  });

  const noticeButton = document.getElementById("tcu-all-notice-btn");
  if (noticeButton) {
    noticeButton.remove();
  }
  const modal = document.getElementById(ALL_NOTICE_MODAL_ID);
  if (modal) {
    modal.remove();
  }

  const inlineBar = document.getElementById(INLINE_SEARCH_BAR_ID);
  if (inlineBar) {
    inlineBar.remove();
  }
  const inlineLauncher = document.getElementById(INLINE_SEARCH_LAUNCHER_ID);
  if (inlineLauncher) {
    inlineLauncher.remove();
  }
  const inlineStyle = document.getElementById(INLINE_SEARCH_STYLE_ID);
  if (inlineStyle) {
    inlineStyle.remove();
  }

  const uxLauncher = document.getElementById("tcu-ux-launcher");
  if (uxLauncher) {
    uxLauncher.remove();
  }
  const uxPanel = document.getElementById("tcu-ux-panel");
  if (uxPanel) {
    uxPanel.remove();
  }

  const appShell = document.getElementById(APP_SHELL_ID);
  if (appShell) {
    appShell.remove();
  }
  const shellStyle = document.getElementById(APP_SHELL_STYLE_ID);
  if (shellStyle) {
    shellStyle.remove();
  }
  const portalStyle = document.getElementById("tcu-portal-ui-style");
  if (portalStyle) {
    portalStyle.remove();
  }
  safeStorageRemove("tcu_custom_weekly_events_v1");
  safeStorageRemove(CUSTOM_WEEKLY_EVENTS_KEY);
  document.documentElement.classList.remove("tcu-ux-enhanced", "tcu-ux-compact", "tcu-ux-focus");
  document.body.classList.remove("tcu-appshell-mode");
}

function applyUiMode() {
  cleanupCustomUi();
  if (isCustomUiEnabled()) {
    // Full-screen replacement UI mode.
    ensurePortalAppShell();
  }
  syncUiModeToggle();
}

function syncUiModeToggle() {
  const toggle = document.getElementById(UI_TOGGLE_ID);
  if (!toggle) {
    return;
  }
  const enabled = isCustomUiEnabled();
  toggle.textContent = enabled ? "元UIに戻す" : "Apple風UIにする";
  toggle.style.background = enabled ? "#1d1d1f" : "#0071e3";
  toggle.style.color = "#ffffff";
}

function ensureUiModeToggle() {
  if (document.getElementById(UI_TOGGLE_ID)) {
    return;
  }
  if (!document.body) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.id = UI_TOGGLE_ID;
  toggle.type = "button";
  toggle.style.position = "fixed";
  toggle.style.top = "10px";
  toggle.style.right = "10px";
  toggle.style.zIndex = "2147483647";
  toggle.style.border = "0";
  toggle.style.borderRadius = "999px";
  toggle.style.padding = "8px 12px";
  toggle.style.fontSize = "12px";
  toggle.style.fontWeight = "700";
  toggle.style.cursor = "pointer";
  toggle.style.boxShadow = "0 8px 20px rgba(0,0,0,0.18)";

  toggle.addEventListener("click", () => {
    setCustomUiEnabled(!isCustomUiEnabled());
    applyUiMode();
  });

  syncUiModeToggle();
  document.body.appendChild(toggle);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "deepSearch") {
    expandAndSearch((message.keyword || "").trim())
      .then(() => {
        sendResponse(getResultPayload());
      })
      .catch(() => {
        sendResponse(getResultPayload());
      });
    return true;
  }

  switch (message?.type) {
    case "search":
      sendResponse(runSearch("search", message.keyword || ""));
      break;
    case "next":
      sendResponse(runSearch("next"));
      break;
    case "prev":
      sendResponse(runSearch("prev"));
      break;
    case "clear":
      sendResponse(runSearch("clear"));
      break;
    default:
      sendResponse(getResultPayload());
      break;
  }

  return true;
});

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      if (tryHandlePendingNavigation()) {
        return;
      }
      initializeUiStyleVersion();
      ensureUiModeToggle();
      applyUiMode();
    },
    { once: true }
  );
} else {
  if (!tryHandlePendingNavigation()) {
  initializeUiStyleVersion();
  ensureUiModeToggle();
  applyUiMode();
  }
}
