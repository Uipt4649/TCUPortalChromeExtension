const SEARCH_HIGHLIGHT_CLASS = "tcu-search-highlight";
const SEARCH_ACTIVE_CLASS = "tcu-search-active";

const searchState = {
  matches: [],
  currentIndex: -1,
  keyword: "",
};

function ensurePortalUiStyle() {
  if (document.getElementById("tcu-portal-ui-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "tcu-portal-ui-style";
  style.textContent = `
    :root {
      --tcu-bg: #f5f7fb;
      --tcu-card: #ffffff;
      --tcu-text: #111827;
      --tcu-muted: #475569;
      --tcu-line: #dce5f0;
      --tcu-accent: #0f4c81;
      --tcu-accent-soft: #e8f1ff;
    }

    body {
      background: linear-gradient(180deg, #eef3fb 0%, var(--tcu-bg) 100%) !important;
      color: var(--tcu-text) !important;
      font-family: "Hiragino Sans", "Yu Gothic", "Avenir Next", sans-serif !important;
      line-height: 1.55 !important;
      letter-spacing: 0.1px !important;
    }

    #main, #contents, #content, #container, .container, .main, .contents, .wrapper {
      max-width: 1200px !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    .news, .box, .panel, .module, .section, .content-box, .list-box,
    [class*="news"], [class*="notice"], [id*="news"], [id*="notice"] {
      background: var(--tcu-card) !important;
      border: 1px solid var(--tcu-line) !important;
      border-radius: 12px !important;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08) !important;
      overflow: hidden !important;
    }

    table {
      border-collapse: separate !important;
      border-spacing: 0 !important;
      width: 100% !important;
      background: var(--tcu-card) !important;
    }

    th, td {
      border-bottom: 1px solid #e8edf5 !important;
      padding: 8px 10px !important;
      vertical-align: top !important;
      color: var(--tcu-text) !important;
      font-size: 14px !important;
    }

    tr:nth-child(even) td {
      background: #fbfdff !important;
    }

    tr:hover td {
      background: var(--tcu-accent-soft) !important;
    }

    a {
      color: var(--tcu-accent) !important;
      text-decoration-thickness: 1.5px !important;
      text-underline-offset: 2px !important;
      font-weight: 600 !important;
    }

    .new, .label-new, [class*="new"] {
      border-radius: 999px !important;
      padding: 2px 8px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      background: #ffe7e7 !important;
      color: #9f1239 !important;
    }

    input, select, textarea, button {
      font-family: inherit !important;
      font-size: 14px !important;
    }

    button, input[type="button"], input[type="submit"] {
      border-radius: 8px !important;
    }
  `;
  document.head.appendChild(style);
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
      highlightKeyword((message.keyword || "").trim());
      sendResponse(getResultPayload());
      break;
    case "next":
      if (searchState.matches.length > 0) {
        setActiveMatch(searchState.currentIndex + 1);
      }
      sendResponse(getResultPayload());
      break;
    case "prev":
      if (searchState.matches.length > 0) {
        setActiveMatch(searchState.currentIndex - 1);
      }
      sendResponse(getResultPayload());
      break;
    case "clear":
      clearHighlights();
      sendResponse(getResultPayload());
      break;
    default:
      sendResponse(getResultPayload());
      break;
  }

  return true;
});

ensurePortalUiStyle();
