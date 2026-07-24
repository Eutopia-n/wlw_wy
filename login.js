(() => {
  "use strict";
  const accounts = {
    "STAFF-001": { id: "STAFF-001", name: "护理员01", pin: "1001", role: "staff" },
    "STAFF-002": { id: "STAFF-002", name: "护理员02", pin: "1002", role: "staff" },
    "ADMIN-001": { id: "ADMIN-001", name: "值班管理员", pin: "9001", role: "admin" },
  };
  document.querySelector("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const account = accounts[document.querySelector("#staff-account").value];
    const pin = document.querySelector("#staff-pin").value.trim();
    const error = document.querySelector("#login-error");
    if (!account || account.pin !== pin) {
      error.textContent = "人员编号或登录PIN不正确，请重新输入。";
      document.querySelector("#staff-pin").focus();
      return;
    }
    sessionStorage.setItem("ward_worker_staff", JSON.stringify({ id: account.id, name: account.name, role: account.role }));
    window.location.replace("index.html?v=20260724-selective-purge-1#workbench");
  });
})();
