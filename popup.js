const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const nextButton = document.getElementById("nextButton");
const prevButton = document.getElementById("prevButton");
const clearButton = document.getElementById("clearButton");
const deepSearchButton = document.getElementById("deepSearchButton");
const statusText = document.getElementById("statusText");

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function sendToActiveTab(message) {
  const tabId = await getActiveTabId();
  if (!tabId) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    return null;
  }
}

function updateStatus(result) {
  if (!result) {
    statusText.textContent = "このページでは検索できません";
    return;
  }

  if (result.count === 0) {
    statusText.textContent = "一致なし";
    return;
  }

  statusText.textContent = `${result.count}件中 ${result.current + 1}件目`;
}

async function search() {
  const keyword = searchInput.value.trim();
  if (!keyword) {
    statusText.textContent = "キーワードを入力してください";
    return;
  }

  const result = await sendToActiveTab({ type: "search", keyword });
  updateStatus(result);
}

async function deepSearch() {
  const keyword = searchInput.value.trim();
  if (!keyword) {
    statusText.textContent = "キーワードを入力してください";
    return;
  }

  statusText.textContent = "詳細を展開して検索中...";
  const result = await sendToActiveTab({ type: "deepSearch", keyword });
  updateStatus(result);
}

async function move(direction) {
  const result = await sendToActiveTab({ type: direction });
  updateStatus(result);
}

async function clearSearch() {
  searchInput.value = "";
  const result = await sendToActiveTab({ type: "clear" });
  updateStatus(result ?? { count: 0, current: 0 });
}

searchButton.addEventListener("click", search);
nextButton.addEventListener("click", () => move("next"));
prevButton.addEventListener("click", () => move("prev"));
clearButton.addEventListener("click", clearSearch);
deepSearchButton.addEventListener("click", deepSearch);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    search();
  }
});
