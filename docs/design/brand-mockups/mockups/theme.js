document.querySelectorAll(".theme").forEach(function (b) {
  b.addEventListener("click", function () {
    var t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    localStorage.setItem("hf-theme", t);
  });
});
