(() => {
  const savedTheme = localStorage.getItem("buykori_admin_theme") || "dark";
  document.documentElement.classList.toggle("dark", savedTheme === "dark");
})();
