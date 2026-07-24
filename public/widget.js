(function () {
  "use strict";

  // AI Engine embeddable widget loader. Paste one <script> tag; this injects a
  // floating launcher button + an iframe hosting the branded chat. The iframe
  // runs on the AI Engine origin, so it talks to the backend same-origin; the
  // tenant is identified by the publishable embed key.
  var script = document.currentScript;
  if (!script) return;

  var key = script.getAttribute("data-embed-key");
  if (!key) {
    console.error("[AI Engine] widget.js: missing data-embed-key");
    return;
  }
  var color = script.getAttribute("data-color") || "#111827";
  var position = script.getAttribute("data-position") === "left" ? "left" : "right";
  var appOrigin = new URL(script.src).origin;

  var side = position === "left" ? "left: 20px;" : "right: 20px;";
  var Z = 2147483000;
  var open = false;

  // Launcher button.
  var launcher = document.createElement("button");
  launcher.setAttribute("aria-label", "Open chat");
  launcher.style.cssText =
    "position:fixed;bottom:20px;" + side +
    "width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;" +
    "background:" + color + ";color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.25);" +
    "z-index:" + Z + ";display:flex;align-items:center;justify-content:center;" +
    "transition:transform .15s ease;";
  launcher.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  launcher.onmouseenter = function () {
    launcher.style.transform = "scale(1.05)";
  };
  launcher.onmouseleave = function () {
    launcher.style.transform = "scale(1)";
  };

  // Chat iframe (hidden until opened).
  var frame = document.createElement("iframe");
  frame.title = "Chat";
  frame.src =
    appOrigin + "/embed/" + encodeURIComponent(key) +
    "?o=" + encodeURIComponent(location.origin);
  frame.allow = "clipboard-write";
  frame.style.cssText =
    "position:fixed;bottom:88px;" + side +
    "width:390px;height:min(640px, calc(100vh - 108px));max-width:calc(100vw - 40px);" +
    "border:none;border-radius:16px;overflow:hidden;background:#fff;" +
    "box-shadow:0 12px 48px rgba(0,0,0,.28);z-index:" + Z + ";display:none;";

  function setOpen(next) {
    open = next;
    frame.style.display = open ? "block" : "none";
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.style.transform = "scale(1)";
  }

  launcher.onclick = function () {
    setOpen(!open);
  };

  // The iframe asks to close itself (its × button).
  window.addEventListener("message", function (e) {
    if (e.origin !== appOrigin) return;
    if (e.data && e.data.type === "ai-engine:close") setOpen(false);
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(launcher);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
