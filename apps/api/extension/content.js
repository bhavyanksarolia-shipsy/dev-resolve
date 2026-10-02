// Runs only on Dev Resolve's own Connector page: lets the page see this extension and hand it the person's token.
window.postMessage({ source: "devresolve-ext", type: "hello", version: chrome.runtime.getManifest().version }, location.origin);
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin || e.data?.source !== "devresolve-page") return;
  if (e.data.type === "ping") window.postMessage({ source: "devresolve-ext", type: "hello", version: chrome.runtime.getManifest().version }, location.origin);
  if (["link", "status", "signin"].includes(e.data.type)) {
    chrome.runtime.sendMessage(e.data, (res) => window.postMessage({ source: "devresolve-ext", type: `${e.data.type}-result`, res }, location.origin));
  }
});
