(function () {
  var theme = "light";
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") theme = stored;
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  } catch (e) {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  }
  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1a19" : "#f7f8f5");
})();
