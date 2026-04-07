const SEARCH_HIGHLIGHT_CLASS = "tcu-search-highlight";
const SEARCH_ACTIVE_CLASS = "tcu-search-active";

const searchState = {
  matches: [],
  currentIndex: -1,
  keyword: "",
};

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
