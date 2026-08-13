(function () {
  "use strict";

  // Omnivo AI embeddable widget loader. Paste one <script> tag; this injects a
  // floating launcher button + an iframe hosting the branded chat. The iframe
  // runs on the Omnivo AI origin, so it talks to the backend same-origin; the
  // tenant is identified by the publishable embed key.
  var script = document.currentScript;
  if (!script) return;

  var key = script.getAttribute("data-embed-key");
  if (!key) {
    console.error("[Omnivo AI] widget.js: missing data-embed-key");
    return;
  }
  var color = script.getAttribute("data-color") || "#111827";
  var textColor = script.getAttribute("data-text-color") || "#fff";
  var position = script.getAttribute("data-position") === "left" ? "left" : "right";
  var appOrigin = new URL(script.src).origin;

  var side = position === "left" ? "left: 20px;" : "right: 20px;";
  var Z = 2147483000;
  var open = false;

  // Launcher button.
  var launcher = document.createElement("button");
  launcher.id = "omnivo-ai-launcher";
  launcher.setAttribute("aria-label", "Open chat");
  launcher.style.cssText =
    "position:fixed;bottom:20px;" + side +
    "width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;" +
    "background:" + color + ";color:" + textColor + ";box-shadow:0 8px 30px rgba(0,0,0,.25);" +
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
  frame.id = "omnivo-ai-frame";
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
    // On mobile the iframe goes full-screen (see the injected style), so the
    // launcher is hidden while open — the widget's own × button closes it.
    launcher.classList.toggle("omnivo-open", open);
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.style.transform = "scale(1)";
  }

  launcher.onclick = function () {
    setOpen(!open);
  };

  // The iframe asks to close itself (its × button). Trust the message when it
  // comes from our own iframe's window (e.source) — that's robust to any origin
  // quirk (apex/www or app. redirects) that would fail a strict origin-string
  // check and silently swallow the close. Fall back to the origin match for
  // browsers that don't expose e.source. Closing only hides the iframe (its
  // conversation stays in memory and reopens intact until the page reloads).
  window.addEventListener("message", function (e) {
    var fromFrame = frame.contentWindow && e.source === frame.contentWindow;
    if (!fromFrame && e.origin !== appOrigin) return;
    if (e.data && e.data.type === "ai-engine:close") setOpen(false);
  });

  // On phones the panel takes the whole screen (a fixed-size card is cramped).
  var style = document.createElement("style");
  style.textContent =
    "@media (max-width:640px){" +
    "#omnivo-ai-frame{inset:0 !important;width:100% !important;height:100dvh !important;" +
    "max-width:100% !important;border-radius:0 !important;box-shadow:none !important;}" +
    "#omnivo-ai-launcher.omnivo-open{display:none !important;}" +
    "}";

  function mount() {
    document.head.appendChild(style);
    document.body.appendChild(frame);
    document.body.appendChild(launcher);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
