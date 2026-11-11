// Site-wide top menu: dropdowns, the phone Menu button, and which item is "current".
(function () {
  var nav = document.querySelector(".sn");
  if (!nav) return;
  var menuBtn = nav.querySelector(".sn-menu");
  var groups = nav.querySelectorAll(".sn-g");

  function closeGroups(except) {
    groups.forEach(function (g) { if (g !== except) g.setAttribute("aria-expanded", "false"); });
  }
  function setMenu(open) {
    if (open) nav.setAttribute("data-open", ""); else nav.removeAttribute("data-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  groups.forEach(function (g) {
    g.addEventListener("click", function () {
      var open = g.getAttribute("aria-expanded") !== "true";
      closeGroups(g);
      g.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  if (menuBtn) menuBtn.addEventListener("click", function () { setMenu(!nav.hasAttribute("data-open")); });

  // Close everything after picking a link, clicking elsewhere, or pressing Escape.
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) { closeGroups(); setMenu(false); } });
  document.addEventListener("click", function (e) { if (!nav.contains(e.target)) { closeGroups(); setMenu(false); } });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = nav.querySelector('.sn-g[aria-expanded="true"]');
    closeGroups(); setMenu(false);
    if (open) open.focus();
  });

  // Highlight Fat List or Hood Talk on the Fat List page.
  function mark() {
    if (!/\/fatlist(\.html)?$/.test(location.pathname)) return;
    var talk = /^#(talk|post|write)/.test(location.hash);
    nav.querySelectorAll("[data-sn]").forEach(function (a) {
      var on = a.getAttribute("data-sn") === (talk ? "talk" : "fatlist");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  mark();
  window.addEventListener("hashchange", mark);
})();
