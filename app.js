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

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const state = {
    mode: "demo",
    currentStaff: null,
    tickets: [],
    selectedId: "",
    activeFilter: "all",
    hiddenTicketIds: loadHiddenTicketIds(),
    mqttClient: null,
    connected: false,
    toastTimer: null,
    demoSequence: 6,
    demoPreset: 0,
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
    $("#staff-name").textContent = account.name;
    $("#staff-id").textContent = account.id;
    $("#staff-avatar").textContent = account.id === "ADMIN-001" ? "管" : account.id.slice(-2);
    render();
    announce(`${account.name}（${account.id}）已登录，操作将记录人员编号。`, "success");
  }

  function logout() {
    disconnectMqtt(false);
    state.currentStaff = null;
    $("#workspace").hidden = true;
    $("#login-view").hidden = false;
    $("#staff-pin").focus();
    setMode("demo");
  }

  function setMode(mode) {
    state.mode = mode === "online" ? "online" : "demo";
    $("#mode-demo").classList.toggle("is-active", state.mode === "demo");
    $("#mode-online").classList.toggle("is-active", state.mode === "online");
    $("#reset-demo").hidden = state.mode !== "demo";

    if (state.mode === "demo") {
      disconnectMqtt(false);
      state.tickets = loadDemoTickets();
      updateConnection("demo", "离线演示");
      $("#connection-panel").hidden = true;
      ensureSelection();
      render();
      announce("已切换为离线演示模式。若现场网络异常，完整流程仍可操作。");
    } else {
      $("#connection-panel").hidden = false;
      updateConnection("connecting", "等待连接");
      render();
    }
  }

  function connectMqtt() {
    if (state.mode !== "online") setMode("online");
    if (!window.mqtt) {
      updateConnection("error", "MQTT 库未加载");
      announce("在线组件未加载，请检查网络；离线演示模式不受影响。", "error");
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
    if (state.activeFilter === "finished") return ["completed", "resolved"].includes(ticket.status);
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
      return `
        <button class="ticket-card ${ticket.ticket_id === state.selectedId ? "is-selected" : ""}" type="button" data-ticket-id="${escapeHtml(ticket.ticket_id)}">
          <div class="ticket-card-top">
            <span class="status-badge ${status.className}">${status.label}</span>
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
        state.selectedId = button.dataset.ticketId;
        renderList();
        renderDetail();
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

  function renderDetail() {
    const detail = $("#ticket-detail");
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

      <div class="detail-grid">
        <section class="info-block" aria-label="服务信息">
          <h3>服务信息</h3>
          <div class="info-row"><span>床旁设备</span><span>${escapeHtml(ticket.device_id)}</span></div>
          <div class="info-row"><span>处理人员</span><span>${escapeHtml(ticket.staff_name ? `${ticket.staff_name}（${ticket.staff_id}）` : "尚未分配")}</span></div>
          <div class="info-row"><span>提出时间</span><span>${escapeHtml(formatDateTime(ticket.created_at))}</span></div>
          <div class="info-row"><span>响应耗时</span><span>${escapeHtml(elapsedText(ticket.created_at, ticket.accepted_at))}</span></div>
          <div class="info-row"><span>AI语义整理</span><span>${ticket.ai_enriched ? "已整理" : "本地分类/普通呼叫"}</span></div>
        </section>

        <section class="info-block" aria-label="床旁辅助信息">
          <h3>床旁辅助信息</h3>
          <div class="info-row"><span>环境数据</span><span>${temperature ?? "—"}℃ · ${humidity ?? "—"}%</span></div>
          <div class="info-row"><span>床旁活动</span><span>${escapeHtml(activityLabel(state.care.activity))}</span></div>
          <div class="info-row"><span>药盒记录</span><span>${escapeHtml(medicationText)}</span></div>
          <div class="info-row"><span>数据用途</span><span>辅助服务与夜灯联动</span></div>
        </section>
      </div>

      <section class="info-block timeline-block" aria-label="工单处理记录">
        <h3>处理记录</h3>
        <div class="timeline">
          ${events.length ? events.map((event) => `
            <div class="timeline-item">
              <time class="timeline-time">${escapeHtml(formatTime(event.created_at))}</time>
              <span class="timeline-dot" aria-hidden="true"></span>
              <span>${escapeHtml(eventDescription(event))}</span>
            </div>`).join("") : `<span class="helper">暂无详细操作记录</span>`}
        </div>
      </section>

      ${processHint ? `<p class="ownership-note">${escapeHtml(processHint)}</p>` : ""}
      ${(nextAction || cancelAllowed) ? `
        <div class="detail-actions">
          ${cancelAllowed ? `<button id="cancel-ticket" class="button danger" type="button">取消工单</button>` : ""}
          ${nextAction ? `<button id="advance-ticket" class="button primary" type="button" data-action="${nextAction.action}">${nextAction.label}</button>` : ""}
        </div>` : ""}
    `;

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

    if (state.mode === "online") {
      if (publishJson(TOPICS.action, payload)) announce(`已提交“${ACTION_LABELS[action] || action}”，等待云端确认。`);
      return;
    }

    applyDemoAction(ticket, payload);
    saveDemoTickets();
    render();
  }

  function applyDemoAction(ticket, payload) {
    const transitions = {
      "pending:accept": "accepted",
      "pending:cancel": "cancelled",
      "accepted:arrive": "arrived",
      "accepted:cancel": "cancelled",
      "arrived:complete": "completed",
      "arrived:cancel": "cancelled",
      "completed:reopen": "pending",
      "resolved:reopen": "pending",
      "cancelled:reopen": "pending",
    };
    const nextStatus = transitions[`${ticket.status}:${payload.action}`];
    if (!nextStatus) {
      announce("当前工单状态不允许执行该操作。", "error");
      return;
    }

    const now = new Date().toISOString();
    const previousStatus = ticket.status;
    ticket.status = nextStatus;
    ticket.updated_at = now;
    if (payload.action === "accept") {
      ticket.staff_id = payload.staff_id;
      ticket.staff_name = payload.staff_name;
      ticket.accepted_at = now;
    } else if (payload.action === "arrive") ticket.arrived_at = now;
    else if (payload.action === "complete") ticket.completed_at = now;
    else if (payload.action === "cancel") ticket.cancelled_at = now;
    else if (payload.action === "reopen") {
      ticket.staff_id = "";
      ticket.staff_name = "";
      ticket.accepted_at = "";
      ticket.arrived_at = "";
      ticket.completed_at = "";
      ticket.resolved_at = "";
      ticket.cancelled_at = "";
    }
    ticket.events.push({
      action: payload.action,
      from_status: previousStatus,
      to_status: nextStatus,
      operator_id: payload.staff_id,
      operator_name: payload.staff_name,
      note: "离线演示操作",
      created_at: now,
    });
    announce(`${ACTION_LABELS[payload.action]}成功，工单状态已更新。`, "success");
  }

  function simulateRequest() {
    const presets = [
      ["water", "患者希望协助取一杯温水", "normal"],
      ["toilet", "患者需要如厕协助", "urgent"],
      ["environment", "患者希望调暗床旁灯光", "normal"],
      ["supplies", "患者需要补充纸巾", "normal"],
      ["medicine", "患者希望服务人员协助核对药盒记录", "normal"],
    ];
    const [requestType, requestText, priority] = presets[state.demoPreset++ % presets.length];
    const requestId = `WEB-DEMO-${Date.now()}`;
    const payload = {
      request_id: requestId,
      device_id: "WARD-TERM-001",
      bed_id: ["A03", "A05", "B02", "C01"][state.demoSequence % 4],
      source: "xiaozhi",
      request_type: requestType,
      request_text: requestText,
      priority,
    };

    if (state.mode === "online") {
      if (publishJson(TOPICS.request, payload)) announce("模拟床旁请求已发布，等待云端创建工单。", "success");
      return;
    }

    const now = new Date().toISOString();
    const ticket = normalizeTicket({
      ...payload,
      ticket_id: `TDEMO${Date.now()}${String(state.demoSequence++).padStart(2, "0")}`,
      status: "pending",
      ai_enriched: true,
      created_at: now,
      updated_at: now,
      events: [{ action: "create", from_status: "", to_status: "pending", operator_name: "床旁终端", operator_id: payload.device_id, note: "小智补充需求内容", created_at: now }],
    });
    state.tickets.unshift(ticket);
    state.selectedId = ticket.ticket_id;
    state.activeFilter = "all";
    updateFilterButtons();
    saveDemoTickets();
    render();
    announce(`${ticket.bed_id}床产生新的${requestLabel(requestType)}工单。`, "success");
  }

  function refreshTickets() {
    if (state.mode === "online") {
      if (publishJson(TOPICS.query, { status: "", bed_id: "", requester: state.currentStaff.id })) {
        announce("已向云端请求最新工单快照。", "success");
      }
    } else {
      state.tickets = loadDemoTickets();
      ensureSelection();
      render();
      announce("已刷新本地演示工单。", "success");
    }
  }

  function resetDemo() {
    state.tickets = createInitialTickets();
    state.selectedId = state.tickets[0].ticket_id;
    state.demoSequence = 6;
    state.demoPreset = 0;
    state.activeFilter = "all";
    state.hiddenTicketIds.clear();
    saveHiddenTicketIds();
    localStorage.removeItem("ward_worker_demo_tickets_v2");
    saveDemoTickets();
    updateFilterButtons();
    render();
    announce("演示数据已恢复。", "success");
  }

  function clearFinishedTickets() {
    const closedStatuses = new Set(["completed", "resolved", "cancelled"]);
    const closedTickets = state.tickets.filter(
      (ticket) => closedStatuses.has(ticket.status) && !state.hiddenTicketIds.has(ticket.ticket_id),
    );
    if (!closedTickets.length) {
      announce("当前没有可清理的已结束工单。");
      return;
    }
    closedTickets.forEach((ticket) => state.hiddenTicketIds.add(ticket.ticket_id));
    saveHiddenTicketIds();
    ensureSelection();
    render();
    announce(`已从工作列表清理 ${closedTickets.length} 张工单，云端历史记录仍然保留。`, "success");
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
    $("#restore-hidden").hidden = count === 0;
    $("#restore-hidden").textContent = count ? `恢复已清理（${count}）` : "恢复已清理";
  }

  function updateFilterButtons() {
    $$("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === state.activeFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function bindEvents() {
    $("#login-form").addEventListener("submit", login);
    $("#logout").addEventListener("click", logout);
    $("#mode-demo").addEventListener("click", () => setMode("demo"));
    $("#mode-online").addEventListener("click", () => setMode("online"));
    $("#open-settings").addEventListener("click", () => { $("#connection-panel").hidden = false; });
    $("#close-settings").addEventListener("click", () => { $("#connection-panel").hidden = true; });
    $("#connect-button").addEventListener("click", connectMqtt);
    $("#refresh-tickets").addEventListener("click", refreshTickets);
    $("#simulate-request").addEventListener("click", simulateRequest);
    $("#clear-finished").addEventListener("click", clearFinishedTickets);
    $("#restore-hidden").addEventListener("click", restoreHiddenTickets);
    $("#reset-demo").addEventListener("click", resetDemo);

    $$("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
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

  state.tickets = loadDemoTickets();
  state.selectedId = state.tickets[0]?.ticket_id || "";
  bindEvents();
  startClock();
  updateFilterButtons();
})();
