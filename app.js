(() => {
  "use strict";

  const TOPICS = {
    request: "smart_care/ticket/request",
    action: "smart_care/ticket/action",
    query: "smart_care/ticket/query",
    status: "smart_care/ticket/status",
    snapshot: "smart_care/ticket/snapshot",
    careResult: "smart_care/result",
  };
  const RECENT_TICKET_CACHE_MS = 10_000;
  const APP_VERSION = "20260724-selective-purge-1";
  const CLOSED_STATUSES = new Set(["completed", "resolved", "cancelled"]);

  const STAFF_ACCOUNTS = {
    "STAFF-001": { id: "STAFF-001", name: "护理员01", pin: "1001", role: "staff" },
    "STAFF-002": { id: "STAFF-002", name: "护理员02", pin: "1002", role: "staff" },
    "ADMIN-001": { id: "ADMIN-001", name: "值班管理员", pin: "9001", role: "admin" },
  };

  const STATUS_META = {
    pending: { label: "待接单", className: "status-pending" },
    accepted: { label: "已接单", className: "status-accepted" },
    arrived: { label: "已到达", className: "status-arrived" },
    completed: { label: "服务完成", className: "status-completed" },
    resolved: { label: "患者已确认", className: "status-resolved" },
    cancelled: { label: "已取消", className: "status-cancelled" },
  };

  const REQUEST_LABELS = {
    call: "普通呼叫",
    water: "饮水协助",
    toilet: "如厕协助",
    pain: "身体不适",
    medicine: "用药协助",
    environment: "环境调节",
    supplies: "物品需求",
    other: "其他需求",
  };

  const ACTION_LABELS = {
    create: "创建服务工单",
    accept: "接收工单",
    arrive: "确认到达床旁",
    complete: "完成本次服务",
    confirm: "患者确认服务结果",
    cancel: "取消服务工单",
    reopen: "重新开放工单",
  };

  function loadStaffSession() {
    try {
      const staff = JSON.parse(sessionStorage.getItem("ward_worker_staff") || "null");
      if (staff && staff.id && staff.name) return staff;
    } catch (error) {
      console.warn("登录会话读取失败", error);
    }
    return null;
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const state = {
    mode: "online",
    currentStaff: null,
    tickets: [],
    selectedId: "",
    activeFilter: "all",
    hiddenTicketIds: loadHiddenTicketIds(),
    mqttClient: null,
    connected: false,
    toastTimer: null,
    // 优先使用 dashboard 从数据库返回的最近工单；MQTT 全量快照仅作兜底。
    recentTicketsByBed: new Map(),
    recentTicketLoadedAt: new Map(),
    recentTicketLoadingBeds: new Set(),
    adminPurgeBusy: false,
    cleanupSelectionMode: false,
    selectedCleanupIds: new Set(),
    care: {
      environment: { temperature: 26.4, humidity: 58 },
      activity: { level: "light", summary: "床旁区域存在轻微活动" },
      medication: { is_open: false, reminder_message: "08:12记录药盒开启" },
    },
  };

  function isoMinutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
  }

  function createInitialTickets() {
    return [
      {
        ticket_id: "T202607200901A101",
        request_id: "TERM-A03-001",
        device_id: "WARD-TERM-001",
        bed_id: "A03",
        request_type: "water",
        request_text: "患者希望协助取一杯温水",
        priority: "normal",
        status: "pending",
        source: "xiaozhi",
        staff_id: "",
        staff_name: "",
        ai_enriched: true,
        created_at: isoMinutesAgo(4),
        updated_at: isoMinutesAgo(4),
        events: [{ action: "create", from_status: "", to_status: "pending", operator_name: "床旁终端", operator_id: "WARD-TERM-001", note: "小智补充了饮水需求", created_at: isoMinutesAgo(4) }],
      },
      {
        ticket_id: "T202607200846B202",
        request_id: "TERM-B02-011",
        device_id: "WARD-TERM-002",
        bed_id: "B02",
        request_type: "toilet",
        request_text: "患者需要如厕协助",
        priority: "urgent",
        status: "accepted",
        source: "button_xiaozhi",
        staff_id: "STAFF-001",
        staff_name: "护理员01",
        ai_enriched: true,
        created_at: isoMinutesAgo(18),
        accepted_at: isoMinutesAgo(15),
        updated_at: isoMinutesAgo(15),
        events: [
          { action: "create", from_status: "", to_status: "pending", operator_name: "床旁终端", operator_id: "WARD-TERM-002", note: "", created_at: isoMinutesAgo(18) },
          { action: "accept", from_status: "pending", to_status: "accepted", operator_name: "护理员01", operator_id: "STAFF-001", note: "", created_at: isoMinutesAgo(15) },
        ],
      },
      {
        ticket_id: "T202607200820C303",
        request_id: "TERM-C05-008",
        device_id: "WARD-TERM-003",
        bed_id: "C05",
        request_type: "environment",
        request_text: "床旁灯光偏亮，希望协助调暗",
        priority: "normal",
        status: "arrived",
        source: "xiaozhi",
        staff_id: "STAFF-002",
        staff_name: "护理员02",
        ai_enriched: true,
        created_at: isoMinutesAgo(43),
        accepted_at: isoMinutesAgo(40),
        arrived_at: isoMinutesAgo(34),
        updated_at: isoMinutesAgo(34),
        events: [
          { action: "create", from_status: "", to_status: "pending", operator_name: "床旁终端", operator_id: "WARD-TERM-003", note: "", created_at: isoMinutesAgo(43) },
          { action: "accept", from_status: "pending", to_status: "accepted", operator_name: "护理员02", operator_id: "STAFF-002", note: "", created_at: isoMinutesAgo(40) },
          { action: "arrive", from_status: "accepted", to_status: "arrived", operator_name: "护理员02", operator_id: "STAFF-002", note: "", created_at: isoMinutesAgo(34) },
        ],
      },
      {
        ticket_id: "T202607200755D404",
        request_id: "TERM-A01-019",
        device_id: "WARD-TERM-004",
        bed_id: "A01",
        request_type: "supplies",
        request_text: "需要补充纸巾",
        priority: "normal",
        status: "completed",
        source: "button_xiaozhi",
        staff_id: "STAFF-001",
        staff_name: "护理员01",
        ai_enriched: true,
        created_at: isoMinutesAgo(69),
        accepted_at: isoMinutesAgo(66),
        arrived_at: isoMinutesAgo(59),
        completed_at: isoMinutesAgo(52),
        updated_at: isoMinutesAgo(52),
        events: [
          { action: "create", from_status: "", to_status: "pending", operator_name: "床旁终端", operator_id: "WARD-TERM-004", note: "", created_at: isoMinutesAgo(69) },
          { action: "accept", from_status: "pending", to_status: "accepted", operator_name: "护理员01", operator_id: "STAFF-001", note: "", created_at: isoMinutesAgo(66) },
          { action: "arrive", from_status: "accepted", to_status: "arrived", operator_name: "护理员01", operator_id: "STAFF-001", note: "", created_at: isoMinutesAgo(59) },
          { action: "complete", from_status: "arrived", to_status: "completed", operator_name: "护理员01", operator_id: "STAFF-001", note: "已补充床旁用品", created_at: isoMinutesAgo(52) },
        ],
      },
    ].map(normalizeTicket);
  }

  function normalizeTicket(raw) {
    const ticket = raw && typeof raw === "object" ? raw : {};
    return {
      ticket_id: String(ticket.ticket_id || ticket.id || ""),
      request_id: String(ticket.request_id || ""),
      device_id: String(ticket.device_id || "WARD-TERM-001"),
      bed_id: String(ticket.bed_id || ticket.bed || "BED-01"),
      request_type: String(ticket.request_type || "other").toLowerCase(),
      request_text: String(ticket.request_text || ticket.description || "患者发起床旁服务请求"),
      priority: ticket.priority === "urgent" ? "urgent" : "normal",
      status: STATUS_META[ticket.status] ? ticket.status : "pending",
      source: String(ticket.source || "button"),
      staff_id: String(ticket.staff_id || ticket.assigneeId || ""),
      staff_name: String(ticket.staff_name || ticket.assignee || ""),
      ai_enriched: Boolean(ticket.ai_enriched),
      created_at: String(ticket.created_at || ticket.createdAt || new Date().toISOString()),
      accepted_at: String(ticket.accepted_at || ticket.acceptedAt || ""),
      arrived_at: String(ticket.arrived_at || ticket.arrivedAt || ""),
      completed_at: String(ticket.completed_at || ticket.completedAt || ""),
      resolved_at: String(ticket.resolved_at || ""),
      cancelled_at: String(ticket.cancelled_at || ""),
      updated_at: String(ticket.updated_at || ticket.created_at || new Date().toISOString()),
      events: Array.isArray(ticket.events) ? ticket.events : [],
    };
  }

  function loadDemoTickets() {
    try {
      const stored = localStorage.getItem("ward_worker_demo_tickets_v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizeTicket);
      }
    } catch (error) {
      console.warn("演示数据读取失败", error);
    }
    return createInitialTickets();
  }

  function saveDemoTickets() {
    if (state.mode !== "demo") return;
    try {
      localStorage.setItem("ward_worker_demo_tickets_v2", JSON.stringify(state.tickets));
    } catch (error) {
      console.warn("演示数据保存失败", error);
    }
  }

  function loadHiddenTicketIds() {
    try {
      const stored = JSON.parse(localStorage.getItem("ward_worker_hidden_tickets_v1") || "[]");
      return new Set(Array.isArray(stored) ? stored : []);
    } catch (error) {
      console.warn("已清理工单记录读取失败", error);
      return new Set();
    }
  }

  function saveHiddenTicketIds() {
    try {
      localStorage.setItem("ward_worker_hidden_tickets_v1", JSON.stringify([...state.hiddenTicketIds]));
    } catch (error) {
      console.warn("已清理工单记录保存失败", error);
    }
  }

  function activeTickets() {
    return state.tickets.filter((ticket) => !state.hiddenTicketIds.has(ticket.ticket_id));
  }

  function releaseReopenedTickets(tickets) {
    let changed = false;
    tickets.forEach((ticket) => {
      if (["pending", "accepted", "arrived"].includes(ticket.status)) {
        changed = state.hiddenTicketIds.delete(ticket.ticket_id) || changed;
      }
    });
    if (changed) saveHiddenTicketIds();
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return "--:--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 5);
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function elapsedText(createdAt, acceptedAt) {
    if (!acceptedAt) return "等待接单";
    const seconds = Math.max(0, (new Date(acceptedAt) - new Date(createdAt)) / 1000);
    if (!Number.isFinite(seconds)) return "—";
    if (seconds < 60) return `${Math.round(seconds)}秒`;
    return `${Math.round(seconds / 60)}分钟`;
  }

  function requestLabel(type) {
    return REQUEST_LABELS[type] || REQUEST_LABELS.other;
  }

  function sourceLabel(source) {
    const labels = {
      button: "床旁按钮",
      xiaozhi: "小智语音",
      button_xiaozhi: "按钮 + 小智",
      mini_program: "小程序",
    };
    return labels[source] || source || "床旁终端";
  }

  function eventDescription(event) {
    const action = String(event.action || "update");
    const operator = event.operator_name || event.operator_id || "系统";
    const note = event.note ? `：${event.note}` : "";
    return `${operator}${ACTION_LABELS[action] || "更新工单"}${note}`;
  }

  function announce(message, tone = "normal") {
    const toast = $("#toast");
    toast.textContent = message;
    toast.style.background = tone === "error" ? "#b42318" : tone === "success" ? "#027a48" : "#101828";
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function updateConnection(status, text) {
    const chip = $("#connection-chip");
    chip.className = `connection-chip is-${status}`;
    $("#connection-text").textContent = text;
  }

  function applyCurrentStaffToView() {
    if (!state.currentStaff) return;
    const isAdmin = state.currentStaff.role === "admin";
    const name = $("#staff-name");
    const id = $("#staff-id");
    const avatar = $("#staff-avatar");
    const adminTokenField = $("#admin-token-field");
    const adminTokenInput = $("#admin-api-token");

    if (name) name.textContent = state.currentStaff.name;
    if (id) id.textContent = state.currentStaff.id;
    if (avatar) avatar.textContent = isAdmin ? "管" : state.currentStaff.id.slice(-2);
    if (adminTokenField) adminTokenField.hidden = !isAdmin;
    if (isAdmin && adminTokenInput) {
      adminTokenInput.value = sessionStorage.getItem("ward_worker_admin_api_token") || "";
    }
    document.documentElement.dataset.appVersion = APP_VERSION;
  }

  function login(event) {
    event.preventDefault();
    const account = STAFF_ACCOUNTS[$("#staff-account").value];
    const pin = $("#staff-pin").value.trim();
    if (!account || account.pin !== pin) {
      $("#login-error").textContent = "人员编号或 PIN 不正确，请重新输入。";
      $("#staff-pin").focus();
      return;
    }

    state.currentStaff = account;
    $("#login-error").textContent = "";
    $("#staff-pin").value = "";
    $("#login-view").hidden = true;
    $("#workspace").hidden = false;
    window.location.hash = "workbench";
    $("#staff-name").textContent = account.name;
    $("#staff-id").textContent = account.id;
    $("#staff-avatar").textContent = account.id === "ADMIN-001" ? "管" : account.id.slice(-2);
    render();
    announce(`${account.name}（${account.id}）已登录，操作将记录人员编号。`, "success");
  }

  function logout() {
    disconnectMqtt(false);
    sessionStorage.removeItem("ward_worker_staff");
    window.location.replace("login.html");
  }

  function setMode() {
    state.mode = "online";
    $("#connection-panel").hidden = false;
    updateConnection("connecting", "等待云端连接");
  }

  function connectMqtt() {
    if (state.mode !== "online") setMode("online");
    if (!window.mqtt) {
      updateConnection("error", "MQTT 库未加载");
      announce("在线组件未加载，请检查网页资源。", "error");
      return;
    }

    disconnectMqtt(false);
    const url = $("#broker-url").value.trim();
    if (!/^wss?:\/\//i.test(url)) {
      announce("网页端地址必须以 ws:// 或 wss:// 开头。", "error");
      return;
    }

    const username = $("#mqtt-username").value.trim();
    const password = $("#mqtt-password").value;
    const clientId = `ward_staff_${state.currentStaff.id}_${Math.random().toString(16).slice(2, 9)}`;
    updateConnection("connecting", "正在连接");
    $("#connect-button").disabled = true;
    $("#connect-button").textContent = "连接中…";

    try {
      const options = { clientId, clean: true, connectTimeout: 6000, reconnectPeriod: 3000 };
      if (username) options.username = username;
      if (password) options.password = password;
      state.mqttClient = window.mqtt.connect(url, options);

      state.mqttClient.on("connect", () => {
        state.connected = true;
        updateConnection("online", "云端在线");
        $("#connect-button").disabled = false;
        $("#connect-button").textContent = "重新连接";
        state.mqttClient.subscribe([TOPICS.snapshot, TOPICS.status, TOPICS.careResult], { qos: 1 }, (error) => {
          if (error) {
            announce(`主题订阅失败：${error.message}`, "error");
            return;
          }
          publishJson(TOPICS.query, { status: "", bed_id: "", requester: state.currentStaff.id });
          announce("已连接云端，工单列表正在同步。", "success");
        });
      });

      state.mqttClient.on("message", handleMqttMessage);
      state.mqttClient.on("reconnect", () => updateConnection("connecting", "正在重连"));
      state.mqttClient.on("offline", () => updateConnection("error", "连接中断"));
      state.mqttClient.on("close", () => {
        state.connected = false;
        if (state.mode === "online") updateConnection("error", "云端离线");
      });
      state.mqttClient.on("error", (error) => {
        updateConnection("error", "连接失败");
        $("#connect-button").disabled = false;
        $("#connect-button").textContent = "重新连接";
        announce(`MQTT 连接失败：${error.message}`, "error");
      });
    } catch (error) {
      updateConnection("error", "连接失败");
      $("#connect-button").disabled = false;
      $("#connect-button").textContent = "重新连接";
      announce(`无法建立连接：${error.message}`, "error");
    }
  }

  function disconnectMqtt(showNotice = true) {
    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch (error) { console.warn(error); }
    }
    state.mqttClient = null;
    state.connected = false;
    $("#connect-button").disabled = false;
    $("#connect-button").textContent = "连接云端";
    if (showNotice) announce("已断开云端连接。当前工单不会在网页端继续更新。");
  }

  function publishJson(topic, payload) {
    if (!state.mqttClient || !state.connected) {
      announce("云端尚未连接，消息未发送。", "error");
      return false;
    }
    state.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
    return true;
  }

  function handleMqttMessage(topic, buffer) {
    let payload;
    try {
      payload = JSON.parse(buffer.toString());
    } catch (error) {
      console.warn("收到无法解析的 MQTT 消息", topic, error);
      return;
    }

    if (topic === TOPICS.snapshot && Array.isArray(payload.tickets)) {
      state.tickets = payload.tickets.map(normalizeTicket);
      releaseReopenedTickets(state.tickets);
      ensureSelection();
      render();
      const selected = state.tickets.find((ticket) => ticket.ticket_id === state.selectedId);
      if (selected) refreshRecentTicketsForBed(selected.bed_id);
      return;
    }

    if (topic === TOPICS.status) {
      if (payload.type === "ticket_error") {
        announce(payload.message || "云端拒绝了本次操作。", "error");
        return;
      }
      if (payload.ticket) {
        mergeTicket(normalizeTicket(payload.ticket));
        announce(ticketEventNotice(payload.event, payload.ticket), "success");
        render();
      }
      return;
    }

    if (topic === TOPICS.careResult) {
      state.care = {
        environment: payload.environment || state.care.environment,
        activity: payload.activity || state.care.activity,
        medication: payload.medication || state.care.medication,
      };
      renderDetail();
    }
  }

  function ticketEventNotice(event, ticket) {
    const label = ACTION_LABELS[event] || (event === "created" ? "创建工单" : "更新工单");
    return `${ticket.bed_id || "床位"}：${label}成功。`;
  }

  function mergeTicket(ticket) {
    const index = state.tickets.findIndex((item) => item.ticket_id === ticket.ticket_id);
    if (index >= 0) state.tickets[index] = ticket;
    else state.tickets.unshift(ticket);
    releaseReopenedTickets([ticket]);
    state.selectedId = ticket.ticket_id;
    refreshRecentTicketsForBed(ticket.bed_id);
  }

  function ensureSelection() {
    const tickets = activeTickets();
    if (!tickets.some((ticket) => ticket.ticket_id === state.selectedId)) {
      state.selectedId = tickets[0]?.ticket_id || "";
    }
  }

  function matchesFilter(ticket) {
    if (state.hiddenTicketIds.has(ticket.ticket_id)) return false;
    const staffId = state.currentStaff?.id || "";
    if (state.activeFilter === "pending") return ticket.status === "pending";
    if (state.activeFilter === "mine") return ticket.staff_id === staffId && !["resolved", "cancelled"].includes(ticket.status);
    if (state.activeFilter === "processing") return ["accepted", "arrived"].includes(ticket.status);
    if (state.activeFilter === "finished") return CLOSED_STATUSES.has(ticket.status);
    return true;
  }

  function sortedVisibleTickets() {
    return state.tickets
      .filter(matchesFilter)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === "urgent" ? -1 : 1;
        return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
      });
  }

  function renderStats() {
    const staffId = state.currentStaff?.id || "";
    const tickets = activeTickets();
    $("#stat-pending").textContent = tickets.filter((ticket) => ticket.status === "pending").length;
    $("#stat-processing").textContent = tickets.filter((ticket) => ["accepted", "arrived"].includes(ticket.status)).length;
    $("#stat-mine").textContent = tickets.filter((ticket) => ticket.staff_id === staffId && ["accepted", "arrived", "completed"].includes(ticket.status)).length;
    $("#stat-completed").textContent = tickets.filter((ticket) => ["completed", "resolved"].includes(ticket.status)).length;
  }

  function renderList() {
    const visible = sortedVisibleTickets();
    const list = $("#ticket-list");
    if (!visible.length) {
      list.innerHTML = `<div class="empty-state"><div><strong>当前筛选下没有工单</strong><span>可切换筛选条件或刷新云端数据</span></div></div>`;
      return;
    }

    list.innerHTML = visible.map((ticket) => {
      const status = STATUS_META[ticket.status];
      const cleanupSelectable = state.cleanupSelectionMode
        && state.currentStaff?.role === "admin"
        && CLOSED_STATUSES.has(ticket.status);
      const cleanupSelected = state.selectedCleanupIds.has(ticket.ticket_id);
      return `
        <button class="ticket-card ${ticket.ticket_id === state.selectedId && !state.cleanupSelectionMode ? "is-selected" : ""} ${cleanupSelected ? "is-cleanup-selected" : ""}" type="button" data-ticket-id="${escapeHtml(ticket.ticket_id)}" data-cleanup-selectable="${cleanupSelectable}" ${cleanupSelectable ? `aria-pressed="${cleanupSelected}"` : ""}>
          <div class="ticket-card-top">
            <span class="ticket-card-status">
              ${cleanupSelectable ? `<span class="cleanup-check" aria-hidden="true">${cleanupSelected ? "✓" : ""}</span>` : ""}
              <span class="status-badge ${status.className}">${status.label}</span>
            </span>
            <span class="priority-badge priority-${ticket.priority}">${ticket.priority === "urgent" ? "紧急" : "普通"}</span>
          </div>
          <h3>${escapeHtml(ticket.bed_id)}床 · ${escapeHtml(requestLabel(ticket.request_type))}</h3>
          <p>${escapeHtml(ticket.request_text)}</p>
          <div class="ticket-card-bottom">
            <span>${escapeHtml(ticket.staff_name || "未分配")}</span>
            <time>${escapeHtml(formatDateTime(ticket.created_at))}</time>
          </div>
        </button>`;
    }).join("");

    list.querySelectorAll("[data-ticket-id]").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.cleanupSelectionMode) {
          if (button.dataset.cleanupSelectable !== "true") return;
          const ticketId = button.dataset.ticketId;
          if (state.selectedCleanupIds.has(ticketId)) state.selectedCleanupIds.delete(ticketId);
          else state.selectedCleanupIds.add(ticketId);
          renderList();
          updateCleanupButtons();
          return;
        }
        state.selectedId = button.dataset.ticketId;
        renderList();
        renderDetail();
        const selected = state.tickets.find((ticket) => ticket.ticket_id === state.selectedId);
        if (selected) refreshRecentTicketsForBed(selected.bed_id, true);
      });
    });
  }

  function actionForTicket(ticket) {
    if (!state.currentStaff) return null;
    const isAdmin = state.currentStaff.role === "admin";
    const isOwner = ticket.staff_id === state.currentStaff.id;
    if (ticket.status === "pending") return { action: "accept", label: "接收工单" };
    if (!isOwner && !isAdmin) return null;
    if (ticket.status === "accepted") return { action: "arrive", label: "确认已到达" };
    if (ticket.status === "arrived") return { action: "complete", label: "完成服务" };
    if (isAdmin && ["completed", "resolved", "cancelled"].includes(ticket.status)) return { action: "reopen", label: "重新开放" };
    return null;
  }

  function canCancel(ticket) {
    if (!state.currentStaff || !["pending", "accepted", "arrived"].includes(ticket.status)) return false;
    return ticket.status === "pending" || state.currentStaff.role === "admin" || ticket.staff_id === state.currentStaff.id;
  }

  function activityLabel(activity) {
    if (activity?.summary) return activity.summary;
    return { quiet: "床旁区域安静", light: "床旁区域存在轻微活动", active: "床旁区域活动较明显" }[activity?.level] || "暂无床旁活动数据";
  }

  function recentCareRecordsForBed(bedId) {
    const databaseRecords = state.recentTicketsByBed.get(bedId);
    if (Array.isArray(databaseRecords)) return databaseRecords;
    return state.tickets
      .filter((item) => item.bed_id === bedId)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .slice(0, 3);
  }

  function normalizeRecentTicket(record) {
    const item = record && typeof record === "object" ? record : {};
    return {
      ticket_id: String(item.ticket_id || ""),
      bed_id: String(item.bed_id || ""),
      request_type: String(item.request_type || "other").toLowerCase(),
      category_label: String(item.category_label || ""),
      status: String(item.status || ""),
      status_label: String(item.status_label || ""),
      created_at: String(item.created_at || ""),
      updated_at: String(item.updated_at || item.history_at || ""),
      history_at: String(item.history_at || item.updated_at || ""),
    };
  }

  function dashboardApiBase() {
    const configured = String(window.WARD_DASHBOARD_API_BASE || localStorage.getItem("ward_dashboard_api_base") || "")
      .trim()
      .replace(/\/+$/, "");
    if (configured) return configured.endsWith("/api") ? configured : `${configured}/api`;

    // 未单独配置时，按 MQTT 地址的主机自动推导家属 dashboard 服务端口。
    const brokerUrl = $("#broker-url")?.value.trim();
    try {
      const broker = new URL(brokerUrl);
      const protocol = broker.protocol === "wss:" ? "https:" : "http:";
      return `${protocol}//${broker.hostname}:8091/api`;
    } catch (error) {
      return "";
    }
  }

  async function refreshRecentTicketsForBed(bedId, force = false) {
    const normalizedBedId = String(bedId || "").trim();
    if (!normalizedBedId || state.mode !== "online") return;
    if (state.recentTicketLoadingBeds.has(normalizedBedId)) return;
    const lastLoaded = state.recentTicketLoadedAt.get(normalizedBedId) || 0;
    if (!force && Date.now() - lastLoaded < RECENT_TICKET_CACHE_MS) return;

    const apiBase = dashboardApiBase();
    if (!apiBase) return;
    state.recentTicketLoadingBeds.add(normalizedBedId);
    try {
      const response = await fetch(`${apiBase}/beds/${encodeURIComponent(normalizedBedId)}/dashboard`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.recent_tickets)) throw new Error("dashboard 未返回 recent_tickets");
      state.recentTicketsByBed.set(normalizedBedId, payload.recent_tickets.map(normalizeRecentTicket));
      state.recentTicketLoadedAt.set(normalizedBedId, Date.now());
      const selected = state.tickets.find((ticket) => ticket.ticket_id === state.selectedId);
      if (selected?.bed_id === normalizedBedId) renderDetail();
    } catch (error) {
      // 保留 MQTT 快照的兜底数据，不打断服务人员当前操作。
      console.warn("最近工单历史读取失败，将暂时使用工单快照", error);
    } finally {
      state.recentTicketLoadingBeds.delete(normalizedBedId);
    }
  }

  function recentTicketLabel(record) {
    return record.category_label || requestLabel(record.request_type);
  }

  function recentTicketStatusLabel(record) {
    return record.status_label || STATUS_META[record.status]?.label || "状态已更新";
  }

  function renderDetail() {
    const detail = $("#ticket-detail");
    const openFolds = new Set(
      [...detail.querySelectorAll("details[data-fold]")]
        .filter((fold) => fold.open)
        .map((fold) => fold.dataset.fold),
    );
    const ticket = state.tickets.find((item) => item.ticket_id === state.selectedId);
    if (!ticket) {
      detail.innerHTML = `<div class="empty-state"><div><strong>请选择一张工单</strong><span>工单详情和操作记录将在这里显示</span></div></div>`;
      return;
    }

    const status = STATUS_META[ticket.status];
    const nextAction = actionForTicket(ticket);
    const cancelAllowed = canCancel(ticket);
    const ownerConflict = ticket.staff_id && ticket.staff_id !== state.currentStaff.id && state.currentStaff.role !== "admin";
    const temperature = state.care.environment?.temperature;
    const humidity = state.care.environment?.humidity;
    const medicationText = state.care.medication?.reminder_message
      || (state.care.medication?.is_open ? "药盒当前处于打开状态" : "暂无新的药盒操作");
    const events = [...ticket.events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const recentCareRecords = recentCareRecordsForBed(ticket.bed_id);
    refreshRecentTicketsForBed(ticket.bed_id);

    let processHint = "";
    if (ticket.status === "completed") processHint = "服务人员已完成处理，床旁终端将提示患者按键确认。";
    else if (ownerConflict) processHint = `该工单由${ticket.staff_name || ticket.staff_id}（${ticket.staff_id}）负责，当前人员只能查看。`;
    else if (ticket.status === "resolved") processHint = "患者已通过床旁终端确认，本次工单闭环完成。";

    detail.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">
          <span class="eyebrow">${escapeHtml(ticket.ticket_id)}</span>
          <h2>${escapeHtml(ticket.bed_id)}床 · ${escapeHtml(requestLabel(ticket.request_type))}</h2>
          <div class="badge-row">
            <span class="status-badge ${status.className}">${status.label}</span>
            <span class="priority-badge priority-${ticket.priority}">${ticket.priority === "urgent" ? "紧急优先" : "普通优先级"}</span>
            <span class="source-badge">${escapeHtml(sourceLabel(ticket.source))}</span>
          </div>
        </div>
      </div>

      <p class="request-quote">“${escapeHtml(ticket.request_text)}”</p>

      <div class="quick-state-row">
        <span class="quick-label">下一步</span>
        <strong>${escapeHtml(nextAction?.label || (ticket.status === "completed" ? "等待患者确认" : status.label))}</strong>
      </div>

      <div class="detail-folds">
        <details class="detail-fold" data-fold="service">
          <summary><span>服务详情</span><small>设备、人员、时间与AI整理</small></summary>
          <div class="fold-content">
            <div class="info-row"><span>床旁设备</span><span>${escapeHtml(ticket.device_id)}</span></div>
            <div class="info-row"><span>处理人员</span><span>${escapeHtml(ticket.staff_name ? `${ticket.staff_name}（${ticket.staff_id}）` : "尚未分配")}</span></div>
            <div class="info-row"><span>提出时间</span><span>${escapeHtml(formatDateTime(ticket.created_at))}</span></div>
            <div class="info-row"><span>响应耗时</span><span>${escapeHtml(elapsedText(ticket.created_at, ticket.accepted_at))}</span></div>
            <div class="info-row"><span>AI语义整理</span><span>${ticket.ai_enriched ? "已整理" : "普通呼叫"}</span></div>
          </div>
        </details>

        <details class="detail-fold" data-fold="bedside">
          <summary><span>床旁辅助信息</span><small>环境、活动与药盒状态</small></summary>
          <div class="fold-content">
            <div class="info-row"><span>环境数据</span><span>${temperature ?? "—"}℃ · ${humidity ?? "—"}%</span></div>
            <div class="info-row"><span>床旁活动</span><span>${escapeHtml(activityLabel(state.care.activity))}</span></div>
            <div class="info-row"><span>药盒记录</span><span>${escapeHtml(medicationText)}</span></div>
            <div class="info-row"><span>场景调度</span><span>辅助服务与夜灯联动</span></div>
          </div>
        </details>

        <details class="detail-fold" data-fold="timeline">
          <summary><span>处理记录</span><small>${events.length}条操作记录</small></summary>
          <div class="fold-content timeline">
            ${events.length ? events.map((event) => `
              <div class="timeline-item">
                <time class="timeline-time">${escapeHtml(formatTime(event.created_at))}</time>
                <span class="timeline-dot" aria-hidden="true"></span>
                <span>${escapeHtml(eventDescription(event))}</span>
              </div>`).join("") : `<span class="helper">暂无详细操作记录</span>`}
          </div>
        </details>

        <details class="detail-fold" data-fold="recent-care">
          <summary><span>最近三条陪护记录</span><small>云端数据库历史</small></summary>
          <div class="fold-content recent-care-list">
            ${recentCareRecords.length ? recentCareRecords.map((record) => `
              <div class="recent-care-row">
                <span class="recent-care-type">${escapeHtml(recentTicketLabel(record))}</span>
                <span class="recent-care-status">${escapeHtml(recentTicketStatusLabel(record))}</span>
                <time>${escapeHtml(formatDateTime(record.history_at || record.updated_at || record.created_at))}</time>
              </div>`).join("") : `<span class="helper">暂无陪护记录</span>`}
          </div>
        </details>
      </div>

      ${processHint ? `<p class="ownership-note">${escapeHtml(processHint)}</p>` : ""}
      ${(nextAction || cancelAllowed) ? `
        <div class="detail-actions">
          ${cancelAllowed ? `<button id="cancel-ticket" class="button danger" type="button">取消工单</button>` : ""}
          ${nextAction ? `<button id="advance-ticket" class="button primary" type="button" data-action="${nextAction.action}">${nextAction.label}</button>` : ""}
        </div>` : ""}
    `;

    detail.querySelectorAll("details[data-fold]").forEach((fold) => {
      fold.open = openFolds.has(fold.dataset.fold);
    });

    $("#advance-ticket")?.addEventListener("click", (event) => performAction(event.currentTarget.dataset.action));
    $("#cancel-ticket")?.addEventListener("click", () => performAction("cancel"));
  }

  function render() {
    if ($("#workspace").hidden) return;
    updateCleanupButtons();
    renderStats();
    renderList();
    renderDetail();
  }

  function performAction(action) {
    const ticket = state.tickets.find((item) => item.ticket_id === state.selectedId);
    if (!ticket || !state.currentStaff) return;

    const payload = {
      ticket_id: ticket.ticket_id,
      action,
      staff_id: state.currentStaff.id,
      staff_name: state.currentStaff.name,
      role: state.currentStaff.role,
    };

    if (publishJson(TOPICS.action, payload)) {
      announce(`已提交“${ACTION_LABELS[action] || action}”，等待云端确认。`);
    }
  }

  function refreshTickets() {
    if (publishJson(TOPICS.query, { status: "", bed_id: "", requester: state.currentStaff.id })) {
      announce("已向云端请求最新工单快照。", "success");
    }
  }

  async function postAdminPurge(apiBase, token, payload) {
    const response = await fetch(`${apiBase}/admin/tickets/purge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || `管理员清理接口请求失败（HTTP ${response.status}）`);
    }
    return result;
  }

  function hideFinishedTicketsLocally(closedTickets) {
    closedTickets.forEach((ticket) => state.hiddenTicketIds.add(ticket.ticket_id));
    saveHiddenTicketIds();
    ensureSelection();
    render();
    announce(`已在当前浏览器隐藏 ${closedTickets.length} 张工单，云端记录未删除。`, "success");
  }

  function enterCleanupSelectionMode() {
    if (state.currentStaff?.role !== "admin") {
      clearFinishedTickets();
      return;
    }
    state.cleanupSelectionMode = true;
    state.selectedCleanupIds.clear();
    state.activeFilter = "finished";
    updateFilterButtons();
    render();
    announce("请选择需要永久清理的已结束工单。");
  }

  function exitCleanupSelectionMode({ renderPage = true } = {}) {
    state.cleanupSelectionMode = false;
    state.selectedCleanupIds.clear();
    if (renderPage) render();
  }

  function selectAllFinishedTickets() {
    state.tickets.forEach((ticket) => {
      if (CLOSED_STATUSES.has(ticket.status) && !state.hiddenTicketIds.has(ticket.ticket_id)) {
        state.selectedCleanupIds.add(ticket.ticket_id);
      }
    });
    renderList();
    updateCleanupButtons();
  }

  async function clearFinishedTickets(selectedTicketIds = null) {
    const selectedSet = Array.isArray(selectedTicketIds) ? new Set(selectedTicketIds) : null;
    const closedTickets = state.tickets.filter(
      (ticket) => CLOSED_STATUSES.has(ticket.status)
        && !state.hiddenTicketIds.has(ticket.ticket_id)
        && (!selectedSet || selectedSet.has(ticket.ticket_id)),
    );
    if (!closedTickets.length) {
      announce("当前没有可清理的已结束工单。");
      return;
    }

    if (state.currentStaff?.role !== "admin") {
      hideFinishedTicketsLocally(closedTickets);
      return;
    }

    const apiBase = dashboardApiBase();
    const tokenInput = $("#admin-api-token");
    let token = String(tokenInput?.value || sessionStorage.getItem("ward_worker_admin_api_token") || "").trim();
    if (!apiBase) {
      announce("无法确定管理接口地址，请先检查云端连接设置。", "error");
      return;
    }
    if (!token) {
      const connectionPanel = $("#connection-panel");
      if (connectionPanel && tokenInput) {
        connectionPanel.hidden = false;
        tokenInput.focus();
        announce("请先填写与服务器 ADMIN_API_TOKEN 一致的管理员清理令牌。", "error");
        return;
      }
      token = String(window.prompt("请输入服务器 ADMIN_API_TOKEN 管理员清理令牌：") || "").trim();
      if (!token) {
        announce("未输入管理员清理令牌，已取消清理。", "error");
        return;
      }
    }

    sessionStorage.setItem("ward_worker_admin_api_token", token);
    state.adminPurgeBusy = true;
    updateCleanupButtons();
    try {
      const ticketIds = closedTickets.map((ticket) => ticket.ticket_id);
      const commonPayload = {
        ticket_ids: ticketIds,
        include_completed: true,
        limit: Math.min(ticketIds.length, 500),
      };
      const preview = await postAdminPurge(apiBase, token, { ...commonPayload, confirm: false });
      if (!preview.matched_count) {
        announce("云端没有找到可永久清理的已结束工单。", "error");
        return;
      }
      const confirmed = window.confirm(
        `将永久删除云端数据库中的 ${preview.selected_count} 张已结束工单及其处理记录。此操作不可恢复，是否继续？`,
      );
      if (!confirmed) {
        announce("已取消管理员清理操作。");
        return;
      }

      const result = await postAdminPurge(apiBase, token, { ...commonPayload, confirm: true });
      const deletedIds = new Set((result.tickets || []).map((ticket) => String(ticket.ticket_id || "")));
      state.tickets = state.tickets.filter((ticket) => !deletedIds.has(ticket.ticket_id));
      deletedIds.forEach((ticketId) => state.hiddenTicketIds.delete(ticketId));
      saveHiddenTicketIds();
      state.recentTicketsByBed.clear();
      state.recentTicketLoadedAt.clear();
      exitCleanupSelectionMode({ renderPage: false });
      ensureSelection();
      render();
      refreshTickets();
      announce(result.message || `已永久清理 ${result.deleted_count} 张工单。`, "success");
    } catch (error) {
      console.error("管理员清理工单失败", error);
      announce(error.message || "管理员清理工单失败。", "error");
    } finally {
      state.adminPurgeBusy = false;
      updateCleanupButtons();
    }
  }

  function restoreHiddenTickets() {
    const count = state.hiddenTicketIds.size;
    if (!count) return;
    state.hiddenTicketIds.clear();
    saveHiddenTicketIds();
    ensureSelection();
    render();
    announce(`已恢复显示 ${count} 张工单。`, "success");
  }

  function updateCleanupButtons() {
    const count = state.hiddenTicketIds.size;
    const clearButton = $("#clear-finished");
    const adminClearButton = $("#admin-clear-finished");
    const isAdmin = state.currentStaff?.role === "admin";
    if (clearButton) {
      clearButton.disabled = state.adminPurgeBusy;
      clearButton.textContent = state.adminPurgeBusy
        ? "正在清理…"
        : (isAdmin ? "永久清理已结束" : "隐藏已结束");
    }
    if (adminClearButton) {
      adminClearButton.hidden = !isAdmin;
      adminClearButton.disabled = state.adminPurgeBusy;
      adminClearButton.textContent = state.adminPurgeBusy ? "正在清理…" : "管理员清理工单";
    }
    const restoreButton = $("#restore-hidden");
    if (restoreButton) {
      restoreButton.hidden = count === 0;
      restoreButton.textContent = count ? `恢复已清理（${count}）` : "恢复已清理";
    }
    const selectionTools = $("#cleanup-selection-tools");
    const selectionCount = $("#cleanup-selection-count");
    const deleteSelected = $("#delete-selected-finished");
    if (selectionTools) selectionTools.hidden = !isAdmin || !state.cleanupSelectionMode;
    if (selectionCount) selectionCount.textContent = `已选择 ${state.selectedCleanupIds.size} 张`;
    if (deleteSelected) {
      deleteSelected.disabled = state.adminPurgeBusy || state.selectedCleanupIds.size === 0;
      deleteSelected.textContent = state.adminPurgeBusy
        ? "正在删除…"
        : `删除选中（${state.selectedCleanupIds.size}）`;
    }
    if (isAdmin && !state.adminPurgeBusy) {
      if (clearButton) clearButton.textContent = state.cleanupSelectionMode ? "正在选择…" : "选择清理工单";
      if (adminClearButton) adminClearButton.textContent = state.cleanupSelectionMode ? "正在选择工单" : "选择清理工单";
    }
  }

  function updateFilterButtons() {
    $$("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === state.activeFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function bindEvents() {
    $("#login-form")?.addEventListener("submit", login);
    $("#logout")?.addEventListener("click", logout);
    $("#open-settings")?.addEventListener("click", () => {
      const panel = $("#connection-panel");
      if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    $("#close-settings")?.addEventListener("click", () => {
      const panel = $("#connection-panel");
      if (panel) panel.hidden = true;
    });
    $("#connect-button")?.addEventListener("click", connectMqtt);
    $("#refresh-tickets")?.addEventListener("click", refreshTickets);
    $("#clear-finished")?.addEventListener("click", enterCleanupSelectionMode);
    $("#admin-clear-finished")?.addEventListener("click", enterCleanupSelectionMode);
    $("#select-all-finished")?.addEventListener("click", selectAllFinishedTickets);
    $("#delete-selected-finished")?.addEventListener("click", () => {
      clearFinishedTickets([...state.selectedCleanupIds]);
    });
    $("#cancel-cleanup-selection")?.addEventListener("click", () => exitCleanupSelectionMode());
    $("#restore-hidden")?.addEventListener("click", restoreHiddenTickets);

    $$("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.cleanupSelectionMode && button.dataset.filter !== "finished") {
          exitCleanupSelectionMode({ renderPage: false });
        }
        state.activeFilter = button.dataset.filter;
        updateFilterButtons();
        const first = sortedVisibleTickets()[0];
        if (first) state.selectedId = first.ticket_id;
        render();
      });
    });

    window.addEventListener("beforeunload", () => disconnectMqtt(false));
  }

  function startClock() {
    const update = () => {
      $("#clock").textContent = new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date());
    };
    update();
    setInterval(update, 1000);
  }

  state.currentStaff = loadStaffSession();
  if (!state.currentStaff) {
    window.location.replace(`login.html?v=${APP_VERSION}`);
    return;
  }
  state.tickets = [];
  state.selectedId = "";
  applyCurrentStaffToView();
  bindEvents();
  startClock();
  updateFilterButtons();
  render();
  setTimeout(connectMqtt, 100);
})();
