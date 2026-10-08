function toBRDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function renderCounts(counts) {
  document.getElementById("count-ocupado").textContent = counts.OCUPADO ?? 0;
  document.getElementById("count-livre").textContent = counts.LIVRE ?? 0;
  document.getElementById("count-bloqueado").textContent = counts.BLOQUEADO ?? 0;
  document.getElementById("count-reservado").textContent = counts.RESERVADO ?? 0;
  document.getElementById("count-extra").textContent = counts.EXTRA ?? 0;
  document.getElementById("count-total").textContent = counts.TOTAL ?? 0;
}

function statusLabel(status) {
  if (status === "LIVRE") return "DESOCUPADO";
  return status;
}

let ward = null;
let currentBedId = null;
let wards = [];
let allWards = [];
let currentAdminWardDetails = null;
let currentAdminBedEdit = null;
let currentWardId = null;
let wardShiftPanelRequested = false;
let sessionId = sessionStorage.getItem("sid") || null;
let pendingScrollEnf = null;
let dashboardFilters = { wardId: "", month: "", from: "", to: "" };
let currentUser = null;
let lastClosedReport = null;
let transferWardCache = new Map();
let sidebarPatients = [];
let registeredPatients = [];
let nirPatients = [];
let nirAcceptedPatients = [];
let adminUsers = [];
let currentAdminUserEditId = null;
let currentPatientRecord = null;
let pendingWhatsAppMessage = "";
let staffDirectory = [];
let selectedRegistryPatient = null;
let pendingBedRegistryLink = null;
let nirCurrentReport = null;
let nirPreviousReports = [];
let nirOtherUserReports = [];
let nirSirelSaveTimers = new Map();
let currentPortariaPatient = null;
let portariaActivePatients = [];
let portariaVisitorEntries = [];
let psychologyActivePatients = [];
let psychologyManualEntries = [];
let psychologyMonthlyEntries = [];
let currentPsychologyTab = "queue";
let socialServiceManualEntries = [];
let socialServiceAttendanceEntries = [];
let socialServiceAttendanceSourceEntries = [];
let currentSocialServiceTab = "queue";
let currentSocialServiceFormPatientId = null;
let hospitalTripEntries = [];
let maranhaoTravelCities = [];
let maranhaoTravelCitiesLookup = new Set();
let travelDistanceEstimate = null;
let authRecoveryInProgress = false;

const procedureOptions = ["SNE", "SNG", "SANGUE", "ASPIRAÇÃO", "DRENO DE TORAX"];
const NO_ENFERMARIA_VALUE = "__SEM_ENFERMARIA__";
const ALL_ENFERMARIA_VALUE = "__TODAS_ENFERMARIAS__";
const WHATSAPP_CENTRAL_AIR_LINK = "https://chat.whatsapp.com/FbxcYoy45yCD1TW6eZwGKd";
const WHATSAPP_MAINTENANCE_LINK = "https://chat.whatsapp.com/FbxcYoy45yCD1TW6eZwGKd";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "sidebar-collapsed";
const DEBUG_SESSION_ID = "browser-runtime-slow";
const DEBUG_EVENT_URL = "/__debug/event";
const SOCIAL_SERVICE_FORM_BENEFIT_OPTIONS = ["BPC", "Bolsa Familia", "Auxilio-doenca", "Aposentadoria", "Pensao especial por hanseniase", "Auxilio-reclusao", "Salario maternidade"];
const SOCIAL_SERVICE_FORM_PROFILE_OPTIONS = ["Populacao de rua", "Indigena", "Recluso/Detento", "Quilombola", "LGBTTT", "Pop. urbana", "Pop. rural", "Reside sozinho"];
const SOCIAL_SERVICE_FORM_MARITAL_OPTIONS = ["Casado(a)", "Solteiro(a)", "Separado(a)", "Viuvo(a)", "Divorciado(a)", "Uniao estavel declarada", "Uniao estavel nao declarada"];
const SOCIAL_SERVICE_FORM_EDUCATION_OPTIONS = ["Sem escolaridade", "Fundamental completo", "Fundamental incompleto", "Medio completo", "Medio incompleto", "Superior incompleto", "Superior completo", "Pos-graduado", "Ignorado"];
const SOCIAL_SERVICE_FORM_PREVIDENCIA_BOND_OPTIONS = ["INSS", "Estadual", "Federal", "Municipal", "Previdencia privada", "Sem vinculo"];
const SOCIAL_SERVICE_FORM_PREVIDENCIA_NATURE_OPTIONS = ["Empregado", "Empregado domestico", "Trabalhador avulso", "Contribuinte individual", "Segurado especial", "Segurado facultativo", "Servidor publico"];
const SOCIAL_SERVICE_FORM_PREVIDENCIA_STATUS_OPTIONS = ["Ativo", "Aposentado", "Desempregado", "Pensionista", "Dependente"];

function reportDebugEvent(hypothesisId, location, msg, data = {}) {
  fetch(DEBUG_EVENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function setSidebarToggleVisual(collapsed) {
  const toggleButton = document.getElementById("btn-sidebar-toggle");
  const toggleIcon = toggleButton?.querySelector(".sidebar-toggle-icon");
  if (!toggleButton || !toggleIcon) return;
  toggleButton.setAttribute("aria-label", collapsed ? "Expandir menu lateral" : "Recuar menu lateral");
  toggleButton.setAttribute("title", collapsed ? "Expandir menu lateral" : "Recuar menu lateral");
  toggleIcon.textContent = collapsed ? "→" : "←";
}

function applySidebarCollapsedState(collapsed, persist = true) {
  const shouldCollapse = Boolean(collapsed) && window.innerWidth > 900;
  document.body.classList.toggle("sidebar-collapsed", shouldCollapse);
  setSidebarToggleVisual(shouldCollapse);
  if (persist) {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, shouldCollapse ? "1" : "0");
  }
}

function initializeSidebarPreference() {
  const saved = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  applySidebarCollapsedState(saved, false);
}

function toggleSidebarCollapsedState() {
  const currentlyCollapsed = document.body.classList.contains("sidebar-collapsed");
  applySidebarCollapsedState(!currentlyCollapsed);
}

function syncSidebarCollapsedForViewport() {
  const saved = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  applySidebarCollapsedState(saved, false);
}

function getWhatsAppBrowserLink(inviteLink) {
  const match = String(inviteLink || "").match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
  if (match?.[1]) {
    return `https://web.whatsapp.com/accept?code=${match[1]}`;
  }
  return "https://web.whatsapp.com/";
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function normalizePersonName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatCpf(value) {
  const digits = normalizeCpf(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function formatCep(value) {
  const digits = normalizeCep(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function formatPhone(value) {
  const digits = normalizePhone(value);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)})${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)})${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)})${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function getPatientAgeLabel(birthDate) {
  if (!birthDate) return "";
  const date = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  const dayDiff = today.getDate() - date.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  if (age < 0) return "";
  return `${age} anos`;
}

function getPatientAgeNumber(birthDate, baseDateValue = "") {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const baseDate = baseDateValue ? new Date(baseDateValue) : new Date();
  if (Number.isNaN(baseDate.getTime())) return null;
  let age = baseDate.getFullYear() - birth.getFullYear();
  const monthDiff = baseDate.getMonth() - birth.getMonth();
  const dayDiff = baseDate.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  if (age < 0) return null;
  return age;
}

function getPatientAgeNumberFromLabel(value = "") {
  const match = String(value || "").match(/\d{1,3}/);
  if (!match) return null;
  const age = Number(match[0]);
  if (!Number.isFinite(age) || age < 0) return null;
  return age;
}

function isTodayIsoDate(value) {
  if (!value) return false;
  return String(value).slice(0, 10) === getTodayIsoDate();
}

function isUpdatedInCurrentOperationalDay(value) {
  if (!value) return false;
  return getOperationalDayKey(value) === getOperationalDayKey(new Date());
}

function toBRDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR");
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function getSuggestedVisitShift(baseValue = new Date()) {
  const date = baseValue instanceof Date ? baseValue : new Date(baseValue);
  const hour = date.getHours();
  if (hour < 12) return "MANHA";
  if (hour < 18) return "TARDE";
  return "NOITE";
}

function getOperationalDate(baseValue = new Date()) {
  const date = baseValue instanceof Date ? new Date(baseValue) : new Date(baseValue);
  if (Number.isNaN(date.getTime())) return new Date();
  date.setHours(date.getHours() - 7);
  return date;
}

function getOperationalDayKey(baseValue = new Date()) {
  const date = getOperationalDate(baseValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildWardWhatsAppMessage() {
  const counts = ward?.counts || {};
  const activePendings = (ward?.beds || [])
    .flatMap(bed => (bed.pendenciasHistorico || [])
      .filter(item => item.status !== "FINALIZADA")
      .map(item => `Leito ${bed.id} - ${item.texto}`))
    .slice(0, 10);

  const lines = [
    `Resumo do setor ${ward?.nome || "-"}`,
    `Data: ${ward?.data || new Date().toLocaleDateString("pt-BR")}`,
    `Responsável: ${currentUser?.nome || currentUser?.username || "-"}`,
    `Plantão: ${currentUser?.activeShift ? "Aberto" : "Fechado"}`,
    `Pacientes ocupados: ${counts.OCUPADO ?? 0}`,
    `Leitos livres: ${counts.LIVRE ?? 0}`,
    `Leitos bloqueados: ${counts.BLOQUEADO ?? 0}`,
    `Leitos reservados: ${counts.RESERVADO ?? 0}`,
    `Leitos extras: ${counts.EXTRA ?? 0}`,
    `Total de leitos: ${counts.TOTAL ?? 0}`,
    `Pendências ativas: ${activePendings.length}`
  ];

  if (activePendings.length) {
    lines.push("", "Pendências:");
    lines.push(...activePendings);
  }

  return lines.join("\n");
}

function buildReportWhatsAppMessage(report) {
  const activePendings = (report.pending?.active || [])
    .slice(0, 10)
    .map(item => `Leito ${item.leito} - ${item.texto}`);
  const solvedPendings = (report.pending?.solved || [])
    .slice(0, 10)
    .map(item => `Leito ${item.leito} - ${item.texto}`);

  const lines = [
    `Fechamento de plantão - ${report.shift?.wardNome || "-"}`,
    `Responsável: ${report.shift?.nome || report.shift?.username || "-"}`,
    `Abertura: ${toBRDateTime(report.shift?.openedAt)}`,
    `Fechamento: ${toBRDateTime(report.shift?.closedAt)}`,
    `Pacientes ativos: ${report.summary?.pacientesAtivos ?? 0}`,
    `Altas: ${report.summary?.altas ?? 0}`,
    `Óbitos: ${report.summary?.obitos ?? 0}`,
    `Pendências ativas: ${report.summary?.pendenciasAtivas ?? 0}`,
    `Pendências solucionadas: ${report.summary?.pendenciasSolucionadas ?? 0}`
  ];

  if (activePendings.length) {
    lines.push("", "Pendências ativas:");
    lines.push(...activePendings);
  }

  if (solvedPendings.length) {
    lines.push("", "Pendências solucionadas:");
    lines.push(...solvedPendings);
  }

  return lines.join("\n");
}

function buildWhatsAppMessage() {
  if (lastClosedReport) return buildReportWhatsAppMessage(lastClosedReport);
  return buildWardWhatsAppMessage();
}

function isMaintenancePending(text) {
  const value = String(text || "").toLowerCase();
  return value.includes("manuten");
}

function getMaintenanceWardName() {
  return currentUser?.activeShift?.wardNome || ward?.nome || "-";
}

function buildMaintenanceWhatsAppMessage(centralNumber) {
  const sectorName = getMaintenanceWardName();
  const lines = [
    `Solicito Manutencao de Central de Ar no setor ${sectorName}.`,
    `Central: ${centralNumber}`,
    `Responsavel: ${currentUser?.nome || currentUser?.username || "-"}`,
    `Data: ${ward?.data || new Date().toLocaleDateString("pt-BR")}`
  ];

  return lines.join("\n");
}

function buildGeneralMaintenanceWhatsAppMessage(requestText) {
  const sectorName = getMaintenanceWardName();
  const lines = [
    `Solicito manutencao no setor ${sectorName}.`,
    `Demanda: ${requestText}`,
    `Responsavel: ${currentUser?.nome || currentUser?.username || "-"}`,
    `Data: ${ward?.data || new Date().toLocaleDateString("pt-BR")}`
  ];

  return lines.join("\n");
}

function openWhatsAppPreview(message) {
  pendingWhatsAppMessage = message;
  const textarea = document.getElementById("whatsapp-message-preview");
  if (textarea) textarea.value = message;
  document.getElementById("modal-whatsapp-preview")?.showModal();
}

async function sendWhatsAppMessageNow(message, inviteLink) {
  pendingWhatsAppMessage = message;

  try {
    await navigator.clipboard.writeText(message);
    setShiftFeedback("Texto copiado. Abrindo o grupo em outra aba para voce colar e enviar.");
  } catch {
    setShiftFeedback("Abrindo o grupo em outra aba. Se necessario, copie o texto manualmente antes de enviar.");
  }

  window.open(getWhatsAppBrowserLink(inviteLink), "_blank", "noopener");
}

async function openWhatsAppSummary() {
  if (!WHATSAPP_CENTRAL_AIR_LINK) {
    setShiftFeedback("Link do grupo do WhatsApp não configurado.", true);
    return;
  }

  const centralNumber = window.prompt("Informe o numero da central de ar:");
  if (centralNumber === null) return;

  const normalizedCentralNumber = String(centralNumber).trim();
  if (!normalizedCentralNumber) {
    setShiftFeedback("Informe o numero da central para enviar a solicitacao.", true);
    return;
  }

  const message = buildMaintenanceWhatsAppMessage(normalizedCentralNumber);
  await sendWhatsAppMessageNow(message, WHATSAPP_CENTRAL_AIR_LINK);
}

async function openGeneralMaintenanceSummary() {
  if (!WHATSAPP_MAINTENANCE_LINK) {
    setShiftFeedback("Link do grupo do WhatsApp não configurado.", true);
    return;
  }

  const maintenanceText = window.prompt("Informe a solicitacao de manutencao:");
  if (maintenanceText === null) return;

  const normalizedMaintenanceText = String(maintenanceText).trim();
  if (!normalizedMaintenanceText) {
    setShiftFeedback("Informe a solicitacao para enviar a manutencao.", true);
    return;
  }

  const message = buildGeneralMaintenanceWhatsAppMessage(normalizedMaintenanceText);
  await sendWhatsAppMessageNow(message, WHATSAPP_MAINTENANCE_LINK);
}

function setPatientFieldsEnabled(enabled) {
  const ids = ["modal-nome", "modal-admissao", "modal-diagnostico", "modal-pendencias", "modal-external-transfer-note"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = !enabled;
    if (!enabled) el.classList.add("muted");
    else el.classList.remove("muted");
  }
}

function showUnexpectedError(error) {
  if (error?.isAuthError) return;
  alert(error?.message || "Erro");
}

function setLoginFeedback(message) {
  const feedback = document.getElementById("login-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
}

function clearPatientFields() {
  document.getElementById("modal-nome").value = "";
  document.getElementById("modal-admissao").value = "";
  document.getElementById("modal-diagnostico").value = "";
  document.getElementById("modal-pendencias").value = "";
  document.getElementById("modal-external-transfer-note").value = "";
  setPatientIdentityDisplay("", "");
  selectedRegistryPatient = null;
  setPatientLookupFeedback("");
  toggleCreatePatientButton(false);
  toggleExternalTransferPanel(false);
}

function showOnly(viewId) {
  const ids = ["view-login", "view-dashboard", "view-home", "view-psychology", "view-social-service", "view-portaria", "view-travel", "view-patients", "view-nir", "view-admin"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("hidden", id !== viewId);
  }
  const navMap = {
    "view-dashboard": "nav-dashboard",
    "view-home": "nav-home",
    "view-psychology": "nav-psychology",
    "view-social-service": "nav-social-service",
    "view-portaria": "nav-portaria",
    "view-travel": "nav-travel",
    "view-patients": "nav-patients",
    "view-nir": "nav-nir",
    "view-admin": "nav-gerenciar"
  };
  for (const id of ["nav-dashboard", "nav-home", "nav-psychology", "nav-social-service", "nav-portaria", "nav-travel", "nav-patients", "nav-nir", "nav-gerenciar"]) {
    document.getElementById(id)?.classList.toggle("ghost", navMap[viewId] !== id);
  }
  document.body.classList.toggle("login-only", viewId === "view-login");
}

function syncWorkAreaNavigation() {
  const activeShift = currentUser?.activeShift || null;
  const serviceType = String(activeShift?.serviceType || "").trim().toUpperCase();
  const hasWardShift = Boolean(activeShift && !serviceType && Number(activeShift.wardId));
  const isAdmin = isAdminUser();
  const visibility = {
    ward: isAdmin || hasWardShift,
    PSICOLOGIA: isAdmin || serviceType === "PSICOLOGIA",
    SERVICO_SOCIAL: isAdmin || serviceType === "SERVICO_SOCIAL",
    general: true,
    admin: isAdmin
  };

  for (const item of document.querySelectorAll("[data-work-area]")) {
    const area = item.dataset.workArea;
    item.classList.toggle("hidden", !visibility[area]);
  }
  document.getElementById("nav-workspace-label")?.classList.toggle(
    "hidden",
    !visibility.ward && !visibility.PSICOLOGIA && !visibility.SERVICO_SOCIAL
  );
  document.getElementById("nav-general-label")?.classList.toggle("hidden", false);
  document.getElementById("workshift-start-card")?.classList.toggle("hidden", Boolean(activeShift));
}

function setWardPanelsEnabled(enabled, options = {}) {
  document.getElementById("ward-detail-toolbar")?.classList.toggle("hidden", !enabled);
  if (!enabled) {
    document.getElementById("ward-shift-entry")?.classList.add("hidden");
    document.querySelector(".plantao")?.classList.add("hidden");
  } else {
    syncWardShiftEntryState();
  }
  document.querySelector(".cards")?.classList.toggle("hidden", !enabled);
  document.querySelector(".indicadores")?.classList.toggle("hidden", !enabled);
  document.querySelector(".tabela")?.classList.toggle("hidden", !enabled);
}

function setAppEnabled(enabled) {
  setWardPanelsEnabled(enabled, { showShift: true });
}

async function api(path, options) {
  const startedAt = performance.now();
  // #region debug-point A:frontend-api-start
  reportDebugEvent("A", "public/app.js:api:start", "[DEBUG] Frontend API start", { path, method: options?.method || "GET" });
  // #endregion
  const merged = { ...(options || {}) };
  merged.headers = { ...(merged.headers || {}) };
  if (sessionId) merged.headers["X-Session-Id"] = sessionId;
  const res = await fetch(path, merged);
  const rawText = await res.text();
  let data = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { error: rawText };
    }
  }
  if (!res.ok) {
    const msg = String(data?.error || "Erro").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Erro";
    // #region debug-point A:frontend-api-error
    reportDebugEvent("A", "public/app.js:api:error", "[DEBUG] Frontend API error", {
      path,
      method: merged.method || "GET",
      status: res.status,
      durationMs: Math.round(performance.now() - startedAt),
      error: msg
    });
    // #endregion
    if (res.status === 401 && !String(path).includes("/api/login")) {
      sessionId = null;
      sessionStorage.removeItem("sid");
      currentWardId = null;
      ward = null;
      currentUser = null;
      lastClosedReport = null;
      setAppEnabled(false);
      showOnly("view-login");
      if (!authRecoveryInProgress) {
        authRecoveryInProgress = true;
        window.setTimeout(() => {
          authRecoveryInProgress = false;
        }, 1000);
      }
      const authError = new Error("Sessão expirada. Entre novamente.");
      authError.isAuthError = true;
      throw authError;
    }
    const apiError = new Error(res.status === 503
      ? "Banco central indisponível. A operação foi bloqueada; reconecte-se e tente novamente."
      : msg);
    apiError.status = res.status;
    throw apiError;
  }
  // #region debug-point A:frontend-api-success
  reportDebugEvent("A", "public/app.js:api:success", "[DEBUG] Frontend API success", {
    path,
    method: merged.method || "GET",
    status: res.status,
    durationMs: Math.round(performance.now() - startedAt)
  });
  // #endregion
  return data;
}

function renderIndicadores(ind) {
  document.getElementById("ind-pacientes").textContent = ind.pacientes;
  document.getElementById("ind-leitos").textContent = ind.leitos;
  document.getElementById("ind-altas").textContent = ind.altas;
  document.getElementById("ind-obitos").textContent = ind.obitos;
  document.getElementById("ind-bloqueados").textContent = ind.leitos_bloqueados;
}

function renderBarGroup(containerId, items, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = options.emptyText || "Sem dados para o período.";
    container.appendChild(empty);
    return;
  }

  const maxValue = Math.max(1, ...items.map(item => options.valueKey ? item[options.valueKey] : item.value));
  for (const [index, item] of items.entries()) {
    const label = options.labelKey ? item[options.labelKey] : item.label;
    const value = options.valueKey ? item[options.valueKey] : item.value;
    const row = document.createElement("div");
    row.className = "bar-row";
    const labelEl = document.createElement("div");
    labelEl.className = "bar-label";
    labelEl.textContent = label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    const colorClass = options.getColorClass ? options.getColorClass(item, index) : item.colorClass;
    fill.className = `bar-fill ${colorClass || ""}`.trim();
    fill.style.width = `${Math.max(8, Math.round((value / maxValue) * 100))}%`;
    track.appendChild(fill);
    const valueEl = document.createElement("div");
    valueEl.className = "bar-value";
    valueEl.textContent = options.formatValue ? options.formatValue(item) : String(value);
    row.append(labelEl, track, valueEl);
    container.appendChild(row);
  }
}

function getDashboardColorClass(group, item, index) {
  if (group === "stay") {
    const label = String(item.label || "").toUpperCase();
    if (label.includes("0-3")) return "palette-green";
    if (label.includes("4-7")) return "palette-blue";
    if (label.includes("8-15")) return "palette-yellow";
    if (label.includes("16+")) return "palette-red";
  }

  if (group === "sectors") {
    const rate = Number(item.taxa || item.value || 0);
    if (rate >= 80) return "palette-green";
    if (rate >= 50) return "palette-blue";
    if (rate >= 25) return "palette-yellow";
    return "palette-red";
  }

  const palette = ["palette-blue", "palette-purple", "palette-cyan", "palette-yellow", "palette-pink", "palette-green"];
  return palette[index % palette.length];
}

function updateDashboardFilterInputs() {
  document.getElementById("dashboard-ward").value = dashboardFilters.wardId;
  document.getElementById("dashboard-month").value = dashboardFilters.month;
  document.getElementById("dashboard-from").value = dashboardFilters.from;
  document.getElementById("dashboard-to").value = dashboardFilters.to;
}

function getDashboardQuery() {
  const params = new URLSearchParams();
  if (dashboardFilters.wardId) params.set("wardId", dashboardFilters.wardId);
  if (dashboardFilters.month) params.set("month", dashboardFilters.month);
  if (dashboardFilters.from) params.set("from", dashboardFilters.from);
  if (dashboardFilters.to) params.set("to", dashboardFilters.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function setDashboardFeedback(message = "", isError = false) {
  const feedback = document.getElementById("dashboard-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setShiftFeedback(message = "", isError = false) {
  const feedback = document.getElementById("shift-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPatientLookupFeedback(message = "", isError = false) {
  const feedback = document.getElementById("modal-patient-lookup");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPatientIdentityDisplay(name = "", birthDate = "") {
  const nameField = document.getElementById("modal-patient-name-display");
  const ageField = document.getElementById("modal-patient-age-display");
  if (nameField) {
    nameField.textContent = name || "Será preenchido automaticamente";
    nameField.classList.toggle("is-placeholder", !name);
  }
  if (ageField) {
    const ageText = birthDate ? `${getPatientAgeLabel(birthDate)}${toBRDate(birthDate) ? ` • Nascimento ${toBRDate(birthDate)}` : ""}` : "";
    ageField.textContent = ageText || "Será preenchida automaticamente";
    ageField.classList.toggle("is-placeholder", !ageText);
  }
}

function toggleCreatePatientButton(visible = false) {
  const button = document.getElementById("btn-modal-create-patient");
  if (!button) return;
  button.classList.toggle("hidden", !visible);
}

function toggleExternalTransferPanel(visible = false) {
  const panel = document.getElementById("modal-external-transfer-panel");
  const field = document.getElementById("modal-external-transfer-note");
  if (!panel || !field) return;
  panel.classList.toggle("hidden", !visible);
  if (!visible) {
    field.value = "";
  } else {
    field.focus();
  }
}

function normalizeShiftLength(value) {
  return String(value || "").trim().toUpperCase() === "24H" ? "24H" : "12H";
}

function normalizeShiftPeriod(value, shiftLength = "12H") {
  if (normalizeShiftLength(shiftLength) === "24H") return "COMPLETO";
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "NOITE" ? "NOITE" : "DIA";
}

function getPsychologyAutoShiftPeriod(baseValue = new Date(), shiftLength = "12H") {
  if (normalizeShiftLength(shiftLength) === "24H") return "COMPLETO";
  const date = baseValue instanceof Date ? baseValue : new Date(baseValue);
  const hour = Number.isNaN(date.getTime()) ? new Date().getHours() : date.getHours();
  return hour >= 19 || hour < 7 ? "NOITE" : "DIA";
}

function getShiftPeriodLabel(value) {
  if (value === "NOITE") return "Noite";
  if (value === "COMPLETO") return "Completo";
  return "Dia";
}

function getActiveShiftTeam() {
  const activeShift = currentUser?.activeShift || null;
  if (activeShift?.serviceType === "PSICOLOGIA") return activeShift.team || null;
  if (!activeShift || Number(activeShift.wardId) !== Number(currentWardId)) return null;
  return activeShift.team || null;
}

function collectStaffSuggestionNames(items = []) {
  const names = [];
  const seen = new Set();

  function addName(value) {
    const raw = String(value || "").trim();
    if (!raw) return;
    const parts = raw.split(/\s*,\s*|\s*;\s*|\s+\be\b\s+/i);
    for (const part of parts) {
      const name = String(part || "").trim();
      if (!name) continue;
      const key = name.toLocaleUpperCase("pt-BR");
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }

  for (const item of items) {
    addName(item?.nome || item?.username || item?.displayName || "");
  }

  return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function renderStaffDatalist(listId, names) {
  const datalist = document.getElementById(listId);
  if (!datalist) return;
  datalist.innerHTML = "";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    datalist.appendChild(option);
  }
}

function renderStaffSuggestions(items) {
  staffDirectory = Array.isArray(items) ? items : [];
  const names = collectStaffSuggestionNames(staffDirectory);
  renderStaffDatalist("staff-list-medicos", names);
  renderStaffDatalist("staff-list-enfermeiros", names);
  renderStaffDatalist("staff-list-tecnicos", names);
}

async function refreshStaffSuggestions() {
  try {
    const data = await api("/api/staff");
    renderStaffSuggestions(data.users || []);
    return staffDirectory;
  } catch {
    const fallbackItems = [];
    if (currentUser) {
      fallbackItems.push({ nome: currentUser.nome || currentUser.username || "" });
    }
    const currentTeam = currentUser?.activeShift?.team || ward?.equipe || {};
    for (const value of Object.values(currentTeam)) {
      fallbackItems.push({ nome: value });
    }
    renderStaffSuggestions(fallbackItems);
    return staffDirectory;
  }
}

function renderShiftTeamSummary() {
  const container = document.getElementById("shift-team-summary-list");
  const panel = document.getElementById("shift-team-summary");
  const activeShift = currentUser?.activeShift || null;
  if (!container || !panel) return;

  panel.classList.toggle("hidden", !activeShift);
  container.innerHTML = "";
  if (!activeShift) return;

  const ownerRow = document.createElement("div");
  ownerRow.className = "shift-team-row";
  ownerRow.innerHTML = `<strong>Plantão vinculado</strong><span>${activeShift.ownerName || currentUser?.nome || currentUser?.username || "-"} (${activeShift.ownerUsername || currentUser?.username || "-"})</span>`;
  container.appendChild(ownerRow);

  const team = activeShift.team || {};
  const shiftLength = activeShift.shiftLength || "12H";
  const shiftPeriod = activeShift.shiftPeriod || "DIA";
  const items = [];

  if (team.medicoPlantao) items.push(["Médico do plantão", team.medicoPlantao]);

  if (shiftLength === "24H" || shiftPeriod === "DIA") {
    if (team.enfermeiroDia) items.push(["Enfermeiro(a) dia", team.enfermeiroDia]);
    if (team.tecnicosDia) items.push(["Técnicos(as) dia", team.tecnicosDia]);
  }
  if (shiftLength === "24H" || shiftPeriod === "NOITE" || shiftPeriod === "COMPLETO") {
    if (team.enfermeiroNoite) items.push(["Enfermeiro(a) noite", team.enfermeiroNoite]);
    if (team.tecnicosNoite) items.push(["Técnicos(as) noite", team.tecnicosNoite]);
  }
  if (team.faltosos) items.push(["Faltosos", team.faltosos]);

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "shift-team-empty";
    empty.textContent = "Nenhuma equipe salva neste plantão ainda.";
    container.appendChild(empty);
    return;
  }

  for (const [label, value] of items) {
    const row = document.createElement("div");
    row.className = "shift-team-row";
    row.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
    container.appendChild(row);
  }

  if (activeShift.teamUpdatedBy || activeShift.teamUpdatedAt) {
    const updatedRow = document.createElement("div");
    updatedRow.className = "shift-team-row";
    updatedRow.innerHTML = `<strong>Última atualização da equipe</strong><span>${activeShift.teamUpdatedBy || "-"}${activeShift.teamUpdatedAt ? ` em ${toBRDateTime(activeShift.teamUpdatedAt)}` : ""}</span>`;
    container.appendChild(updatedRow);
  }
}

async function findPatientRegistryByCpf(cpf) {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return null;

  try {
    const data = await api(`/api/patients?search=${encodeURIComponent(digits)}`);
    return (data.patients || []).find(patient => normalizeCpf(patient.cpf) === digits) || null;
  } catch {
    return registeredPatients.find(patient => normalizeCpf(patient.cpf) === digits) || null;
  }
}

function applyRegistryPatientToBedForm(patient, options = {}) {
  const { keepTypedCpf = false } = options;
  selectedRegistryPatient = patient || null;
  if (!patient) {
    setPatientIdentityDisplay("", "");
    setPatientLookupFeedback("");
    toggleCreatePatientButton(false);
    return;
  }

  if (!keepTypedCpf) {
    document.getElementById("modal-nome").value = formatCpf(patient.cpf || "");
  }
  setPatientIdentityDisplay(patient.nome || "", patient.birthDate || "");
  toggleCreatePatientButton(false);

  const details = [];
  if (patient.nome) details.push(patient.nome);
  if (patient.birthDate) details.push(`Nascimento ${toBRDate(patient.birthDate)}`);
  setPatientLookupFeedback(`Paciente localizado: ${details.join(" • ") || formatCpf(patient.cpf || "")}`);
}

function openPatientRegistryFromBedCpf() {
  const typedCpf = document.getElementById("modal-nome").value;
  const digits = normalizeCpf(typedCpf);

  if (digits.length !== 11) {
    setPatientLookupFeedback("Digite um CPF válido com 11 dígitos para realizar o cadastro.", true);
    toggleCreatePatientButton(false);
    return;
  }

  pendingBedRegistryLink = { bedId: currentBedId, cpf: digits };
  document.getElementById("modal-paciente")?.close();
  openNewPatientRegistry({ cpf: digits });
}

async function resolvePatientFromBedCpf(options = {}) {
  const { openRegistryIfMissing = false } = options;
  const typedCpf = document.getElementById("modal-nome").value;
  const digits = normalizeCpf(typedCpf);

  if (!digits) {
    selectedRegistryPatient = null;
    setPatientLookupFeedback("");
    toggleCreatePatientButton(false);
    return null;
  }

  if (digits.length !== 11) {
    selectedRegistryPatient = null;
    setPatientLookupFeedback("Digite um CPF com 11 dígitos para localizar o paciente.", true);
    toggleCreatePatientButton(false);
    return null;
  }

  const patient = await findPatientRegistryByCpf(digits);
  if (patient) {
    applyRegistryPatientToBedForm(patient);
    return patient;
  }

  selectedRegistryPatient = null;
  setPatientLookupFeedback("CPF não encontrado. Cadastre o paciente para vincular este leito.", true);
  toggleCreatePatientButton(true);
  if (openRegistryIfMissing) {
    openPatientRegistryFromBedCpf();
  }
  return null;
}

function getHeaderTeamData() {
  const activeShift = currentUser?.activeShift || null;
  const activeShiftMatchesWard = Boolean(activeShift && Number(activeShift.wardId) === Number(currentWardId));
  const sourceTeam = activeShiftMatchesWard ? (activeShift.team || {}) : (ward?.equipe || {});
  const shiftDate = activeShiftMatchesWard ? (activeShift.shiftDate || getTodayIsoDate()) : (ward?.data || toBRDate(getTodayIsoDate()));
  return {
    shiftDate,
    medico: sourceTeam.medicoPlantao || "",
    enfermeiro: sourceTeam.enfermeiroDia || sourceTeam.enfermeiroNoite || "",
    tecnico: sourceTeam.tecnicosDia || sourceTeam.tecnicosNoite || ""
  };
}

function renderHeaderTeamPanel() {
  const panel = document.getElementById("header-team-panel");
  const list = document.getElementById("header-team-list");
  const dateLabel = document.getElementById("header-team-date");
  if (!panel || !list || !dateLabel) return;

  const isVisible = Boolean(currentWardId && ward);
  panel.classList.toggle("hidden", !isVisible);
  if (!isVisible) return;

  const team = getHeaderTeamData();
  dateLabel.textContent = `Data: ${team.shiftDate || ward?.data || "-"}`;
  list.innerHTML = "";

  const items = [
    ["Medico", team.medico],
    ["Enfermeiro", team.enfermeiro],
    ["Tecnico", team.tecnico]
  ].filter(([, value]) => value);

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "header-team-empty";
    empty.textContent = "Nenhuma equipe cadastrada para este setor nesta data.";
    list.appendChild(empty);
    return;
  }

  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "header-team-card";
    card.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
    list.appendChild(card);
  }
}

function buildShiftHistoryTeamLines(shift) {
  const team = shift?.team || {};
  const shiftLength = shift?.shiftLength || "12H";
  const shiftPeriod = shift?.shiftPeriod || "DIA";
  const items = [];

  if (team.medicoPlantao) items.push(`Médico: ${team.medicoPlantao}`);
  if (shiftLength === "24H" || shiftPeriod === "DIA") {
    if (team.enfermeiroDia) items.push(`Enf. dia: ${team.enfermeiroDia}`);
    if (team.tecnicosDia) items.push(`Tec. dia: ${team.tecnicosDia}`);
  }
  if (shiftLength === "24H" || shiftPeriod === "NOITE" || shiftPeriod === "COMPLETO") {
    if (team.enfermeiroNoite) items.push(`Enf. noite: ${team.enfermeiroNoite}`);
    if (team.tecnicosNoite) items.push(`Tec. noite: ${team.tecnicosNoite}`);
  }
  if (team.faltosos) items.push(`Faltosos: ${team.faltosos}`);
  if (shift?.teamUpdatedBy || shift?.teamUpdatedAt) {
    items.push(`Equipe atualizada por: ${shift.teamUpdatedBy || "-"}${shift.teamUpdatedAt ? ` em ${toBRDateTime(shift.teamUpdatedAt)}` : ""}`);
  }

  return items;
}

function renderShiftHistory() {
  const container = document.getElementById("shift-history-list");
  if (!container) return;
  container.innerHTML = "";

  const activeShift = currentUser?.activeShift || null;
  if (activeShift) {
    const currentCard = document.createElement("div");
    currentCard.className = "shift-history-card current";
    currentCard.innerHTML = `
      <strong>Plantão em andamento</strong>
      <span>Data: ${toBRDate(activeShift.shiftDate || getTodayIsoDate())}</span>
      <span>Aberto por ${activeShift.ownerName || currentUser?.nome || currentUser?.username || "-"} (${activeShift.ownerUsername || currentUser?.username || "-"}) em ${toBRDateTime(activeShift.openedAt)}</span>
    `;
    container.appendChild(currentCard);
  }

  const shifts = Array.isArray(currentUser?.recentShifts) ? currentUser.recentShifts : [];
  if (!shifts.length && !activeShift) {
    const empty = document.createElement("div");
    empty.className = "shift-team-empty";
    empty.textContent = "Nenhum histórico de plantão registrado.";
    container.appendChild(empty);
    return;
  }

  for (const shift of shifts) {
    const card = document.createElement("div");
    card.className = "shift-history-card";
    const teamLines = buildShiftHistoryTeamLines(shift);
    const meta = [
      `Data: ${toBRDate(shift.shiftDate || (shift.openedAt ? String(shift.openedAt).slice(0, 10) : "")) || "-"}`,
      `Setor: ${shift.wardNome || "-"}`,
      `Vinculado a: ${shift.ownerName || shift.ownerUsername || "-"}`,
      `Abertura: ${toBRDateTime(shift.openedAt) || "-"}`,
      `Fechamento: ${toBRDateTime(shift.closedAt) || "-"}`
    ];
    card.innerHTML = `
      <strong>${shift.shiftLength || "12H"} • ${getShiftPeriodLabel(shift.shiftPeriod)}</strong>
      ${meta.map(item => `<span>${item}</span>`).join("")}
      ${teamLines.length ? `<div class="shift-history-team">${teamLines.map(item => `<span>${item}</span>`).join("")}</div>` : "<span>Equipe não registrada.</span>"}
    `;
    container.appendChild(card);
  }
}

function renderShiftTeamForm() {
  const team = getActiveShiftTeam();
  const activeShift = currentUser?.activeShift || null;
  const loggedUserName = currentUser?.nome || currentUser?.username || "";
  const shiftLength = activeShift?.shiftLength || normalizeShiftLength(document.getElementById("shift-length")?.value);
  const shiftPeriod = activeShift?.shiftPeriod || normalizeShiftPeriod(document.getElementById("shift-period")?.value, shiftLength);
  const defaultNurseDay = (shiftLength === "24H" || shiftPeriod === "DIA" || shiftPeriod === "COMPLETO") ? loggedUserName : "";
  const defaultNurseNight = (shiftLength === "24H" || shiftPeriod === "NOITE" || shiftPeriod === "COMPLETO") ? loggedUserName : "";
  const shiftDate = document.getElementById("shift-date");
  if (shiftDate) shiftDate.value = activeShift?.shiftDate || getTodayIsoDate();
  document.getElementById("eq-medico").value = team?.medicoPlantao || "";
  document.getElementById("eq-enf-dia").value = team?.enfermeiroDia || defaultNurseDay;
  document.getElementById("eq-tec-dia").value = team?.tecnicosDia || "";
  document.getElementById("eq-enf-noite").value = team?.enfermeiroNoite || defaultNurseNight;
  document.getElementById("eq-tec-noite").value = team?.tecnicosNoite || "";
  document.getElementById("eq-faltosos").value = team?.faltosos || "";
}

function openShiftTeamModal(feedback = setShiftFeedback) {
  if (!currentUser?.activeShift) {
    feedback("Abra o plantão antes de cadastrar a equipe.", true);
    return;
  }
  renderShiftTeamForm();
  syncShiftFormVisibility();
  document.getElementById("modal-shift-team")?.showModal();
}

function syncShiftFormVisibility() {
  const shiftLength = normalizeShiftLength(document.getElementById("shift-length")?.value);
  const shiftPeriod = normalizeShiftPeriod(document.getElementById("shift-period")?.value, shiftLength);
  const periodSelect = document.getElementById("shift-period");
  if (periodSelect) {
    periodSelect.value = shiftPeriod;
    periodSelect.disabled = shiftLength === "24H" || Boolean(currentUser?.activeShift);
  }
  document.getElementById("field-eq-enf-dia")?.classList.toggle("hidden", shiftLength === "12H" && shiftPeriod === "NOITE");
  document.getElementById("field-eq-tec-dia")?.classList.toggle("hidden", shiftLength === "12H" && shiftPeriod === "NOITE");
  document.getElementById("field-eq-enf-noite")?.classList.toggle("hidden", shiftLength === "12H" && shiftPeriod === "DIA");
  document.getElementById("field-eq-tec-noite")?.classList.toggle("hidden", shiftLength === "12H" && shiftPeriod === "DIA");
}

function syncPsychologyShiftFormVisibility() {
  const activeShift = currentUser?.activeShift || null;
  const psychShift = activeShift?.serviceType === "PSICOLOGIA" ? activeShift : null;
  const lengthSelect = document.getElementById("psychology-shift-length");
  if (lengthSelect) {
    lengthSelect.disabled = Boolean(psychShift);
  }
  const openButton = document.getElementById("btn-open-psychology-shift");
  const closeButton = document.getElementById("btn-close-psychology-shift");
  if (openButton) openButton.disabled = Boolean(psychShift);
  if (closeButton) closeButton.disabled = false;
}

function syncSocialServiceShiftFormVisibility() {
  const activeShift = currentUser?.activeShift || null;
  const socialShift = activeShift?.serviceType === "SERVICO_SOCIAL" ? activeShift : null;
  const lengthSelect = document.getElementById("social-service-shift-length");
  if (lengthSelect) {
    lengthSelect.disabled = Boolean(socialShift);
  }
  const openButton = document.getElementById("btn-open-social-service-shift");
  const closeButton = document.getElementById("btn-close-social-service-shift");
  if (openButton) openButton.disabled = Boolean(socialShift);
  if (closeButton) closeButton.disabled = false;
}

function renderPsychologyShiftPanel() {
  const activeShift = currentUser?.activeShift || null;
  const psychShift = activeShift?.serviceType === "PSICOLOGIA" ? activeShift : null;
  const shiftDate = document.getElementById("psychology-shift-date");
  const shiftLength = document.getElementById("psychology-shift-length");
  if (shiftDate) shiftDate.value = psychShift?.shiftDate || getOperationalDayKey();
  if (shiftLength) shiftLength.value = psychShift?.shiftLength || "12H";
  syncPsychologyShiftFormVisibility();
  syncPsychologyEditingAvailability();
}

function renderSocialServiceShiftPanel() {
  const activeShift = currentUser?.activeShift || null;
  const socialShift = activeShift?.serviceType === "SERVICO_SOCIAL" ? activeShift : null;
  const shiftDate = document.getElementById("social-service-shift-date");
  const shiftLength = document.getElementById("social-service-shift-length");
  if (shiftDate) shiftDate.value = socialShift?.shiftDate || getOperationalDayKey();
  if (shiftLength) shiftLength.value = socialShift?.shiftLength || "12H";
  syncSocialServiceShiftFormVisibility();
}

function setSidebarPatientFeedback(message = "", isError = false) {
  const feedback = document.getElementById("sidebar-patient-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function clearSidebarPatientForm() {
  document.getElementById("sidebar-patient-name").value = "";
  document.getElementById("sidebar-patient-cpf").value = "";
  document.getElementById("sidebar-patient-birthdate").value = "";
  document.getElementById("sidebar-patient-admission").value = "";
}

function getSidebarWardId() {
  const selectedWardId = parseInt(document.getElementById("topbar-ward-select")?.value || String(currentWardId || ""), 10);
  return Number.isInteger(selectedWardId) ? selectedWardId : null;
}

function renderSidebarPatientBedOptions(targetWard) {
  const bedSelect = document.getElementById("sidebar-patient-bed");
  if (!bedSelect) return;
  bedSelect.innerHTML = "";
  bedSelect.appendChild(new Option("Selecione o leito", ""));

  const availableBeds = (targetWard?.beds || [])
    .filter(item => item.status === "LIVRE" || item.status === "EXTRA")
    .sort((a, b) => a.id - b.id);

  for (const bed of availableBeds) {
    const enfermaria = bed.enfermaria || "SEM ENFERMARIA";
    bedSelect.appendChild(new Option(`LEITO ${bed.id} - ${enfermaria}`, String(bed.id)));
  }

  bedSelect.disabled = availableBeds.length === 0;
}

function renderSidebarPatientsList(items) {
  sidebarPatients = Array.isArray(items) ? items : [];
  const table = document.getElementById("sidebar-patient-list");
  const empty = document.getElementById("sidebar-patient-list-empty");
  if (!table || !empty) return;

  table.innerHTML = "";
  empty.classList.toggle("hidden", sidebarPatients.length > 0);

  for (const patient of sidebarPatients) {
    const row = document.createElement("div");
    row.className = "sidebar-patient-item";
    row.innerHTML = `
      <div>
        <strong>${patient.nome || "-"}</strong>
        <span>Leito ${patient.id} • ${patient.enfermaria || "Sem enfermaria"}</span>
      </div>
      <div>
        <strong>${formatCpf(patient.cpf || "") || "-"}</strong>
        <span>CPF</span>
      </div>
      <div>
        <strong>${patient.birthDate ? toBRDate(patient.birthDate) : "-"}</strong>
        <span>Data de nascimento</span>
      </div>
      <div>
        <span class="admin-user-role-badge">Leito ${patient.id}</span>
      </div>
    `;
    table.appendChild(row);
  }
}

async function refreshSidebarPatients() {
  const wardId = getSidebarWardId();
  if (!wardId) {
    renderSidebarPatientBedOptions({ beds: [] });
    renderSidebarPatientsList([]);
    return [];
  }
  try {
    const targetWard = await api(`/api/wards/${wardId}`);
    renderSidebarPatientBedOptions(targetWard);
    const patients = (targetWard.beds || [])
      .filter(item => String(item.nome || "").trim())
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    renderSidebarPatientsList(patients);
    return sidebarPatients;
  } catch (error) {
    renderSidebarPatientBedOptions({ beds: [] });
    renderSidebarPatientsList([]);
    setSidebarPatientFeedback(error.message || "Não foi possível carregar os pacientes.", true);
    return [];
  }
}

function setPatientsFeedback(message = "", isError = false) {
  const feedback = document.getElementById("patients-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPatientRegistryFeedback(message = "", isError = false) {
  const feedback = document.getElementById("patient-registry-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setAdminWardFeedback(message = "", isError = false) {
  const feedback = document.getElementById("admin-ward-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setAdminBedEditFeedback(message = "", isError = false) {
  const feedback = document.getElementById("admin-bed-edit-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function isAdminUser() {
  return currentUser?.role === "admin";
}

function setAdminUsersFeedback(message = "", isError = false) {
  const feedback = document.getElementById("admin-users-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function clearAdminUserForm() {
  currentAdminUserEditId = null;
  document.getElementById("admin-user-name").value = "";
  document.getElementById("admin-user-username").value = "";
  document.getElementById("admin-user-cpf").value = "";
  document.getElementById("admin-user-birthdate").value = "";
  document.getElementById("admin-user-role").value = "user";
  document.getElementById("admin-user-password").value = "";
  document.getElementById("btn-save-user").textContent = "Salvar usuário";
  document.getElementById("btn-cancel-user-edit")?.classList.add("hidden");
}

function fillAdminUserForm(user) {
  currentAdminUserEditId = user.id;
  document.getElementById("admin-user-name").value = user.nome || "";
  document.getElementById("admin-user-username").value = user.username || "";
  document.getElementById("admin-user-cpf").value = formatCpf(user.cpf || "");
  document.getElementById("admin-user-birthdate").value = user.birthDate || "";
  document.getElementById("admin-user-role").value = user.role || "user";
  document.getElementById("admin-user-password").value = "";
  document.getElementById("btn-save-user").textContent = "Salvar alterações";
  document.getElementById("btn-cancel-user-edit")?.classList.remove("hidden");
}

function renderAdminUsers(items) {
  adminUsers = Array.isArray(items) ? items : [];
  const container = document.getElementById("admin-users-list");
  const empty = document.getElementById("admin-users-list-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", adminUsers.length > 0);

  for (const user of adminUsers) {
    const row = document.createElement("div");
    row.className = "admin-user-row";
    row.innerHTML = `
      <div>
        <strong>${user.nome || "-"}</strong>
        <span>Login: ${user.username || "-"}</span>
      </div>
      <div>
        <strong>${formatCpf(user.cpf || "") || "-"}</strong>
        <span>CPF</span>
      </div>
      <div>
        <strong>${user.birthDate ? toBRDate(user.birthDate) : "-"}</strong>
        <span>Data de nascimento</span>
      </div>
      <div class="admin-user-actions">
        <span class="admin-user-role-badge">${user.role === "admin" ? "Administrador" : "Usuário"}</span>
        <button type="button" class="ghost btn-admin-user-edit" data-id="${user.id}">Alterar</button>
      </div>
    `;
    container.appendChild(row);
  }
}

async function loadAdminUsers() {
  if (!isAdminUser()) {
    renderAdminUsers([]);
    return [];
  }
  const data = await api("/api/users");
  renderAdminUsers(data.users || []);
  return adminUsers;
}

async function saveAdminUser() {
  if (!isAdminUser()) {
    setAdminUsersFeedback("Somente administrador pode acessar os usuários.", true);
    return;
  }

  const payload = {
    nome: document.getElementById("admin-user-name").value.trim(),
    username: document.getElementById("admin-user-username").value.trim(),
    cpf: normalizeCpf(document.getElementById("admin-user-cpf").value),
    birthDate: document.getElementById("admin-user-birthdate").value,
    role: document.getElementById("admin-user-role").value,
    password: document.getElementById("admin-user-password").value
  };

  const isEditing = Boolean(currentAdminUserEditId);
  const endpoint = isEditing ? `/api/users/${currentAdminUserEditId}` : "/api/users";
  const method = isEditing ? "PATCH" : "POST";

  try {
    await api(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    clearAdminUserForm();
    await loadAdminUsers();
    await refreshCurrentUser();
    setAdminUsersFeedback(isEditing ? "Usuário alterado com sucesso." : "Usuário cadastrado com sucesso.");
  } catch (error) {
    setAdminUsersFeedback(error.message || "Não foi possível salvar o usuário.", true);
  }
}

function syncAdminAccess() {
  const isAdmin = isAdminUser();
  document.getElementById("nav-gerenciar")?.classList.toggle("hidden", !isAdmin);
  document.getElementById("btn-gerenciar")?.classList.toggle("hidden", !isAdmin);
  document.getElementById("admin-users-section")?.classList.toggle("hidden", !isAdmin);
  syncWorkAreaNavigation();
}

function renderHeaderWardTabs() {
  const container = document.getElementById("header-ward-tabs");
  const count = document.getElementById("home-ward-count");
  if (!container) return;
  container.innerHTML = "";
  if (count) {
    count.textContent = `${wards.length} ${wards.length === 1 ? "setor" : "setores"}`;
  }

  for (const item of wards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hero-tab${item.id === currentWardId ? " active" : ""}`;
    button.dataset.id = String(item.id);
    button.textContent = item.nome || "-";
    container.appendChild(button);
  }
}

function renderWardDetailToolbar() {
  const title = document.getElementById("ward-detail-title");
  const subtitle = document.getElementById("ward-detail-subtitle");
  if (!title || !subtitle) return;

  const selectedWard = ward && Number(ward.id) === Number(currentWardId)
    ? ward
    : wards.find(item => Number(item.id) === Number(currentWardId));

  title.textContent = selectedWard?.nome || "Setor";
  subtitle.textContent = selectedWard
    ? `Setor ${selectedWard.nome} aberto. Aqui você pode abrir o plantão, fechar, imprimir o relatório e depois voltar para acessar os outros setores.`
    : "Abra o plantão, feche, imprima o relatório e volte para acessar os outros setores.";
}

function hasActiveWardShiftForCurrentWard() {
  const activeShift = currentUser?.activeShift || null;
  const serviceType = String(activeShift?.serviceType || "").trim().toUpperCase();
  return Boolean(activeShift && !serviceType && Number(activeShift.wardId) === Number(currentWardId));
}

function syncWardShiftEntryState() {
  const entry = document.getElementById("ward-shift-entry");
  const plantao = document.querySelector(".plantao");
  const entryTitle = document.getElementById("ward-shift-entry-title");
  const entrySubtitle = document.getElementById("ward-shift-entry-subtitle");
  const assumeButton = document.getElementById("btn-assume-ward-shift");
  if (!entry || !plantao) return;

  const sectorOpen = Boolean(currentWardId && !document.getElementById("ward-detail-toolbar")?.classList.contains("hidden"));
  const activeShift = currentUser?.activeShift || null;
  const activeWardShift = hasActiveWardShiftForCurrentWard();
  const hasOtherShiftOpen = Boolean(activeShift && !activeWardShift);
  const shouldShowPlantao = Boolean(sectorOpen && (activeWardShift || wardShiftPanelRequested));

  entry.classList.toggle("hidden", !sectorOpen || shouldShowPlantao);
  plantao.classList.toggle("hidden", !shouldShowPlantao);

  if (!sectorOpen || shouldShowPlantao) return;

  if (activeWardShift) {
    if (entryTitle) entryTitle.textContent = "Plantão em andamento";
    if (entrySubtitle) entrySubtitle.textContent = "Você já está responsável por este setor. O painel do plantão está disponível abaixo.";
    if (assumeButton) {
      assumeButton.textContent = "Continuar no plantão";
      assumeButton.disabled = false;
    }
    return;
  }

  if (hasOtherShiftOpen) {
    if (entryTitle) entryTitle.textContent = "Plantão já aberto em outro setor";
    if (entrySubtitle) entrySubtitle.textContent = `Você já está responsável por ${activeShift?.wardNome || "outro setor"}. Feche o plantão atual para assumir este setor.`;
    if (assumeButton) {
      assumeButton.textContent = "Assumir setor";
      assumeButton.disabled = true;
    }
    return;
  }

  if (entryTitle) entryTitle.textContent = "Assumir este setor";
  if (entrySubtitle) entrySubtitle.textContent = "Quando você assumir o setor, o painel do plantão será liberado para abrir, fechar e imprimir o relatório do período.";
  if (assumeButton) {
    assumeButton.textContent = "Assumir setor";
    assumeButton.disabled = false;
  }
}

function renderPatientCurrentAdmission(admission) {
  const container = document.getElementById("patient-registry-current");
  if (!container) return;
  const patient = currentPatientRecord || {};
  const nirHistory = Array.isArray(patient.nirHistory) ? patient.nirHistory.slice(0, 5) : [];
  const nirSummary = patient.nirWorkflowStatus
    ? `
      <div style="margin-top:8px;"><strong>NIR:</strong> ${escapeHtml(patient.nirWorkflowStatus)}</div>
      <div><strong>Local:</strong> ${escapeHtml(patient.nirAcceptedLocation || "-")}</div>
      <div><strong>Motivo:</strong> ${escapeHtml(patient.nirActionReason || "-")}</div>
      <div><strong>Atualizado por:</strong> ${escapeHtml(patient.nirStatusUpdatedBy || "-")}${patient.nirStatusUpdatedAt ? ` em ${escapeHtml(toBRDateTime(patient.nirStatusUpdatedAt))}` : ""}</div>
      ${nirHistory.length ? `<div style="margin-top:6px;"><strong>Histórico NIR:</strong><br>${nirHistory.map(item => `${escapeHtml(item.status || "-")} • ${escapeHtml(item.location || item.reason || "-")} • ${escapeHtml(toBRDateTime(item.at) || "-")}`).join("<br>")}</div>` : ""}
    `
    : "";
  if (!admission) {
    container.innerHTML = `Paciente sem internação ativa no momento.${nirSummary}`;
    return;
  }
  container.innerHTML = `
    <strong>${admission.wardNome || "-"} • Leito ${admission.bedId || "-"}</strong>
    <div>Enfermaria: ${admission.enfermaria || "Sem enfermaria"}</div>
    <div>Admissão: ${admission.admittedAt ? toBRDate(admission.admittedAt) : "-"}</div>
    ${nirSummary}
  `;
}

function renderPatientAdmissionHistory(items) {
  const container = document.getElementById("patient-registry-history");
  if (!container) return;
  container.innerHTML = "";

  if (!items?.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "Nenhuma internação registrada.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";
    const content = document.createElement("div");
    content.className = "patient-history-card";
    const title = document.createElement("strong");
    title.textContent = `${item.wardNome || "-"} • Leito ${item.bedId || "-"} • ${item.enfermaria || "Sem enfermaria"}`;
    const admission = document.createElement("span");
    admission.textContent = `Entrada: ${item.admittedAt ? toBRDate(item.admittedAt) : "-"}`;
    const discharge = document.createElement("span");
    discharge.textContent = `Saída: ${item.dischargedAt ? toBRDateTime(item.dischargedAt) : "Internação ativa"}`;
    const outcome = document.createElement("span");
    outcome.textContent = `Desfecho: ${item.outcome || "Em andamento"}`;
    content.append(title, admission, discharge, outcome);

    const transfers = Array.isArray(item.transferHistory) ? item.transferHistory : [];
    for (const transfer of transfers) {
      const move = document.createElement("span");
      move.textContent = `Transferência: ${transfer.fromWardNome || "-"} / Leito ${transfer.fromBedId || "-"} -> ${transfer.toWardNome || "-"} / Leito ${transfer.toBedId || "-"} em ${toBRDateTime(transfer.at)}`;
      content.appendChild(move);
    }

    row.appendChild(content);
    container.appendChild(row);
  }
}

function fillPatientRegistryModal(patient) {
  currentPatientRecord = patient;
  setPatientRegistryFeedback("");
  document.getElementById("patient-registry-title").textContent = patient.nome || "Novo paciente";
  document.getElementById("patient-registry-name").value = patient.nome || "";
  document.getElementById("patient-registry-cpf").value = formatCpf(patient.cpf || "");
  document.getElementById("patient-registry-birthdate").value = patient.birthDate || "";
  document.getElementById("patient-registry-phone").value = formatPhone(patient.phone || "");
  renderPatientCurrentAdmission(patient.currentAdmission || null);
  renderPatientAdmissionHistory(patient.admissionHistory || []);
  document.getElementById("patient-registry-delete").disabled = Boolean(patient.currentAdmission);
}

function openNewPatientRegistry(prefill = {}) {
  fillPatientRegistryModal({
    id: null,
    nome: prefill.nome || "",
    cpf: prefill.cpf || "",
    birthDate: prefill.birthDate || "",
    phone: prefill.phone || "",
    nir: prefill.nir || "",
    cil: prefill.cil || "",
    regulationChannels: Array.isArray(prefill.regulationChannels) ? prefill.regulationChannels : [],
    currentAdmission: null,
    admissionHistory: []
  });
  document.getElementById("patient-registry-title").textContent = "Novo paciente";
  document.getElementById("patient-registry-save").disabled = false;
  document.getElementById("patient-registry-delete").disabled = true;
  document.getElementById("modal-patient-registry").showModal();
}

function renderRegisteredPatients(items) {
  registeredPatients = Array.isArray(items) ? items : [];
  const container = document.getElementById("patients-list");
  const empty = document.getElementById("patients-list-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", registeredPatients.length > 0);

  for (const patient of registeredPatients) {
    const row = document.createElement("div");
    row.className = "patient-row";
    const current = patient.currentAdmission;
    row.innerHTML = `
      <div>
        <strong>${patient.nome || "-"}</strong>
        <span>CPF ${formatCpf(patient.cpf || "") || "-"}</span>
      </div>
      <div>
        <strong>${patient.birthDate ? toBRDate(patient.birthDate) : "-"}</strong>
        <span>Data de nascimento</span>
      </div>
      <div>
        <strong>${current ? "Internado" : "Sem internação ativa"}</strong>
        <span>${current ? `${current.wardNome || "-"} • Leito ${current.bedId || "-"}` : "Cadastro disponível"}</span>
      </div>
      <div>
        <strong>${patient.admissionCount || 0}</strong>
        <span>Internações registradas</span>
      </div>
      <div class="patient-actions">
        <button type="button" class="ghost btn-patient-open" data-id="${patient.id}">Alterar / Histórico</button>
        <button type="button" class="ghost btn-patient-delete" data-id="${patient.id}" ${current ? "disabled" : ""}>Excluir</button>
      </div>
    `;
    container.appendChild(row);
  }
}

function setPortariaFeedback(message = "", isError = false) {
  const feedback = document.getElementById("portaria-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPortariaVisitFeedback(message = "", isError = false) {
  const feedback = document.getElementById("portaria-visit-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPortariaRegistryFeedback(message = "", isError = false) {
  const feedback = document.getElementById("portaria-registry-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPortariaSocialFeedback(message = "", isError = false) {
  const feedback = document.getElementById("portaria-social-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPsychologyFeedback(message = "", isError = false) {
  const feedback = document.getElementById("psychology-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPsychologyShiftFeedback(message = "", isError = false) {
  const feedback = document.getElementById("psychology-shift-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setSocialServiceShiftFeedback(message = "", isError = false) {
  const feedback = document.getElementById("social-service-shift-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setSocialServiceFeedback(message = "", isError = false) {
  const feedback = document.getElementById("social-service-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPsychologyManualFeedback(message = "", isError = false) {
  const feedback = document.getElementById("psychology-manual-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setSocialServiceManualFeedback(message = "", isError = false) {
  const feedback = document.getElementById("social-service-manual-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPsychologyMonthlyFeedback(message = "", isError = false) {
  const feedback = document.getElementById("psychology-monthly-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setPsychologyRecordFeedback(message = "", isError = false) {
  const feedback = document.getElementById("psychology-record-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setTravelFeedback(message = "", isError = false) {
  const feedback = document.getElementById("travel-form-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function formatTravelKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0 km";
  return `${numeric.toLocaleString("pt-BR", {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
    maximumFractionDigits: 1
  })} km`;
}

function formatProcedureUnits(value) {
  const units = Number(value) || 0;
  return String(units).padStart(2, "0");
}

function calculateTravelProcedureUnits(distanceKm) {
  const total = Number(distanceKm);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / 50);
}

function hasCompanionTravelFormData() {
  return Boolean(
    document.getElementById("travel-companion-name")?.value.trim()
    || document.getElementById("travel-companion-cpf")?.value.trim()
    || document.getElementById("travel-companion-address")?.value.trim()
  );
}

function updateTravelSummary(items) {
  const countEl = document.getElementById("travel-count");
  const kmEl = document.getElementById("travel-km-total");
  const trips = Array.isArray(items) ? items : [];
  const totalKm = trips.reduce((sum, item) => sum + (Number(item.distance) || 0), 0);
  if (countEl) countEl.textContent = `${trips.length} viagem${trips.length === 1 ? "" : "s"}`;
  if (kmEl) kmEl.textContent = `${totalKm.toLocaleString("pt-BR")} km`;
}

function renderTravelCityOptions(cities) {
  maranhaoTravelCities = Array.isArray(cities) ? cities : [];
  maranhaoTravelCitiesLookup = new Set(maranhaoTravelCities.map(item => String(item || "").toLocaleLowerCase("pt-BR")));
  const datalist = document.getElementById("travel-destination-cities");
  if (!datalist) return;

  datalist.innerHTML = "";
  for (const city of maranhaoTravelCities) {
    const option = document.createElement("option");
    option.value = city;
    datalist.appendChild(option);
  }
}

function applyTravelEstimate(estimate = null) {
  travelDistanceEstimate = estimate;
  const oneWayEl = document.getElementById("travel-estimate-one-way");
  const roundTripEl = document.getElementById("travel-estimate-round-trip");
  if (oneWayEl) oneWayEl.textContent = formatTravelKm(estimate?.oneWayKm || 0);
  if (roundTripEl) roundTripEl.textContent = formatTravelKm(estimate?.roundTripKm || 0);
  updateTravelProcedureSummary();
}

function updateTravelProcedureSummary() {
  const patientUnitsEl = document.getElementById("travel-patient-procedure-units");
  const companionUnitsEl = document.getElementById("travel-companion-procedure-units");
  const units = calculateTravelProcedureUnits(travelDistanceEstimate?.roundTripKm);
  if (patientUnitsEl) patientUnitsEl.textContent = formatProcedureUnits(units);
  if (companionUnitsEl) {
    companionUnitsEl.textContent = formatProcedureUnits(hasCompanionTravelFormData() ? units : 0);
  }
}

async function loadTravelCities() {
  if (maranhaoTravelCities.length) return;

  const data = await api("/api/hospital-trips/cities");
  renderTravelCityOptions(data.cities || []);
  document.getElementById("travel-origin").value = data.originLabel || "Hospital Municipal de Açailândia";
  applyTravelEstimate(null);
}

async function refreshTravelEstimate(force = false) {
  const destination = document.getElementById("travel-destination")?.value.trim() || "";
  if (!destination) {
    applyTravelEstimate(null);
    return;
  }

  const normalized = destination.toLocaleLowerCase("pt-BR");
  if (!force && maranhaoTravelCitiesLookup.size && !maranhaoTravelCitiesLookup.has(normalized)) {
    applyTravelEstimate(null);
    setTravelFeedback("Escolha uma cidade da lista do Maranhão para calcular o km.", true);
    return;
  }

  try {
    const data = await api(`/api/hospital-trips/estimate?destination=${encodeURIComponent(destination)}`);
    applyTravelEstimate(data);
    setTravelFeedback("");
  } catch (error) {
    applyTravelEstimate(null);
    setTravelFeedback(error.message || "Nao foi possivel calcular a distancia da viagem.", true);
  }
}

function updatePortariaRegistryCount(count) {
  const badge = document.getElementById("portaria-registry-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = `${total} registro${total === 1 ? "" : "s"}`;
}

function updatePortariaSocialCount(count) {
  const badge = document.getElementById("portaria-social-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total === 1 ? "1 solicitação" : `${total} solicitações`;
}

function updatePsychologyCount(count) {
  const badge = document.getElementById("psychology-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total === 1 ? "1 solicitação" : `${total} solicitações`;
}

function updatePsychologyManualCount(count) {
  const badge = document.getElementById("psychology-manual-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = `${total} registro${total === 1 ? "" : "s"}`;
}

function updateSocialServiceManualCount(count) {
  const badge = document.getElementById("social-service-manual-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = `${total} registro${total === 1 ? "" : "s"}`;
}

function updatePsychologyMonthlyCount(count) {
  const badge = document.getElementById("psychology-monthly-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total === 1 ? "1 atendimento" : `${total} atendimentos`;
}

function updatePsychologyRecentCount(count) {
  const badge = document.getElementById("psychology-recent-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total === 1 ? "1 atendimento" : `${total} atendimentos`;
}

function updateSocialServiceHistoryCount(count) {
  const badge = document.getElementById("social-service-history-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total === 1 ? "1 registro" : `${total} registros`;
}

function updateSocialServiceAgeCount(count) {
  const badge = document.getElementById("social-service-age-count");
  if (!badge) return;
  const total = Number(count) || 0;
  badge.textContent = total === 1 ? "1 atendimento" : `${total} atendimentos`;
}

function getCurrentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function hasServiceSocialRequest(patient) {
  const request = patient?.currentAdmission?.serviceSocialRequest || {};
  const status = String(request?.status || "").trim().toUpperCase();
  if (patient?.socialSupport?.dischargePending) return true;
  if (status === "BAIXA" || request?.closedAt) return false;
  return Boolean(request?.requested || request?.requestedAt || request?.viewedAt || request?.startedAt);
}

function hasNirRequest(patient) {
  const request = patient?.currentAdmission?.nirRequest || {};
  const status = String(request?.status || "").trim().toUpperCase();
  if (patient?.nirDischargePending) return true;
  if (status === "BAIXA" || request?.closedAt) return false;
  return Boolean(request?.requested || request?.requestedAt || request?.viewedAt || request?.startedAt);
}

function getPsychologyRequestState(request = {}) {
  const status = String(request?.status || "").trim().toUpperCase();
  if (status === "EM_ACOMPANHAMENTO") return "EM_ACOMPANHAMENTO";
  if (status === "BAIXA") return "BAIXA";
  if (status === "SOLICITADO") return "SOLICITADO";
  if (request?.startedAt || request?.viewedAt) return "EM_ACOMPANHAMENTO";
  if (request?.requested || request?.requestedAt) return "SOLICITADO";
  return "";
}

function hasPsychologyRequest(patient) {
  if (patient?.psychologySupport?.dischargePending) return true;
  const state = getPsychologyRequestState(patient?.currentAdmission?.psychologyRequest);
  return state === "SOLICITADO" || state === "EM_ACOMPANHAMENTO";
}

function getPsychologyQueueKey(patient) {
  if (patient?.isManualRequest) {
    return `manual:${String(patient.manualRequestId || patient.id || "")}`;
  }
  const admission = patient?.currentAdmission || {};
  return `${admission.wardId || ""}:${admission.bedId || ""}`;
}

function buildPsychologyManualRequestState(entry = {}) {
  const status = String(entry.status || "SOLICITADO").trim().toUpperCase();
  return {
    requested: status !== "BAIXA",
    requestedAt: entry.createdAt || "",
    requestedBy: entry.createdBy || "",
    viewedAt: status === "SOLICITADO" ? "" : (entry.updatedAt || entry.createdAt || ""),
    viewedBy: status === "SOLICITADO" ? "" : (entry.updatedBy || entry.createdBy || ""),
    startedAt: status === "EM_ACOMPANHAMENTO" ? (entry.updatedAt || entry.createdAt || "") : "",
    startedBy: status === "EM_ACOMPANHAMENTO" ? (entry.updatedBy || entry.createdBy || "") : "",
    closedAt: status === "BAIXA" ? (entry.closedAt || entry.updatedAt || "") : "",
    closedBy: status === "BAIXA" ? (entry.closedBy || entry.updatedBy || "") : "",
    observation: entry.observation || entry.notes || "",
    status
  };
}

function getActivePsychologyManualRequests(items = psychologyManualEntries) {
  return (Array.isArray(items) ? items : []).filter(entry => String(entry?.status || "SOLICITADO").trim().toUpperCase() !== "BAIXA");
}

function buildPsychologyManualQueueEntries(items = psychologyManualEntries) {
  return getActivePsychologyManualRequests(items).map(entry => ({
    id: `manual-${String(entry.id || "")}`,
    manualRequestId: String(entry.id || ""),
    isManualRequest: true,
    nome: entry.patientName || "",
    birthDate: "",
    diagnostico: entry.notes || "",
    manualEntry: { ...entry },
    psychologySupport: {
      interventions: entry.interventions || "",
      observation: entry.observation || "",
      dischargePending: false,
      dischargeNote: "",
      dischargeAt: "",
      dischargeBy: "",
      updatedAt: entry.updatedAt || "",
      updatedBy: entry.updatedBy || ""
    },
    currentAdmission: {
      wardId: "",
      wardNome: entry.sectorOrReason || "Solicitação avulsa",
      bedId: "-",
      admittedAt: entry.createdAt || "",
      active: false,
      psychologyRequest: buildPsychologyManualRequestState(entry)
    }
  }));
}

async function refreshPsychologyQueueView() {
  const queue = await buildPsychologyQueueFromWards(wards);
  const merged = [...queue, ...buildPsychologyManualQueueEntries()]
    .sort((a, b) =>
      String(a.currentAdmission?.wardNome || "").localeCompare(String(b.currentAdmission?.wardNome || ""), "pt-BR")
      || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
    );
  renderPsychologyPatients(merged);
  return merged;
}

function buildSocialServiceManualRequestState(entry = {}) {
  const status = String(entry.status || "SOLICITADO").trim().toUpperCase();
  return {
    requested: status !== "BAIXA",
    requestedAt: entry.createdAt || "",
    requestedBy: entry.createdBy || "",
    viewedAt: status === "SOLICITADO" ? "" : (entry.updatedAt || entry.createdAt || ""),
    viewedBy: status === "SOLICITADO" ? "" : (entry.updatedBy || entry.createdBy || ""),
    startedAt: status === "EM_ACOMPANHAMENTO" ? (entry.updatedAt || entry.createdAt || "") : "",
    startedBy: status === "EM_ACOMPANHAMENTO" ? (entry.updatedBy || entry.createdBy || "") : "",
    closedAt: status === "BAIXA" ? (entry.closedAt || entry.updatedAt || "") : "",
    closedBy: status === "BAIXA" ? (entry.closedBy || entry.updatedBy || "") : "",
    observation: entry.observation || entry.notes || "",
    status
  };
}

function getActiveSocialServiceManualRequests(items = socialServiceManualEntries) {
  return (Array.isArray(items) ? items : []).filter(entry => String(entry?.status || "SOLICITADO").trim().toUpperCase() !== "BAIXA");
}

function buildSocialServiceManualQueueEntries(items = socialServiceManualEntries) {
  return getActiveSocialServiceManualRequests(items).map(entry => ({
    id: `manual-social-${String(entry.id || "")}`,
    manualRequestId: String(entry.id || ""),
    isManualRequest: true,
    nome: entry.patientName || "",
    birthDate: "",
    phone: entry.contacts || "",
    manualEntry: { ...entry },
    socialSupport: {
      contacts: entry.contacts || "",
      admissionNotes: "",
      socialRecord: entry.socialRecord || "Pendente",
      observation: entry.observation || "",
      socialForm: {},
      socialRecordUpdatedAt: entry.updatedAt || "",
      socialRecordUpdatedBy: entry.updatedBy || "",
      dischargePending: false,
      dischargeNote: "",
      dischargeAt: "",
      dischargeBy: "",
      updatedAt: entry.updatedAt || "",
      updatedBy: entry.updatedBy || ""
    },
    currentAdmission: {
      wardId: "",
      wardNome: entry.sectorOrReason || "Solicitação avulsa",
      bedId: "-",
      admittedAt: entry.createdAt || "",
      active: false,
      serviceSocialRequest: buildSocialServiceManualRequestState(entry)
    }
  }));
}

async function refreshSocialServiceQueueView() {
  const queue = await buildServiceSocialQueueFromWards(wards);
  const merged = [...queue, ...buildSocialServiceManualQueueEntries()]
    .sort((a, b) =>
      String(a.currentAdmission?.wardNome || "").localeCompare(String(b.currentAdmission?.wardNome || ""), "pt-BR")
      || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
    );
  portariaActivePatients = merged;
  renderPortariaSocialList(merged);
  return merged;
}

function getPsychologyStatusPresentation(request = {}) {
  const state = getPsychologyRequestState(request);
  if (state === "BAIXA") {
    return {
      state,
      label: "Alta do atendimento",
      chipClassName: "done",
      badgeClassName: "done",
      meta: request?.closedBy
        ? `${request.closedBy}`
        : `${toBRDateTime(request?.closedAt) || "-"}`
    };
  }
  if (state === "EM_ACOMPANHAMENTO") {
    return {
      state,
      label: "Em acompanhamento",
      chipClassName: "in-progress",
      badgeClassName: "in-progress",
      meta: request?.startedBy
        ? `${request.startedBy}`
        : `${toBRDateTime(request?.startedAt) || "-"}`
    };
  }
  if (state === "SOLICITADO") {
    return {
      state,
      label: "Solicitado",
      chipClassName: "requested",
      badgeClassName: "requested",
      meta: request?.requestedBy
        ? `${request.requestedBy}`
        : `${toBRDateTime(request?.requestedAt) || "-"}`
    };
  }
  return {
    state,
    label: "Sem solicitação",
    chipClassName: "none",
    badgeClassName: "none",
    meta: ""
  };
}

function getSupportDischargeMeta(support = {}) {
  if (!support?.dischargePending) return "";
  const when = support.dischargeAt ? toBRDateTime(support.dischargeAt) : "-";
  return support.dischargeNote || `Setor deu alta em ${when}. Finalize aqui o acompanhamento.`;
}

function createPsychologySupportState(value = {}) {
  return {
    interventions: String(value?.interventions || "").trim(),
    observation: String(value?.observation || "").trim(),
    dischargePending: Boolean(value?.dischargePending),
    dischargeNote: String(value?.dischargeNote || "").trim(),
    dischargeAt: String(value?.dischargeAt || "").trim(),
    dischargeBy: String(value?.dischargeBy || "").trim(),
    updatedAt: String(value?.updatedAt || "").trim(),
    updatedBy: String(value?.updatedBy || "").trim()
  };
}

function createSocialSupportState(value = {}) {
  return {
    contacts: String(value?.contacts || "").trim(),
    admissionNotes: String(value?.admissionNotes || "").trim(),
    socialRecord: normalizeSocialServiceRecordValue(value?.socialRecord),
    observation: String(value?.observation || "").trim(),
    socialForm: createSocialServiceFormState(value?.socialForm),
    socialRecordUpdatedAt: String(value?.socialRecordUpdatedAt || "").trim(),
    socialRecordUpdatedBy: String(value?.socialRecordUpdatedBy || "").trim(),
    dischargePending: Boolean(value?.dischargePending),
    dischargeNote: String(value?.dischargeNote || "").trim(),
    dischargeAt: String(value?.dischargeAt || "").trim(),
    dischargeBy: String(value?.dischargeBy || "").trim(),
    updatedAt: String(value?.updatedAt || "").trim(),
    updatedBy: String(value?.updatedBy || "").trim()
  };
}

function createSocialServiceFormContactState(value = {}) {
  return {
    name: String(value?.name || "").trim(),
    kinship: String(value?.kinship || "").trim(),
    phone: String(value?.phone || "").trim(),
    address: String(value?.address || "").trim()
  };
}

function createSocialServiceFormState(value = {}) {
  return {
    admissionDate: String(value?.admissionDate || "").trim(),
    admissionTime: String(value?.admissionTime || "").trim(),
    admissionSector: String(value?.admissionSector || "").trim(),
    bed: String(value?.bed || "").trim(),
    admissionReason: String(value?.admissionReason || "").trim(),
    fullName: String(value?.fullName || "").trim(),
    socialName: String(value?.socialName || "").trim(),
    affiliation: String(value?.affiliation || "").trim(),
    birthDate: String(value?.birthDate || "").trim(),
    ageLabel: String(value?.ageLabel || "").trim(),
    cns: String(value?.cns || "").trim(),
    cpf: String(value?.cpf || "").trim(),
    raceColor: String(value?.raceColor || "").trim(),
    sex: String(value?.sex || "").trim(),
    religion: String(value?.religion || "").trim(),
    birthplace: String(value?.birthplace || "").trim(),
    income: String(value?.income || "").trim(),
    occupation: String(value?.occupation || "").trim(),
    address: String(value?.address || "").trim(),
    hasDisability: String(value?.hasDisability || "").trim(),
    disabilityDescription: String(value?.disabilityDescription || "").trim(),
    familyContacts: (Array.isArray(value?.familyContacts) ? value.familyContacts : []).map(createSocialServiceFormContactState).filter(item => item.name || item.kinship || item.phone || item.address),
    maritalStatus: String(value?.maritalStatus || "").trim(),
    partnerName: String(value?.partnerName || "").trim(),
    educationLevel: String(value?.educationLevel || "").trim(),
    benefits: (Array.isArray(value?.benefits) ? value.benefits : []).map(item => String(item || "").trim()).filter(Boolean),
    benefitsOther: String(value?.benefitsOther || "").trim(),
    previdenciaBond: String(value?.previdenciaBond || "").trim(),
    previdenciaNature: String(value?.previdenciaNature || "").trim(),
    previdenciaSituation: String(value?.previdenciaSituation || "").trim(),
    companionName: String(value?.companionName || "").trim(),
    companionPhone: String(value?.companionPhone || "").trim(),
    companionKinship: String(value?.companionKinship || "").trim(),
    companionAddress: String(value?.companionAddress || "").trim(),
    profileTags: (Array.isArray(value?.profileTags) ? value.profileTags : []).map(item => String(item || "").trim()).filter(Boolean),
    funeralPlan: String(value?.funeralPlan || "").trim(),
    familyRelationship: String(value?.familyRelationship || "").trim(),
    familyRelationshipNotes: String(value?.familyRelationshipNotes || "").trim(),
    socialEvolution: String(value?.socialEvolution || "").trim(),
    filledAt: String(value?.filledAt || "").trim(),
    filledBy: String(value?.filledBy || "").trim(),
    updatedAt: String(value?.updatedAt || "").trim(),
    updatedBy: String(value?.updatedBy || "").trim()
  };
}

function hasSocialServiceFormContent(value = {}) {
  const form = createSocialServiceFormState(value);
  return Boolean(
    form.admissionDate
    || form.admissionTime
    || form.admissionSector
    || form.bed
    || form.admissionReason
    || form.fullName
    || form.socialName
    || form.affiliation
    || form.birthDate
    || form.ageLabel
    || form.cns
    || form.cpf
    || form.raceColor
    || form.sex
    || form.religion
    || form.birthplace
    || form.income
    || form.occupation
    || form.address
    || form.hasDisability
    || form.disabilityDescription
    || form.maritalStatus
    || form.partnerName
    || form.educationLevel
    || form.benefits.length
    || form.benefitsOther
    || form.previdenciaBond
    || form.previdenciaNature
    || form.previdenciaSituation
    || form.companionName
    || form.companionPhone
    || form.companionKinship
    || form.companionAddress
    || form.profileTags.length
    || form.funeralPlan
    || form.familyRelationship
    || form.familyRelationshipNotes
    || form.socialEvolution
    || form.familyContacts.length
  );
}

function getSocialServiceAdmissionTimeValue(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized.includes("T")) return "";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function inferSocialServiceAdmissionSector(patient = {}) {
  const wardName = String(patient?.currentAdmission?.wardNome || "").trim().toUpperCase();
  if (!wardName) return "";
  if (wardName.includes("UTI")) return "UTI";
  if (wardName.includes("OBS")) return "OBS";
  if (wardName.includes("NEO")) return "NEO";
  if (wardName.includes("PED")) return "PEDIATRIA";
  if (wardName.includes("ISOL")) return "ISOLAMENTO";
  if (wardName.includes("ESTAB")) return "S EST.";
  if (wardName.includes("POSTO") || wardName.includes("ENF")) return "ENF.";
  return wardName;
}

function buildSocialServicePrefilledForm(patient = {}) {
  const admittedAt = String(patient?.currentAdmission?.admittedAt || "").trim();
  const patientPhone = formatPhone(patient?.phone || "");
  return createSocialServiceFormState({
    admissionDate: admittedAt ? admittedAt.slice(0, 10) : "",
    admissionTime: getSocialServiceAdmissionTimeValue(admittedAt),
    admissionSector: inferSocialServiceAdmissionSector(patient),
    bed: String(patient?.currentAdmission?.bedId || "").trim(),
    admissionReason: String(patient?.diagnostico || "").trim(),
    fullName: String(patient?.nome || "").trim(),
    birthDate: String(patient?.birthDate || "").trim(),
    ageLabel: getPatientAgeLabel(patient?.birthDate || "") || "",
    cpf: String(patient?.cpf || "").trim(),
    familyContacts: patientPhone ? [createSocialServiceFormContactState({ phone: patientPhone })] : []
  });
}

function mergeSocialServiceFormWithPrefill(savedForm = {}, prefilledForm = {}) {
  const saved = createSocialServiceFormState(savedForm);
  const prefilled = createSocialServiceFormState(prefilledForm);
  return createSocialServiceFormState({
    admissionDate: saved.admissionDate || prefilled.admissionDate,
    admissionTime: saved.admissionTime || prefilled.admissionTime,
    admissionSector: saved.admissionSector || prefilled.admissionSector,
    bed: saved.bed || prefilled.bed,
    admissionReason: saved.admissionReason || prefilled.admissionReason,
    fullName: saved.fullName || prefilled.fullName,
    socialName: saved.socialName,
    affiliation: saved.affiliation,
    birthDate: saved.birthDate || prefilled.birthDate,
    ageLabel: saved.ageLabel || prefilled.ageLabel,
    cns: saved.cns,
    cpf: saved.cpf || prefilled.cpf,
    raceColor: saved.raceColor,
    sex: saved.sex,
    religion: saved.religion,
    birthplace: saved.birthplace,
    income: saved.income,
    occupation: saved.occupation,
    address: saved.address || prefilled.address,
    hasDisability: saved.hasDisability,
    disabilityDescription: saved.disabilityDescription,
    familyContacts: saved.familyContacts.length ? saved.familyContacts : prefilled.familyContacts,
    maritalStatus: saved.maritalStatus,
    partnerName: saved.partnerName,
    educationLevel: saved.educationLevel,
    benefits: saved.benefits,
    benefitsOther: saved.benefitsOther,
    previdenciaBond: saved.previdenciaBond,
    previdenciaNature: saved.previdenciaNature,
    previdenciaSituation: saved.previdenciaSituation,
    companionName: saved.companionName,
    companionPhone: saved.companionPhone,
    companionKinship: saved.companionKinship,
    companionAddress: saved.companionAddress,
    profileTags: saved.profileTags,
    funeralPlan: saved.funeralPlan,
    familyRelationship: saved.familyRelationship,
    familyRelationshipNotes: saved.familyRelationshipNotes,
    socialEvolution: saved.socialEvolution,
    filledAt: saved.filledAt,
    filledBy: saved.filledBy,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy
  });
}

function buildSocialServiceSelectOptions(options = [], selectedValue = "") {
  const selected = String(selectedValue || "").trim();
  return [`<option value=""></option>`]
    .concat(options.map(option => `<option value="${escapeHtml(option)}" ${selected === option ? "selected" : ""}>${escapeHtml(option)}</option>`))
    .join("");
}

function buildSocialServiceCheckboxGroupHtml(options = [], selectedValues = [], groupName = "") {
  const selected = new Set((Array.isArray(selectedValues) ? selectedValues : []).map(item => String(item || "").trim()));
  return options.map(option => `
    <label class="checkbox-chip">
      <input type="checkbox" data-social-form-group="${escapeHtml(groupName)}" value="${escapeHtml(option)}" ${selected.has(option) ? "checked" : ""}>
      <span>${escapeHtml(option)}</span>
    </label>
  `).join("");
}

function buildSocialServiceFamilyContactRowsHtml(contacts = []) {
  const rows = Array.from({ length: 3 }, (_, index) => createSocialServiceFormContactState(contacts[index]));
  return rows.map((contact, index) => `
    <div class="social-service-form-family-row">
      <label>Nome
        <input data-social-form-field="familyContactName${index}" value="${escapeHtml(contact.name)}" placeholder="Nome do familiar">
      </label>
      <label>Parentesco
        <input data-social-form-field="familyContactKinship${index}" value="${escapeHtml(contact.kinship)}" placeholder="Ex: mae, filho, esposa">
      </label>
      <label>Telefone
        <input data-social-form-field="familyContactPhone${index}" value="${escapeHtml(contact.phone)}" placeholder="Telefone">
      </label>
      <label>Endereco
        <input data-social-form-field="familyContactAddress${index}" value="${escapeHtml(contact.address)}" placeholder="Endereco">
      </label>
    </div>
  `).join("");
}

function getSocialServiceFormBadgeClass(value = "") {
  return normalizeSocialServiceRecordValue(value) === "Concluído" ? "is-complete" : "is-pending";
}

function setSocialServiceFormFeedback(message = "", isError = false) {
  const feedback = document.getElementById("social-service-form-feedback");
  if (!feedback) return;
  const normalized = String(message || "").trim();
  feedback.textContent = normalized;
  feedback.classList.toggle("hidden", !normalized);
  feedback.classList.toggle("error-text", Boolean(normalized && isError));
}

function renderSocialServiceFormModal(patient = {}) {
  const support = createSocialSupportState(patient?.socialSupport);
  const savedForm = createSocialServiceFormState(support.socialForm);
  const form = mergeSocialServiceFormWithPrefill(savedForm, buildSocialServicePrefilledForm(patient));
  const hasFilledForm = hasSocialServiceFormContent(savedForm);
  const title = document.getElementById("social-service-form-title");
  const meta = document.getElementById("social-service-form-meta");
  const fields = document.getElementById("social-service-form-fields");

  if (title) {
    title.textContent = `${hasFilledForm ? "Editar" : "Preencher"} FORM-SS-003 - Ficha Social`;
  }

  if (meta) {
    meta.classList.remove("hidden");
    meta.innerHTML = `
      <div class="social-service-form-meta-top">
        <div class="social-service-form-meta-kicker">FORM-SS-003</div>
        <a class="social-service-form-template-link" href="/forms/form-ss-003-ficha-social.pdf" target="_blank" rel="noopener">Abrir PDF oficial</a>
      </div>
      <div class="social-service-form-meta-title">Ficha Social - Servico Social</div>
      <div class="social-service-form-meta-subtitle">${escapeHtml(patient?.nome || "Paciente")}</div>
      <div class="social-service-form-meta-grid">
        <div class="social-service-form-meta-item"><span>Setor</span><strong>${escapeHtml(patient?.currentAdmission?.wardNome || "-")}</strong></div>
        <div class="social-service-form-meta-item"><span>Leito</span><strong>${escapeHtml(String(patient?.currentAdmission?.bedId || "-"))}</strong></div>
        <div class="social-service-form-meta-item"><span>Admissao</span><strong>${escapeHtml(toBRDate(form.admissionDate) || "-")}</strong></div>
        <div class="social-service-form-meta-item"><span>Status</span><strong>${escapeHtml(hasFilledForm ? "Concluído" : "Pendente")}</strong></div>
      </div>
    `;
  }

  if (fields) {
    fields.innerHTML = `
      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Dados da internacao</div>
        <div class="social-service-form-grid">
          <label>Admissao
            <input data-social-form-field="admissionDate" type="date" value="${escapeHtml(form.admissionDate)}">
          </label>
          <label>Hora
            <input data-social-form-field="admissionTime" type="time" value="${escapeHtml(form.admissionTime)}">
          </label>
          <label>Setor
            <input data-social-form-field="admissionSector" value="${escapeHtml(form.admissionSector)}" placeholder="Ex: UTI, ENF., OBS">
          </label>
          <label>Leito
            <input data-social-form-field="bed" value="${escapeHtml(form.bed)}" placeholder="Leito">
          </label>
          <label class="is-span-4">Motivo da internacao / causa primaria
            <textarea data-social-form-field="admissionReason" rows="2" placeholder="Descreva o motivo da internacao">${escapeHtml(form.admissionReason)}</textarea>
          </label>
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Paciente - dados pessoais</div>
        <div class="social-service-form-grid">
          <label class="is-span-2">Nome completo
            <input data-social-form-field="fullName" value="${escapeHtml(form.fullName)}" placeholder="Nome completo">
          </label>
          <label class="is-span-2">Nome social
            <input data-social-form-field="socialName" value="${escapeHtml(form.socialName)}" placeholder="Se aplicavel">
          </label>
          <label class="is-span-2">Filiacao
            <input data-social-form-field="affiliation" value="${escapeHtml(form.affiliation)}" placeholder="Nome da mae, pai ou responsavel">
          </label>
          <label>Data de nascimento
            <input data-social-form-field="birthDate" type="date" value="${escapeHtml(form.birthDate)}">
          </label>
          <label>Idade
            <input data-social-form-field="ageLabel" value="${escapeHtml(form.ageLabel)}" placeholder="Idade">
          </label>
          <label>CNS
            <input data-social-form-field="cns" value="${escapeHtml(form.cns)}" placeholder="Numero do CNS">
          </label>
          <label>CPF
            <input data-social-form-field="cpf" value="${escapeHtml(form.cpf)}" placeholder="CPF">
          </label>
          <label>Raca/Cor
            <input data-social-form-field="raceColor" value="${escapeHtml(form.raceColor)}" placeholder="Raca/Cor">
          </label>
          <label>Sexo
            <input data-social-form-field="sex" value="${escapeHtml(form.sex)}" placeholder="Sexo">
          </label>
          <label>Religiao
            <input data-social-form-field="religion" value="${escapeHtml(form.religion)}" placeholder="Religiao">
          </label>
          <label>Naturalidade
            <input data-social-form-field="birthplace" value="${escapeHtml(form.birthplace)}" placeholder="Naturalidade">
          </label>
          <label>Renda
            <input data-social-form-field="income" value="${escapeHtml(form.income)}" placeholder="Renda">
          </label>
          <label class="is-span-2">Profissao / atividade laboral
            <input data-social-form-field="occupation" value="${escapeHtml(form.occupation)}" placeholder="Profissao ou atividade laboral">
          </label>
          <label class="is-span-4">Endereco
            <input data-social-form-field="address" value="${escapeHtml(form.address)}" placeholder="Endereco do paciente">
          </label>
          <label>Possui deficiencia?
            <select data-social-form-field="hasDisability">
              ${buildSocialServiceSelectOptions(["Nao", "Sim"], form.hasDisability)}
            </select>
          </label>
          <label class="is-span-3">Qual?
            <input data-social-form-field="disabilityDescription" value="${escapeHtml(form.disabilityDescription)}" placeholder="Descreva, se houver">
          </label>
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Contatos familiares</div>
        <div class="social-service-form-family-grid">
          ${buildSocialServiceFamilyContactRowsHtml(form.familyContacts)}
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Estado civil e escolaridade</div>
        <div class="social-service-form-grid">
          <label class="is-span-2">Estado civil
            <select data-social-form-field="maritalStatus">
              ${buildSocialServiceSelectOptions(SOCIAL_SERVICE_FORM_MARITAL_OPTIONS, form.maritalStatus)}
            </select>
          </label>
          <label class="is-span-2">Companheiro(a) / conjuge
            <input data-social-form-field="partnerName" value="${escapeHtml(form.partnerName)}" placeholder="Nome do companheiro(a) ou conjuge">
          </label>
          <label class="is-span-2">Escolaridade
            <select data-social-form-field="educationLevel">
              ${buildSocialServiceSelectOptions(SOCIAL_SERVICE_FORM_EDUCATION_OPTIONS, form.educationLevel)}
            </select>
          </label>
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Beneficios e situacao previdenciaria</div>
        <div class="social-service-form-grid">
          <div class="is-span-4">
            <label>Beneficios recebidos</label>
            <div class="social-service-form-chip-grid">
              ${buildSocialServiceCheckboxGroupHtml(SOCIAL_SERVICE_FORM_BENEFIT_OPTIONS, form.benefits, "benefits")}
            </div>
          </div>
          <label class="is-span-4">Outros beneficios
            <input data-social-form-field="benefitsOther" value="${escapeHtml(form.benefitsOther)}" placeholder="Outros beneficios">
          </label>
          <label>Vinculo
            <select data-social-form-field="previdenciaBond">
              ${buildSocialServiceSelectOptions(SOCIAL_SERVICE_FORM_PREVIDENCIA_BOND_OPTIONS, form.previdenciaBond)}
            </select>
          </label>
          <label class="is-span-2">Natureza do vinculo
            <select data-social-form-field="previdenciaNature">
              ${buildSocialServiceSelectOptions(SOCIAL_SERVICE_FORM_PREVIDENCIA_NATURE_OPTIONS, form.previdenciaNature)}
            </select>
          </label>
          <label>Situacao atual
            <select data-social-form-field="previdenciaSituation">
              ${buildSocialServiceSelectOptions(SOCIAL_SERVICE_FORM_PREVIDENCIA_STATUS_OPTIONS, form.previdenciaSituation)}
            </select>
          </label>
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Acompanhante autorizado(a)</div>
        <div class="social-service-form-grid">
          <label class="is-span-2">Nome
            <input data-social-form-field="companionName" value="${escapeHtml(form.companionName)}" placeholder="Nome do acompanhante">
          </label>
          <label>Telefone
            <input data-social-form-field="companionPhone" value="${escapeHtml(form.companionPhone)}" placeholder="Telefone">
          </label>
          <label>Parentesco
            <input data-social-form-field="companionKinship" value="${escapeHtml(form.companionKinship)}" placeholder="Parentesco">
          </label>
          <label class="is-span-4">Endereco
            <input data-social-form-field="companionAddress" value="${escapeHtml(form.companionAddress)}" placeholder="Endereco do acompanhante">
          </label>
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Perfil do paciente e relacao intrafamiliar</div>
        <div class="social-service-form-grid">
          <div class="is-span-4">
            <label>Perfil do paciente</label>
            <div class="social-service-form-chip-grid">
              ${buildSocialServiceCheckboxGroupHtml(SOCIAL_SERVICE_FORM_PROFILE_OPTIONS, form.profileTags, "profileTags")}
            </div>
          </div>
          <label>Convenio funerario
            <select data-social-form-field="funeralPlan">
              ${buildSocialServiceSelectOptions(["Publico", "Particular"], form.funeralPlan)}
            </select>
          </label>
          <label class="is-span-3">Relacao intrafamiliar
            <select data-social-form-field="familyRelationship">
              ${buildSocialServiceSelectOptions(["Familia sem conflito relevante", "Familia conflito relevante", "Familia com violencia"], form.familyRelationship)}
            </select>
          </label>
          <label class="is-span-4">Detalhamento da relacao intrafamiliar
            <textarea data-social-form-field="familyRelationshipNotes" rows="2" placeholder="Detalhe se houver conflito ou violencia">${escapeHtml(form.familyRelationshipNotes)}</textarea>
          </label>
        </div>
      </section>

      <section class="social-service-form-section">
        <div class="social-service-form-section-title">Evolucao social</div>
        <div class="social-service-form-grid">
          <label class="is-span-4">Evolucao
            <textarea data-social-form-field="socialEvolution" rows="6" placeholder="Registre a evolucao social">${escapeHtml(form.socialEvolution || support.observation || "")}</textarea>
          </label>
          <div class="is-span-4 social-service-form-note">
            ${hasFilledForm && form.updatedAt ? `Ultima atualizacao por ${escapeHtml(form.updatedBy || "-")} em ${escapeHtml(toBRDateTime(form.updatedAt) || "-")}.` : "A ficha social sera marcada como concluida ao salvar."}
          </div>
        </div>
      </section>
    `;
  }

  setSocialServiceFormFeedback("");
}

function getSocialServiceFormFieldValue(fieldName = "") {
  return String(document.querySelector(`#modal-social-service-form [data-social-form-field="${fieldName}"]`)?.value || "").trim();
}

function getSocialServiceFormCheckboxValues(groupName = "") {
  return Array.from(document.querySelectorAll(`#modal-social-service-form input[data-social-form-group="${groupName}"]:checked`))
    .map(input => String(input.value || "").trim())
    .filter(Boolean);
}

function collectSocialServiceFormModalData() {
  const familyContacts = Array.from({ length: 3 }, (_, index) => createSocialServiceFormContactState({
    name: getSocialServiceFormFieldValue(`familyContactName${index}`),
    kinship: getSocialServiceFormFieldValue(`familyContactKinship${index}`),
    phone: getSocialServiceFormFieldValue(`familyContactPhone${index}`),
    address: getSocialServiceFormFieldValue(`familyContactAddress${index}`)
  })).filter(item => item.name || item.kinship || item.phone || item.address);

  return createSocialServiceFormState({
    admissionDate: getSocialServiceFormFieldValue("admissionDate"),
    admissionTime: getSocialServiceFormFieldValue("admissionTime"),
    admissionSector: getSocialServiceFormFieldValue("admissionSector"),
    bed: getSocialServiceFormFieldValue("bed"),
    admissionReason: getSocialServiceFormFieldValue("admissionReason"),
    fullName: getSocialServiceFormFieldValue("fullName"),
    socialName: getSocialServiceFormFieldValue("socialName"),
    affiliation: getSocialServiceFormFieldValue("affiliation"),
    birthDate: getSocialServiceFormFieldValue("birthDate"),
    ageLabel: getSocialServiceFormFieldValue("ageLabel"),
    cns: getSocialServiceFormFieldValue("cns"),
    cpf: getSocialServiceFormFieldValue("cpf"),
    raceColor: getSocialServiceFormFieldValue("raceColor"),
    sex: getSocialServiceFormFieldValue("sex"),
    religion: getSocialServiceFormFieldValue("religion"),
    birthplace: getSocialServiceFormFieldValue("birthplace"),
    income: getSocialServiceFormFieldValue("income"),
    occupation: getSocialServiceFormFieldValue("occupation"),
    address: getSocialServiceFormFieldValue("address"),
    hasDisability: getSocialServiceFormFieldValue("hasDisability"),
    disabilityDescription: getSocialServiceFormFieldValue("disabilityDescription"),
    familyContacts,
    maritalStatus: getSocialServiceFormFieldValue("maritalStatus"),
    partnerName: getSocialServiceFormFieldValue("partnerName"),
    educationLevel: getSocialServiceFormFieldValue("educationLevel"),
    benefits: getSocialServiceFormCheckboxValues("benefits"),
    benefitsOther: getSocialServiceFormFieldValue("benefitsOther"),
    previdenciaBond: getSocialServiceFormFieldValue("previdenciaBond"),
    previdenciaNature: getSocialServiceFormFieldValue("previdenciaNature"),
    previdenciaSituation: getSocialServiceFormFieldValue("previdenciaSituation"),
    companionName: getSocialServiceFormFieldValue("companionName"),
    companionPhone: getSocialServiceFormFieldValue("companionPhone"),
    companionKinship: getSocialServiceFormFieldValue("companionKinship"),
    companionAddress: getSocialServiceFormFieldValue("companionAddress"),
    profileTags: getSocialServiceFormCheckboxValues("profileTags"),
    funeralPlan: getSocialServiceFormFieldValue("funeralPlan"),
    familyRelationship: getSocialServiceFormFieldValue("familyRelationship"),
    familyRelationshipNotes: getSocialServiceFormFieldValue("familyRelationshipNotes"),
    socialEvolution: getSocialServiceFormFieldValue("socialEvolution")
  });
}

function openSocialServiceFormModal(patientId) {
  const patient = portariaActivePatients.find(item => String(item?.id || "") === String(patientId)) || null;
  if (!patient) return;
  currentSocialServiceFormPatientId = Number(patient.id) || null;
  renderSocialServiceFormModal(patient);
  document.getElementById("modal-social-service-form")?.showModal();
}

function getSocialServiceRowDraftObservation(patientId) {
  const row = document.querySelector(`#portaria-social-list .portaria-social-row[data-id="${String(patientId || "")}"]`);
  return String(row?.querySelector('[data-field="observation"]')?.value || "").trim();
}

async function saveSocialServiceFormModal() {
  const patientId = Number(currentSocialServiceFormPatientId);
  if (!patientId) return;

  const patient = portariaActivePatients.find(item => Number(item?.id) === patientId) || null;
  if (!patient) return;

  const support = createSocialSupportState(patient.socialSupport);
  const button = document.getElementById("btn-save-social-service-form");
  const admission = patient.currentAdmission || {};
  const wardId = Number(admission.wardId);
  const bedId = Number(admission.bedId);
  const payload = {
    contacts: getSocialServiceContactValue(patient),
    admissionNotes: support.admissionNotes || "",
    socialRecord: "Concluído",
    observation: getSocialServiceRowDraftObservation(patientId) || support.observation || "",
    socialForm: collectSocialServiceFormModalData()
  };

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Salvando...";
    }
    const data = await api(`/api/patients/${patientId}/social-support`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    portariaActivePatients = portariaActivePatients.map(item =>
      Number(item.id) === patientId ? { ...item, ...data.patient } : item
    );
    if (ward && Number(currentWardId) === wardId && bedId && data.patient?.currentAdmission?.serviceSocialRequest) {
      ward.beds = ward.beds.map(item => item.id === bedId
        ? { ...item, serviceSocialRequest: data.patient.currentAdmission.serviceSocialRequest }
        : item);
      renderCounts(computeLocalWardCounts(ward.beds));
      renderBeds(ward.beds);
    }
    renderPortariaSocialList(portariaActivePatients.filter(hasServiceSocialRequest));
    document.getElementById("modal-social-service-form")?.close();
    setPortariaSocialFeedback("Ficha social salva com sucesso.");
  } catch (error) {
    setSocialServiceFormFeedback(error.message || "Nao foi possivel salvar a ficha social.", true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Salvar ficha";
    }
  }
}

function buildSocialServiceFormPrintData(patient = {}, overrideForm = null) {
  const support = createSocialSupportState(patient.socialSupport);
  const sourceForm = overrideForm ? createSocialServiceFormState(overrideForm) : support.socialForm;
  return mergeSocialServiceFormWithPrefill(sourceForm, buildSocialServicePrefilledForm(patient));
}

function printSocialServiceForm(patientId, overrideForm = null) {
  const patient = typeof patientId === "object"
    ? patientId
    : (portariaActivePatients.find(item => String(item?.id || "") === String(patientId)) || null);
  if (!patient) return;

  const support = createSocialSupportState(patient.socialSupport);
  const form = buildSocialServiceFormPrintData(patient, overrideForm);
  const familyContacts = form.familyContacts.length
    ? form.familyContacts.map(contact => `
        <tr>
          <td>${escapeHtml(contact.name || "-")}</td>
          <td>${escapeHtml(contact.kinship || "-")}</td>
          <td>${escapeHtml(contact.phone || "-")}</td>
          <td>${escapeHtml(contact.address || "-")}</td>
        </tr>
      `).join("")
    : `<tr><td>-</td><td>-</td><td>${escapeHtml(getSocialServiceContactValue(patient) || "-")}</td><td>-</td></tr>`;
  const benefitsText = form.benefits.length ? form.benefits.join(", ") : "-";
  const profileText = form.profileTags.length ? form.profileTags.join(", ") : "-";
  const printTitle = `Ficha Social - ${patient?.nome || "Paciente"}`;
  const printUpdatedAt = toBRDateTime(form.updatedAt || support.updatedAt) || "-";
  const printUpdatedBy = form.updatedBy || support.updatedBy || "-";
  const win = window.open("", "_blank", "width=1280,height=920");
  if (!win) return;

  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(printTitle)}</title><style>
    @page { size: A4 portrait; margin: 5mm; }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      forced-color-adjust: none;
    }
    html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; font-family: Arial, sans-serif; }
    body { width: 200mm; }
    .sheet { width: 100%; margin: 0 auto; background: #fff; padding: 4mm 4mm 3mm; border: 1px solid #8ca6c7; }
    .header-code { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.4mm; font-size: 6.1pt; font-weight: 800; color: #17365d; }
    .header { display: grid; grid-template-columns: 34mm minmax(0, 1fr) 42mm; gap: 2mm; align-items: start; border-bottom: 1px solid #7e93ae; padding-bottom: 2mm; }
    .brand { display: grid; grid-template-columns: 12mm minmax(0, 1fr); gap: 2mm; align-items: start; }
    .brand-mark { font-size: 18pt; font-weight: 900; color: #10283d; line-height: 1; }
    .brand-text { font-size: 6.2pt; font-weight: 800; text-align: center; color: #10283d; line-height: 1.15; }
    .title { text-align: center; padding-top: 1mm; }
    .title .line-1 { font-size: 8.5pt; font-weight: 900; color: #10283d; }
    .title .line-2 { font-size: 10pt; font-weight: 900; color: #10283d; margin-top: 1mm; line-height: 1.15; }
    .meta { text-align: right; font-size: 6.8pt; font-weight: 700; color: #10283d; line-height: 1.25; }
    .section { margin-top: 2mm; border: 1px solid #7e93ae; break-inside: avoid; page-break-inside: avoid; }
    .section-title { padding: 1.1mm 1.6mm; background: #dbeafe; font-size: 6.9pt; font-weight: 900; text-transform: uppercase; color: #10283d; border-bottom: 1px solid #7e93ae; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; }
    .field { border-top: 1px solid #7e93ae; border-right: 1px solid #7e93ae; min-height: 11mm; }
    .field:nth-child(4n) { border-right: 0; }
    .field.wide-2 { grid-column: span 2; }
    .field.wide-3 { grid-column: span 3; }
    .field.wide-4 { grid-column: 1 / -1; }
    .field-label { padding: 1mm 1.3mm; font-size: 5.8pt; font-weight: 900; color: #334155; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; background: #f8fbff; line-height: 1.15; }
    .field-value { padding: 1.3mm 1.6mm; font-size: 7pt; line-height: 1.18; min-height: 6mm; white-space: pre-wrap; word-break: break-word; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #7e93ae; padding: 1mm 1.5mm; font-size: 6.4pt; vertical-align: top; line-height: 1.15; }
    th { background: #f8fbff; text-transform: uppercase; font-size: 5.8pt; color: #10283d; }
    .footer-note { margin-top: 1.5mm; text-align: right; font-size: 5.8pt; font-weight: 700; color: #274c77; line-height: 1.15; }
    @media print {
      html, body { background: #fff !important; }
      body { width: auto; }
      .sheet { width: auto; margin: 0; border: 0; padding: 0; }
    }
  </style></head><body>
    <div class="sheet">
      <div class="header-code">
        <div>FORM-SS-003</div>
        <div>Ficha Social - Servico Social</div>
      </div>
      <div class="header">
        <div class="brand">
          <div class="brand-mark">HMA</div>
          <div class="brand-text">HOSPITAL MUNICIPAL DE ACAILANDIA<br>URGENCIA E EMERGENCIA</div>
        </div>
        <div class="title">
          <div class="line-1">UNIDADE: HOSPITAL MUNICIPAL DE ACAILANDIA - HMA</div>
          <div class="line-2">FORM-SS-003 - FICHA SOCIAL (SERVICO SOCIAL)</div>
        </div>
        <div class="meta">
          <div>Paciente: ${escapeHtml(patient?.nome || "-")}</div>
          <div>Setor: ${escapeHtml(patient?.currentAdmission?.wardNome || "-")}</div>
          <div>Leito: ${escapeHtml(String(patient?.currentAdmission?.bedId || "-"))}</div>
        </div>
      </div>

      <section class="section">
        <div class="section-title">Dados da internacao</div>
        <div class="grid">
          <div class="field"><div class="field-label">Admissao</div><div class="field-value">${escapeHtml(toBRDate(form.admissionDate) || "-")}</div></div>
          <div class="field"><div class="field-label">Hora</div><div class="field-value">${escapeHtml(form.admissionTime || "-")}</div></div>
          <div class="field"><div class="field-label">Setor</div><div class="field-value">${escapeHtml(form.admissionSector || patient?.currentAdmission?.wardNome || "-")}</div></div>
          <div class="field"><div class="field-label">Leito</div><div class="field-value">${escapeHtml(form.bed || String(patient?.currentAdmission?.bedId || "-"))}</div></div>
          <div class="field wide-4"><div class="field-label">Motivo da internacao / causa primaria</div><div class="field-value">${escapeHtml(form.admissionReason || "-")}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Paciente - dados pessoais</div>
        <div class="grid">
          <div class="field wide-2"><div class="field-label">Nome completo</div><div class="field-value">${escapeHtml(form.fullName || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Nome social</div><div class="field-value">${escapeHtml(form.socialName || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Filiacao</div><div class="field-value">${escapeHtml(form.affiliation || "-")}</div></div>
          <div class="field"><div class="field-label">Data de nascimento</div><div class="field-value">${escapeHtml(toBRDate(form.birthDate) || "-")}</div></div>
          <div class="field"><div class="field-label">Idade</div><div class="field-value">${escapeHtml(form.ageLabel || "-")}</div></div>
          <div class="field"><div class="field-label">CNS</div><div class="field-value">${escapeHtml(form.cns || "-")}</div></div>
          <div class="field"><div class="field-label">CPF</div><div class="field-value">${escapeHtml(form.cpf || "-")}</div></div>
          <div class="field"><div class="field-label">Raca/Cor</div><div class="field-value">${escapeHtml(form.raceColor || "-")}</div></div>
          <div class="field"><div class="field-label">Sexo</div><div class="field-value">${escapeHtml(form.sex || "-")}</div></div>
          <div class="field"><div class="field-label">Religiao</div><div class="field-value">${escapeHtml(form.religion || "-")}</div></div>
          <div class="field"><div class="field-label">Naturalidade</div><div class="field-value">${escapeHtml(form.birthplace || "-")}</div></div>
          <div class="field"><div class="field-label">Renda</div><div class="field-value">${escapeHtml(form.income || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Profissao / atividade laboral</div><div class="field-value">${escapeHtml(form.occupation || "-")}</div></div>
          <div class="field wide-4"><div class="field-label">Endereco</div><div class="field-value">${escapeHtml(form.address || "-")}</div></div>
          <div class="field"><div class="field-label">Pessoa com deficiencia</div><div class="field-value">${escapeHtml(form.hasDisability || "-")}</div></div>
          <div class="field wide-3"><div class="field-label">Qual?</div><div class="field-value">${escapeHtml(form.disabilityDescription || "-")}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Contatos familiares</div>
        <table>
          <thead><tr><th>Nome</th><th>Parentesco</th><th>Telefone</th><th>Endereco</th></tr></thead>
          <tbody>${familyContacts}</tbody>
        </table>
      </section>

      <section class="section">
        <div class="section-title">Estado civil, escolaridade e beneficios</div>
        <div class="grid">
          <div class="field wide-2"><div class="field-label">Estado civil</div><div class="field-value">${escapeHtml(form.maritalStatus || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Companheiro(a) / conjuge</div><div class="field-value">${escapeHtml(form.partnerName || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Escolaridade</div><div class="field-value">${escapeHtml(form.educationLevel || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Beneficios</div><div class="field-value">${escapeHtml(benefitsText)}</div></div>
          <div class="field wide-4"><div class="field-label">Outros beneficios</div><div class="field-value">${escapeHtml(form.benefitsOther || "-")}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Situacao previdenciaria atual</div>
        <div class="grid">
          <div class="field"><div class="field-label">Vinculo</div><div class="field-value">${escapeHtml(form.previdenciaBond || "-")}</div></div>
          <div class="field wide-2"><div class="field-label">Natureza do vinculo</div><div class="field-value">${escapeHtml(form.previdenciaNature || "-")}</div></div>
          <div class="field"><div class="field-label">Situacao atual</div><div class="field-value">${escapeHtml(form.previdenciaSituation || "-")}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Acompanhante autorizado(a)</div>
        <div class="grid">
          <div class="field wide-2"><div class="field-label">Nome</div><div class="field-value">${escapeHtml(form.companionName || "-")}</div></div>
          <div class="field"><div class="field-label">Telefone</div><div class="field-value">${escapeHtml(form.companionPhone || "-")}</div></div>
          <div class="field"><div class="field-label">Parentesco</div><div class="field-value">${escapeHtml(form.companionKinship || "-")}</div></div>
          <div class="field wide-4"><div class="field-label">Endereco</div><div class="field-value">${escapeHtml(form.companionAddress || "-")}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Perfil do paciente e relacao intrafamiliar</div>
        <div class="grid">
          <div class="field wide-4"><div class="field-label">Perfil do paciente</div><div class="field-value">${escapeHtml(profileText)}</div></div>
          <div class="field"><div class="field-label">Convenio funerario</div><div class="field-value">${escapeHtml(form.funeralPlan || "-")}</div></div>
          <div class="field wide-3"><div class="field-label">Relacao intrafamiliar</div><div class="field-value">${escapeHtml(form.familyRelationship || "-")}</div></div>
          <div class="field wide-4"><div class="field-label">Detalhamento</div><div class="field-value">${escapeHtml(form.familyRelationshipNotes || "-")}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-title">Evolucao social</div>
        <div class="grid">
          <div class="field wide-4"><div class="field-value">${escapeHtml(form.socialEvolution || support.observation || "-")}</div></div>
        </div>
      </section>

      <div class="footer-note">Ficha atualizada por ${escapeHtml(printUpdatedBy)} em ${escapeHtml(printUpdatedAt)}.</div>
      <div class="footer-note">HMA - A servico da vida.</div>
    </div>
    <script>
      window.onload = () => {
        setTimeout(() => {
          window.focus();
          window.print();
        }, 120);
      };
    </script>
  </body></html>`);
  win.document.close();
  win.focus();
}

function normalizeSocialServiceRecordValue(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "Não necessário") return "Pendente";
  if (normalized === "Disponível") return "Concluído";
  return normalized;
}

function getSocialServiceContactValue(patient = {}) {
  const patientPhone = formatPhone(patient?.phone || "");
  if (patientPhone) return patientPhone;
  return String(patient?.socialSupport?.contacts || "").trim();
}

function getServiceSocialRequestedPatients(items) {
  return (Array.isArray(items) ? items : [])
    .filter(hasServiceSocialRequest)
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
}

async function buildServiceSocialQueueFromWards(wardItems = wards) {
  try {
    const patientsData = await api("/api/patients");
    return (patientsData.patients || [])
      .filter(hasServiceSocialRequest)
      .map(patient => ({
        ...patient,
        currentAdmission: patient.currentAdmission || (patient.lastAdmission ? {
          ...patient.lastAdmission,
          active: false,
          serviceSocialRequest: patient.lastAdmission?.serviceSocialRequest || { requested: false }
        } : null),
        socialSupport: createSocialSupportState(patient.socialSupport)
      }))
      .filter(patient => patient.currentAdmission)
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
  } catch {
    return [];
  }
}

function getPsychologyRequestedPatients(items) {
  return (Array.isArray(items) ? items : [])
    .filter(hasPsychologyRequest)
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
}

async function buildPsychologyQueueFromWards(wardItems = wards) {
  try {
    const patientsData = await api("/api/patients");
    return (patientsData.patients || [])
      .filter(hasPsychologyRequest)
      .map(patient => ({
        ...patient,
        currentAdmission: patient.currentAdmission || (patient.lastAdmission ? {
          ...patient.lastAdmission,
          active: false,
          psychologyRequest: patient.lastAdmission?.psychologyRequest || { requested: false }
        } : null),
        psychologySupport: createPsychologySupportState(patient.psychologySupport)
      }))
      .filter(patient => patient.currentAdmission)
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
  } catch {
    return [];
  }
}

function renderPsychologyPatients(items) {
  const patients = Array.isArray(items) ? items : [];
  psychologyActivePatients = patients;
  const container = document.getElementById("psychology-list");
  const empty = document.getElementById("psychology-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", patients.length > 0);
  updatePsychologyCount(patients.length);
  const canEdit = isPsychologyShiftOpen();
  const disabledAttr = canEdit ? "" : "disabled";
  const saveLabel = canEdit ? "Salvar evolução" : "Plantão fechado";
  const blockedTitle = canEdit ? "" : "title=\"Abra o plantao da Psicologia para editar e salvar a evolucao.\"";

  for (const [index, patient] of patients.entries()) {
    const currentAdmission = patient.currentAdmission || {};
    const support = createPsychologySupportState(patient.psychologySupport);
    const requestStatus = support.dischargePending
      ? {
        state: "EM_ACOMPANHAMENTO",
        label: "Em acompanhamento",
        chipClassName: "in-progress",
        badgeClassName: "in-progress",
        meta: getSupportDischargeMeta(support)
      }
      : getPsychologyStatusPresentation(currentAdmission.psychologyRequest);
    const row = document.createElement("tr");
    row.dataset.id = String(patient.id || "");
    row.dataset.queueKey = getPsychologyQueueKey(patient);
    row.dataset.currentStatus = requestStatus.state || "";
    row.dataset.currentMeta = requestStatus.meta || "";
    row.innerHTML = `
      <td>${escapeHtml(String(index + 1).padStart(2, "0"))}</td>
      <td>${escapeHtml(currentAdmission.wardNome || "-")}</td>
      <td>${escapeHtml(String(currentAdmission.bedId || "-"))}</td>
      <td>${escapeHtml(patient.nome || "-")}</td>
      <td>${escapeHtml(getPatientAgeLabel(patient.birthDate) || "Nao informada")}</td>
      <td>${escapeHtml(toBRDate(currentAdmission.admittedAt) || "-")}</td>
      <td class="psychology-table-status-cell">
        <select class="psychology-status-select ${escapeHtml(requestStatus.badgeClassName)}" data-field="psychology-status" ${disabledAttr}>
          <option value="SOLICITADO" ${requestStatus.state === "SOLICITADO" ? "selected" : ""}>Solicitado</option>
          <option value="EM_ACOMPANHAMENTO" ${requestStatus.state === "EM_ACOMPANHAMENTO" ? "selected" : ""}>Em acompanhamento</option>
          <option value="BAIXA" ${requestStatus.state === "BAIXA" ? "selected" : ""}>Alta do atendimento</option>
        </select>
        <div class="psychology-status-meta">${escapeHtml(requestStatus.meta || "-")}</div>
      </td>
      <td class="psychology-table-editor-cell">
        <textarea data-field="interventions" rows="6" placeholder="Escreva livremente as intervenções psicológicas" ${disabledAttr}>${escapeHtml(support.interventions || "")}</textarea>
      </td>
      <td class="psychology-table-editor-cell">
        <textarea data-field="observation" rows="6" placeholder="Escreva livremente as observações" ${disabledAttr}>${escapeHtml(support.observation || "")}</textarea>
        ${support.dischargePending ? `<div class="psychology-status-meta">${escapeHtml(getSupportDischargeMeta(support))}</div>` : ""}
      </td>
      <td class="psychology-table-action-cell">
        <button type="button" class="btn-save-psychology-record" data-id="${escapeHtml(String(patient.id || ""))}" ${disabledAttr} ${blockedTitle}>${saveLabel}</button>
        <div class="psychology-table-updated">${support.updatedAt ? `Atualizado por ${escapeHtml(support.updatedBy || "-")} em ${escapeHtml(toBRDateTime(support.updatedAt) || "-")}` : "Sem evolução salva ainda."}</div>
      </td>
    `;
    container.appendChild(row);
  }

  syncPsychologyEditingAvailability();
}

function isPsychologyShiftOpen() {
  return String(currentUser?.activeShift?.serviceType || "").trim().toUpperCase() === "PSICOLOGIA";
}

function syncPsychologyEditingAvailability() {
  const canEdit = isPsychologyShiftOpen();
  const rows = document.querySelectorAll("#psychology-list tr");
  for (const row of rows) {
    row.querySelector('[data-field="psychology-status"]')?.toggleAttribute("disabled", !canEdit);
    row.querySelector('[data-field="interventions"]')?.toggleAttribute("disabled", !canEdit);
    row.querySelector('[data-field="observation"]')?.toggleAttribute("disabled", !canEdit);
    const button = row.querySelector(".btn-save-psychology-record");
    if (button) {
      button.toggleAttribute("disabled", !canEdit);
      button.textContent = canEdit ? "Salvar evolução" : "Plantão fechado";
      button.title = canEdit ? "" : "Abra o plantao da Psicologia para editar e salvar a evolucao.";
    }
  }
}

function applyPsychologyStatusSelectVisual(select, status) {
  if (!select) return;
  select.classList.remove("requested", "in-progress", "done", "none");
  const presentation = getPsychologyStatusPresentation({ status });
  if (presentation.badgeClassName) {
    select.classList.add(presentation.badgeClassName);
  }
}

function syncPsychologyStatusDraft(card) {
  if (!card) return;
  const select = card.querySelector('[data-field="psychology-status"]');
  const meta = card.querySelector(".psychology-status-meta");
  if (!select || !meta) return;

  const selectedStatus = String(select.value || "").trim().toUpperCase();
  const currentStatus = String(card.dataset.currentStatus || "").trim().toUpperCase();
  applyPsychologyStatusSelectVisual(select, selectedStatus);

  if (selectedStatus && selectedStatus !== currentStatus) {
    meta.textContent = "Alteracao pendente. Clique em Salvar evolução.";
    return;
  }

  meta.textContent = card.dataset.currentMeta || "-";
}

function buildPsychologyRequestPayload(current = {}, nextStatus = "", supportPayload = {}) {
  const normalizedStatus = String(nextStatus || "").trim().toUpperCase();
  const actorName = currentUser?.nome || currentUser?.username || "";
  const observation = String(supportPayload?.observation || current?.observation || "").trim();

  if (normalizedStatus === "SOLICITADO") {
    return {
      ...current,
      requested: true,
      requestedAt: current.requestedAt || new Date().toISOString(),
      requestedBy: current.requestedBy || actorName,
      viewedAt: "",
      viewedBy: "",
      startedAt: "",
      startedBy: "",
      closedAt: "",
      closedBy: "",
      observation: "",
      status: "SOLICITADO"
    };
  }

  if (normalizedStatus === "EM_ACOMPANHAMENTO") {
    return {
      ...current,
      requested: true,
      requestedAt: current.requestedAt || new Date().toISOString(),
      requestedBy: current.requestedBy || actorName,
      startedAt: current.startedAt || new Date().toISOString(),
      startedBy: current.startedBy || actorName,
      viewedAt: current.viewedAt || new Date().toISOString(),
      viewedBy: current.viewedBy || actorName,
      closedAt: "",
      closedBy: "",
      observation,
      status: "EM_ACOMPANHAMENTO"
    };
  }

  if (normalizedStatus === "BAIXA") {
    return {
      ...current,
      requested: false,
      closedAt: new Date().toISOString(),
      closedBy: actorName,
      observation,
      status: "BAIXA"
    };
  }

  return null;
}

function renderPsychologyManualRequests(items) {
  psychologyManualEntries = Array.isArray(items) ? items : [];
  const container = document.getElementById("psychology-manual-list");
  const empty = document.getElementById("psychology-manual-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", psychologyManualEntries.length > 0);
  updatePsychologyManualCount(psychologyManualEntries.length);

  for (const entry of psychologyManualEntries) {
    const card = document.createElement("div");
    card.className = "portaria-registry-card";
    card.innerHTML = `
      <strong>${escapeHtml(entry.patientName || "-")}</strong>
      <span>Setor ou motivo: ${escapeHtml(entry.sectorOrReason || "-")}</span>
      ${entry.notes ? `<span>Observacao: ${escapeHtml(entry.notes)}</span>` : ""}
      <span>Status: ${escapeHtml(getPsychologyStatusPresentation({ status: entry.status || "SOLICITADO" }).label || "Solicitado")}</span>
      ${entry.updatedAt ? `<span>Atualizado por ${escapeHtml(entry.updatedBy || "-")} em ${escapeHtml(toBRDateTime(entry.updatedAt) || "-")}</span>` : ""}
      <span>Registrado por ${escapeHtml(entry.createdBy || "-")} em ${escapeHtml(toBRDateTime(entry.createdAt) || "-")}</span>
    `;
    container.appendChild(card);
  }
}

function setPsychologyActiveTab(tab = "queue") {
  currentPsychologyTab = tab === "monthly" ? "monthly" : "queue";
  document.getElementById("btn-psychology-tab-queue")?.classList.toggle("active", currentPsychologyTab === "queue");
  document.getElementById("btn-psychology-tab-monthly")?.classList.toggle("active", currentPsychologyTab === "monthly");
  document.getElementById("psychology-tab-queue-panel")?.classList.toggle("hidden", currentPsychologyTab !== "queue");
  document.getElementById("psychology-tab-monthly-panel")?.classList.toggle("hidden", currentPsychologyTab !== "monthly");
}

function renderPsychologyAttendanceTable(items, options = {}) {
  const attendances = Array.isArray(items) ? items : [];
  const {
    bodyId,
    emptyId,
    countUpdater
  } = options;
  const container = document.getElementById(bodyId);
  const empty = document.getElementById(emptyId);
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", attendances.length > 0);
  if (typeof countUpdater === "function") countUpdater(attendances.length);

  for (const entry of attendances) {
    const statusPresentation = getPsychologyStatusPresentation({ status: entry.status });
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(entry.createdBy || "-")}</td>
      <td>${escapeHtml(toBRDateTime(entry.createdAt) || "-")}</td>
      <td>${escapeHtml(entry.wardName || "-")}</td>
      <td>${escapeHtml(String(entry.bedId || "-"))}</td>
      <td>${escapeHtml(entry.patientName || "-")}</td>
      <td>${escapeHtml(statusPresentation.state ? statusPresentation.label : "-")}</td>
      <td>${escapeHtml(entry.interventions || "-")}</td>
      <td>${escapeHtml(entry.observation || "-")}</td>
    `;
    container.appendChild(row);
  }
}

function renderPsychologyMonthlyAttendances(items) {
  psychologyMonthlyEntries = Array.isArray(items) ? items : [];
  renderPsychologyAttendanceTable(psychologyMonthlyEntries, {
    bodyId: "psychology-monthly-list",
    emptyId: "psychology-monthly-empty",
    countUpdater: updatePsychologyMonthlyCount
  });
}

function renderPsychologyRecentAttendances(items) {
  renderPsychologyAttendanceTable(items, {
    bodyId: "psychology-recent-list",
    emptyId: "psychology-recent-empty",
    countUpdater: updatePsychologyRecentCount
  });
}

async function loadPsychologyRecentAttendances() {
  try {
    const data = await api("/api/psychology/attendances?month=all");
    renderPsychologyRecentAttendances(data.attendances || []);
  } catch {
    renderPsychologyRecentAttendances([]);
  }
}

async function loadPsychologyMonthlyAttendances(options = {}) {
  const { silent = false } = options;
  const monthInput = document.getElementById("psychology-monthly-filter");
  const monthValue = String(monthInput?.value || getCurrentMonthValue()).trim();
  if (monthInput && !monthInput.value) monthInput.value = monthValue;

  try {
    let data = await api(`/api/psychology/attendances?month=${encodeURIComponent(monthValue)}`);
    let items = data.attendances || [];
    let usedFallbackAll = false;

    if (!items.length) {
      const fallbackData = await api("/api/psychology/attendances?month=all");
      if ((fallbackData.attendances || []).length) {
        data = fallbackData;
        items = fallbackData.attendances || [];
        usedFallbackAll = true;
      }
    }

    renderPsychologyMonthlyAttendances(items);
    if (!silent) {
      setPsychologyMonthlyFeedback(items.length
        ? (usedFallbackAll
          ? "Nao houve atendimento neste mês selecionado. Mostrando todos os atendimentos registrados."
          : "Atendimentos da Psicologia carregados com sucesso.")
        : "Nenhum atendimento da Psicologia encontrado neste mês.");
    } else {
      setPsychologyMonthlyFeedback("");
    }
  } catch (error) {
    renderPsychologyMonthlyAttendances([]);
    setPsychologyMonthlyFeedback(error.message || "Nao foi possivel carregar os atendimentos do mês da Psicologia.", true);
  }
}

function setSocialServiceActiveTab(tab = "queue") {
  currentSocialServiceTab = ["history", "age"].includes(tab) ? tab : "queue";
  document.getElementById("btn-social-service-tab-queue")?.classList.toggle("active", currentSocialServiceTab === "queue");
  document.getElementById("btn-social-service-tab-history")?.classList.toggle("active", currentSocialServiceTab === "history");
  document.getElementById("btn-social-service-tab-age")?.classList.toggle("active", currentSocialServiceTab === "age");
  document.getElementById("social-service-tab-queue-panel")?.classList.toggle("hidden", currentSocialServiceTab !== "queue");
  document.getElementById("social-service-tab-history-panel")?.classList.toggle("hidden", currentSocialServiceTab !== "history");
  document.getElementById("social-service-tab-age-panel")?.classList.toggle("hidden", currentSocialServiceTab !== "age");
}

function getSocialServiceHistoryProfessionalSearchValue() {
  return normalizePersonName(document.getElementById("social-service-history-professional-search")?.value || "");
}

function getSocialServiceHistoryPatientSearchValue() {
  return normalizePersonName(document.getElementById("social-service-history-patient-search")?.value || "");
}

function populateSocialServiceHistoryFilterOptions(items) {
  const professionalList = document.getElementById("social-service-history-professional-options");
  const patientList = document.getElementById("social-service-history-patient-options");
  if (!professionalList || !patientList) return;

  const professionals = Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map(entry => String(entry?.closedBy || "").trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const patients = Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map(entry => String(entry?.patientName || "").trim())
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "pt-BR"));

  professionalList.innerHTML = professionals.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
  patientList.innerHTML = patients.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function filterSocialServiceAttendanceEntries(items, filters = {}) {
  const professionalSearch = normalizePersonName(filters?.professional || "");
  const patientSearch = normalizePersonName(filters?.patient || "");
  return (Array.isArray(items) ? items : []).filter(entry => {
    const matchesProfessional = !professionalSearch
      || normalizePersonName(entry?.closedBy || "").includes(professionalSearch);
    const matchesPatient = !patientSearch
      || normalizePersonName(entry?.patientName || "").includes(patientSearch);
    return matchesProfessional && matchesPatient;
  });
}

function renderSocialServiceAttendances(items) {
  socialServiceAttendanceSourceEntries = Array.isArray(items) ? items : [];
  populateSocialServiceHistoryFilterOptions(socialServiceAttendanceSourceEntries);
  socialServiceAttendanceEntries = filterSocialServiceAttendanceEntries(
    socialServiceAttendanceSourceEntries,
    {
      professional: document.getElementById("social-service-history-professional-search")?.value || "",
      patient: document.getElementById("social-service-history-patient-search")?.value || ""
    }
  );
  const container = document.getElementById("social-service-history-list");
  const empty = document.getElementById("social-service-history-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", socialServiceAttendanceEntries.length > 0);
  empty.textContent = (getSocialServiceHistoryProfessionalSearchValue() || getSocialServiceHistoryPatientSearchValue())
    ? "Nenhum registro encontrado para os filtros aplicados no mês pesquisado."
    : "Nenhuma observação do Serviço Social encontrada neste mês.";
  updateSocialServiceHistoryCount(socialServiceAttendanceEntries.length);

  for (const entry of socialServiceAttendanceEntries) {
    const entryLabel = String(entry?.entryLabel || "").trim()
      || (String(entry?.entryType || "").trim() === "observacao_plantao" ? "Observação do plantão" : "Baixa do atendimento");
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(entry.closedBy || "-")}</td>
      <td>${escapeHtml(toBRDateTime(entry.closedAt) || "-")}</td>
      <td>${escapeHtml(entryLabel)}<br><span class="social-service-history-meta">${escapeHtml(toBRDate(entry.shiftDate) || "-")}</span></td>
      <td>${escapeHtml(entry.wardName || "-")}</td>
      <td>${escapeHtml(String(entry.bedId || "-"))}</td>
      <td>${escapeHtml(entry.patientName || "-")}</td>
      <td>${escapeHtml(entry.contacts || "-")}</td>
      <td>${escapeHtml(entry.socialRecord || "-")}</td>
      <td class="social-service-history-observation-cell">${escapeHtml(entry.observation || "-")}</td>
      <td class="social-service-history-actions-cell">
        <button type="button" class="ghost btn-delete-social-service-attendance" data-id="${escapeHtml(entry.id || "")}">Apagar</button>
      </td>
    `;
    container.appendChild(row);
  }
}

async function deleteSocialServiceAttendanceEntry(entryId) {
  const normalizedEntryId = String(entryId || "").trim();
  if (!normalizedEntryId) return;
  if (!confirm("Apagar este registro do histórico do Serviço Social?")) return;

  const coordinatorPassword = prompt("Digite a senha do coordenador Fernando Augusto para apagar este registro:");
  if (coordinatorPassword === null) return;

  try {
    await api(`/api/social-service/attendances/${encodeURIComponent(normalizedEntryId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinatorPassword })
    });
    await loadSocialServiceAttendances({ filterId: "social-service-history-filter" });
    setSocialServiceFeedback("Registro do Serviço Social apagado com sucesso.");
  } catch (error) {
    setSocialServiceFeedback(error.message || "Nao foi possivel apagar o registro do Serviço Social.", true);
  }
}

function renderSocialServiceAgeCounts(items) {
  const container = document.getElementById("social-service-age-list");
  if (!container) return;

  const totalsByAge = new Map();
  for (let age = 0; age <= 105; age += 1) {
    totalsByAge.set(age, 0);
  }

  let totalAttendances = 0;
  for (const entry of Array.isArray(items) ? items : []) {
    const age = getPatientAgeNumber(entry?.patientBirthDate || "", entry?.closedAt || entry?.shiftDate || "")
      ?? getPatientAgeNumberFromLabel(entry?.patientAgeLabel || "");
    if (age === null || age < 0 || age > 105) continue;
    totalsByAge.set(age, (totalsByAge.get(age) || 0) + 1);
    totalAttendances += 1;
  }

  container.innerHTML = "";
  for (let age = 0; age <= 105; age += 1) {
    const totalByAge = totalsByAge.get(age) || 0;
    if (!totalByAge) continue;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(age === 1 ? "1 ano" : `${age} anos`)}</td>
      <td>${escapeHtml(String(totalByAge))}</td>
    `;
    container.appendChild(row);
  }

  updateSocialServiceAgeCount(totalAttendances);
}

function getSocialServiceFilterValue(preferredId) {
  const ids = [preferredId, "social-service-history-filter", "social-service-age-filter"].filter(Boolean);
  for (const id of ids) {
    const input = document.getElementById(id);
    const value = String(input?.value || "").trim();
    if (value) {
      syncSocialServiceFilterValues(value);
      return value;
    }
  }
  const fallback = getCurrentMonthValue();
  syncSocialServiceFilterValues(fallback);
  return fallback;
}

function syncSocialServiceFilterValues(value = "") {
  for (const id of ["social-service-history-filter", "social-service-age-filter"]) {
    const input = document.getElementById(id);
    if (input) input.value = value;
  }
}

async function loadSocialServiceAttendances(options = {}) {
  const { silent = false, filterId = "social-service-history-filter" } = options;
  const monthValue = getSocialServiceFilterValue(filterId);

  try {
    const data = await api(`/api/social-service/attendances?month=${encodeURIComponent(monthValue)}`);
    const items = data.attendances || [];

    renderSocialServiceAttendances(items);
    renderSocialServiceAgeCounts(items);
    if (!silent) {
      setSocialServiceFeedback(items.length
        ? `Pesquisa do Serviço Social carregada para ${monthValue}.`
        : `Nenhum registro do Serviço Social encontrado em ${monthValue}.`);
    }
  } catch (error) {
    renderSocialServiceAttendances([]);
    renderSocialServiceAgeCounts([]);
    if (!silent) {
      setSocialServiceFeedback(error.message || "Nao foi possivel carregar o histórico de observações do Serviço Social.", true);
    }
  }
}

function matchesSocialServiceHistoryEntry(patient = {}, entry = {}) {
  const patientId = Number(patient?.id) || 0;
  const entryPatientId = Number(entry?.patientId) || 0;
  if (patientId && entryPatientId && patientId === entryPatientId) return true;

  const patientName = normalizePersonName(patient?.nome || "");
  const entryName = normalizePersonName(entry?.patientName || "");
  if (!patientName || !entryName || patientName !== entryName) return false;

  const currentWardId = Number(patient?.currentAdmission?.wardId) || 0;
  const entryWardId = Number(entry?.wardId) || 0;
  const currentBedId = Number(patient?.currentAdmission?.bedId) || 0;
  const entryBedId = Number(entry?.bedId) || 0;
  if (currentWardId && entryWardId && currentWardId !== entryWardId) return false;
  if (currentBedId && entryBedId && currentBedId !== entryBedId) return false;
  return true;
}

function renderSocialServicePatientHistory(items) {
  const container = document.getElementById("social-service-patient-history-list");
  const empty = document.getElementById("social-service-patient-history-empty");
  if (!container || !empty) return;

  const history = Array.isArray(items) ? items : [];
  container.innerHTML = "";
  empty.classList.toggle("hidden", history.length > 0);

  for (const entry of history) {
    const entryLabel = String(entry?.entryLabel || "").trim()
      || (String(entry?.entryType || "").trim() === "observacao_plantao" ? "Observação do plantão" : "Baixa do atendimento");
    const card = document.createElement("div");
    card.className = "patient-history-card social-service-patient-history-card";
    card.innerHTML = `
      <strong>${escapeHtml(entryLabel)}</strong>
      <span>Registrado por ${escapeHtml(entry.closedBy || "-")} em ${escapeHtml(toBRDateTime(entry.closedAt) || "-")}</span>
      <span>Setor ${escapeHtml(entry.wardName || "-")} • Leito ${escapeHtml(String(entry.bedId || "-"))} • Ficha ${escapeHtml(entry.socialRecord || "-")}</span>
      <span class="social-service-patient-history-text">${escapeHtml(entry.observation || "Sem observação registrada.")}</span>
    `;
    container.appendChild(card);
  }
}

async function openSocialServicePatientHistory(patientId) {
  const patientKey = String(patientId || "");
  const patient = portariaActivePatients.find(item => String(item?.id || "") === patientKey) || null;
  if (!patient) return;

  const title = document.getElementById("social-service-patient-history-title");
  if (title) {
    title.textContent = `Histórico do Serviço Social - ${patient.nome || "Paciente"}`;
  }

  try {
    const data = await api("/api/social-service/attendances?month=all");
    const items = (data.attendances || []).filter(entry => matchesSocialServiceHistoryEntry(patient, entry));
    renderSocialServicePatientHistory(items);
    document.getElementById("modal-social-service-patient-history")?.showModal();
  } catch (error) {
    renderSocialServicePatientHistory([]);
    setPortariaSocialFeedback(error.message || "Nao foi possivel carregar o histórico deste paciente.", true);
  }
}

async function loadPsychologyManualRequests() {
  try {
    const data = await api("/api/psychology/requests/manual");
    renderPsychologyManualRequests(data.requests || []);
    setPsychologyManualFeedback("");
  } catch (error) {
    renderPsychologyManualRequests([]);
    setPsychologyManualFeedback(error.message || "Nao foi possivel carregar as solicitacoes avulsas.", true);
  }
}

async function savePsychologyManualRequest() {
  const payload = {
    patientName: document.getElementById("psychology-manual-patient-name")?.value.trim() || "",
    sectorOrReason: document.getElementById("psychology-manual-sector-reason")?.value.trim() || "",
    notes: document.getElementById("psychology-manual-notes")?.value.trim() || ""
  };

  try {
    const data = await api("/api/psychology/requests/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    renderPsychologyManualRequests([data.request, ...psychologyManualEntries].filter(Boolean));
    await refreshPsychologyQueueView();
    document.getElementById("psychology-manual-patient-name").value = "";
    document.getElementById("psychology-manual-sector-reason").value = "";
    document.getElementById("psychology-manual-notes").value = "";
    setPsychologyManualFeedback("Solicitacao avulsa cadastrada com sucesso.");
  } catch (error) {
    setPsychologyManualFeedback(error.message || "Nao foi possivel cadastrar a solicitacao avulsa.", true);
  }
}

async function savePsychologyRecord(patientId, card) {
  if (!card) return;
  if (!isPsychologyShiftOpen()) {
    setPsychologyFeedback("Abra o plantao da Psicologia para editar e salvar a evolucao.", true);
    return;
  }

  const button = card.querySelector(".btn-save-psychology-record");
  const queueKey = String(card.dataset.queueKey || "").trim();
  const patient = psychologyActivePatients.find(item => getPsychologyQueueKey(item) === queueKey);
  if (!patient) {
    setPsychologyFeedback("Nao foi possivel localizar este acompanhamento para salvar a evolucao.", true);
    return;
  }
  const isManualRequest = Boolean(patient.isManualRequest);
  const numericId = Number(patient.id);
  const admission = patient?.currentAdmission || {};
  const wardId = Number(admission.wardId);
  const bedId = Number(admission.bedId);
  const currentRequest = admission.psychologyRequest || {};
  const selectedStatus = String(card.querySelector('[data-field="psychology-status"]')?.value || "").trim().toUpperCase();
  const currentStatus = getPsychologyRequestState(currentRequest);
  const payload = {
    interventions: card.querySelector('[data-field="interventions"]')?.value.trim() || "",
    observation: card.querySelector('[data-field="observation"]')?.value.trim() || "",
    status: selectedStatus || currentStatus || ""
  };

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Salvando...";
    }
    if (isManualRequest) {
      await api(`/api/psychology/requests/manual/${encodeURIComponent(String(patient.manualRequestId || ""))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await loadPsychologyManualRequests();
      await refreshPsychologyQueueView();
      await loadPsychologyRecentAttendances();
      await loadPsychologyMonthlyAttendances({ silent: true });
      setPsychologyFeedback(selectedStatus === "BAIXA"
        ? "Solicitacao avulsa da Psicologia finalizada com sucesso."
        : "Acompanhamento avulso da Psicologia salvo com sucesso.");
      return;
    }

    if (!numericId) {
      setPsychologyFeedback("Nao foi possivel localizar o cadastro deste paciente para salvar a evolucao.", true);
      return;
    }
    const data = await api(`/api/patients/${numericId}/psychology-support`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let nextPatients = psychologyActivePatients.map(item =>
      Number(item.id) === numericId ? { ...item, ...data.patient } : item
    );
    if (ward && Number(currentWardId) === wardId && bedId && data.patient?.currentAdmission?.psychologyRequest) {
      ward.beds = ward.beds.map(item => item.id === bedId
        ? { ...item, psychologyRequest: data.patient.currentAdmission.psychologyRequest }
        : item);
      renderCounts(computeLocalWardCounts(ward.beds));
      renderBeds(ward.beds);
    }

    if (selectedStatus && selectedStatus !== currentStatus && wardId && bedId) {
      try {
        const nextRequest = buildPsychologyRequestPayload(currentRequest, selectedStatus, payload);
        const requestData = await api(`/api/wards/${wardId}/beds/${bedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psychologyRequest: nextRequest })
        });

        if (selectedStatus === "BAIXA") {
          nextPatients = nextPatients.filter(item => getPsychologyQueueKey(item) !== queueKey);
          setPsychologyFeedback("Evolucao salva e alta do atendimento aplicada com sucesso.");
        } else {
          nextPatients = nextPatients.map(item =>
            getPsychologyQueueKey(item) === queueKey
              ? {
                  ...item,
                  currentAdmission: {
                    ...(item.currentAdmission || {}),
                    psychologyRequest: requestData?.bed?.psychologyRequest || nextRequest
                  }
                }
              : item
          );
          setPsychologyFeedback("Evolucao e status da Psicologia salvos com sucesso.");
        }

        if (ward && Number(currentWardId) === wardId && requestData?.bed) {
          ward.beds = ward.beds.map(item => item.id === bedId ? requestData.bed : item);
          renderCounts(computeLocalWardCounts(ward.beds));
          renderBeds(ward.beds);
        }
      } catch (statusError) {
        psychologyActivePatients = nextPatients;
        renderPsychologyPatients(psychologyActivePatients);
        await loadPsychologyRecentAttendances();
        await loadPsychologyMonthlyAttendances({ silent: true });
        setPsychologyFeedback(statusError.message || "Evolucao salva, mas nao foi possivel aplicar o status da Psicologia.", true);
        return;
      }
    } else {
      setPsychologyFeedback("Evolucao psicologica salva com sucesso.");
    }

    psychologyActivePatients = nextPatients;
    renderPsychologyPatients(psychologyActivePatients);
    await loadPsychologyRecentAttendances();
    await loadPsychologyMonthlyAttendances({ silent: true });
  } catch (error) {
    setPsychologyFeedback(error.message || "Nao foi possivel salvar a evolucao psicologica.", true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Salvar evolução";
    }
  }
}

function collectPsychologyTableDrafts() {
  const rows = Array.from(document.querySelectorAll("#psychology-list tr"));
  return rows.map(row => {
    const button = row.querySelector(".btn-save-psychology-record");
    return {
      patientId: Number(button?.dataset?.id),
      queueKey: String(row.dataset.queueKey || "").trim(),
      currentStatus: String(row.dataset.currentStatus || "").trim().toUpperCase(),
      selectedStatus: String(row.querySelector('[data-field="psychology-status"]')?.value || "").trim().toUpperCase(),
      interventions: row.querySelector('[data-field="interventions"]')?.value.trim() || "",
      observation: row.querySelector('[data-field="observation"]')?.value.trim() || ""
    };
  }).filter(item => Number.isInteger(item.patientId) && item.patientId > 0);
}

async function saveAllPsychologyRecords(options = {}) {
  const { silent = false } = options;
  if (!isPsychologyShiftOpen()) {
    if (!silent) {
      setPsychologyFeedback("Abra o plantao da Psicologia para editar e salvar a evolucao.", true);
    }
    return 0;
  }
  const drafts = collectPsychologyTableDrafts();
  if (!drafts.length) return 0;

  const updatedPatients = new Map(
    psychologyActivePatients
      .filter(patient => Number.isInteger(Number(patient?.id)))
      .map(patient => [Number(patient.id), patient])
  );
  const removedQueueKeys = new Set();

  let savedCount = 0;
  for (const draft of drafts) {
    const data = await api(`/api/patients/${draft.patientId}/psychology-support`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interventions: draft.interventions,
        observation: draft.observation,
        status: draft.selectedStatus || draft.currentStatus || ""
      })
    });
    if (data?.patient) {
      updatedPatients.set(draft.patientId, { ...updatedPatients.get(draft.patientId), ...data.patient });
      const updatedAdmission = data.patient.currentAdmission || {};
      const updatedWardId = Number(updatedAdmission.wardId);
      const updatedBedId = Number(updatedAdmission.bedId);
      if (ward && Number(currentWardId) === updatedWardId && updatedBedId && updatedAdmission.psychologyRequest) {
        ward.beds = ward.beds.map(item => item.id === updatedBedId
          ? { ...item, psychologyRequest: updatedAdmission.psychologyRequest }
          : item);
      }
    }

    if (draft.selectedStatus && draft.selectedStatus !== draft.currentStatus) {
      const patient = updatedPatients.get(draft.patientId);
      const admission = patient?.currentAdmission || {};
      const wardId = Number(admission.wardId);
      const bedId = Number(admission.bedId);
      const currentRequest = admission.psychologyRequest || {};
      if (wardId && bedId) {
        const nextRequest = buildPsychologyRequestPayload(currentRequest, draft.selectedStatus, {
          observation: draft.observation
        });
        const requestData = await api(`/api/wards/${wardId}/beds/${bedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psychologyRequest: nextRequest })
        });

        if (draft.selectedStatus === "BAIXA") {
          removedQueueKeys.add(draft.queueKey);
        } else {
          updatedPatients.set(draft.patientId, {
            ...patient,
            currentAdmission: {
              ...(patient?.currentAdmission || {}),
              psychologyRequest: requestData?.bed?.psychologyRequest || nextRequest
            }
          });
        }

        if (ward && Number(currentWardId) === wardId && requestData?.bed) {
          ward.beds = ward.beds.map(item => item.id === bedId ? requestData.bed : item);
        }
      }
    }

    savedCount += 1;
  }

  psychologyActivePatients = psychologyActivePatients.map(patient => {
    const numericId = Number(patient?.id);
    return updatedPatients.has(numericId) ? updatedPatients.get(numericId) : patient;
  }).filter(patient => !removedQueueKeys.has(getPsychologyQueueKey(patient)));
  renderPsychologyPatients(psychologyActivePatients);
  await loadPsychologyRecentAttendances();
  await loadPsychologyMonthlyAttendances({ silent: true });
  if (ward) {
    renderCounts(computeLocalWardCounts(ward.beds));
    renderBeds(ward.beds);
  }

  if (!silent) {
    setPsychologyFeedback("Evolucoes psicologicas salvas com sucesso.");
  }

  return savedCount;
}

function renderPortariaSocialList(items) {
  const renderStartedAt = performance.now();
  const patients = Array.isArray(items) ? items : [];
  const container = document.getElementById("portaria-social-list");
  const empty = document.getElementById("portaria-social-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", patients.length > 0);
  updatePortariaSocialCount(patients.length);

  for (const patient of patients) {
    const socialSupport = createSocialSupportState(patient.socialSupport);
    const serviceSocialStatus = socialSupport.dischargePending
      ? {
        label: "Em acompanhamento",
        className: "in-progress",
        meta: getSupportDischargeMeta(socialSupport)
      }
      : getBedRequestStatus(patient.currentAdmission?.serviceSocialRequest || {}, "serviceSocialRequest");
    const hasSocialForm = hasSocialServiceFormContent(socialSupport.socialForm);
    const normalizedSocialRecordValue = hasSocialForm ? "Concluído" : (socialSupport.socialRecord || "Pendente");
    const patientPhone = formatPhone(patient.phone || "");
    const hasPatientPhone = Boolean(patientPhone);
    const contactValue = getSocialServiceContactValue(patient);
    const canSave = Number.isInteger(Number(patient?.id)) && Number(patient.id) > 0;
    const socialRecordMeta = normalizedSocialRecordValue === "Concluído" && socialSupport.socialRecordUpdatedAt
      ? `Concluído por ${escapeHtml(socialSupport.socialRecordUpdatedBy || "-")} em ${escapeHtml(toBRDateTime(socialSupport.socialRecordUpdatedAt) || "-")}`
      : "";
    const dischargeMeta = getSupportDischargeMeta(socialSupport);
    const socialFormMeta = hasSocialForm && socialSupport.socialForm?.filledAt
      ? `Ficha preenchida por ${escapeHtml(socialSupport.socialForm.filledBy || "-")} em ${escapeHtml(toBRDateTime(socialSupport.socialForm.filledAt) || "-")}`
      : "";
    const row = document.createElement("tr");
    row.className = "portaria-social-row";
    row.dataset.id = String(patient.id || "");
    row.innerHTML = `
      <td class="social-service-leito-cell">${escapeHtml(String(patient.currentAdmission?.bedId || "-"))}</td>
      <td class="social-service-patient-cell">
        <strong>${escapeHtml(patient.nome || "-")}</strong>
        <span>${escapeHtml(patient.currentAdmission?.wardNome || "-")}</span>
      </td>
      <td class="social-service-age-cell">${escapeHtml(getPatientAgeLabel(patient.birthDate) || "-")}</td>
      <td class="social-service-editor-cell">
        ${hasPatientPhone
          ? `<div class="social-service-contact-display">${escapeHtml(contactValue)}</div>`
          : `<textarea data-field="contacts" rows="3" placeholder="Telefone do cadastro do paciente" disabled>${escapeHtml(contactValue)}</textarea>`
        }
        ${hasPatientPhone ? "" : `<div class="social-service-contact-hint error-text">Paciente sem telefone cadastrado.</div>`}
        ${hasPatientPhone ? "" : `<button type="button" class="ghost btn-open-social-patient-registry" data-id="${escapeHtml(String(patient.id || ""))}">Cadastrar telefone</button>`}
      </td>
      <td class="social-service-admission-cell">${escapeHtml(toBRDate(patient.currentAdmission?.admittedAt) || "-")}</td>
      <td class="social-service-editor-cell social-service-form-cell">
        <div class="social-service-status-badge ${getSocialServiceFormBadgeClass(normalizedSocialRecordValue)}">${escapeHtml(normalizedSocialRecordValue)}</div>
        ${socialRecordMeta ? `<div class="social-service-status-meta">${socialRecordMeta}</div>` : ""}
        ${socialFormMeta ? `<div class="social-service-form-filled-meta">${socialFormMeta}</div>` : ""}
        <div class="social-service-status-meta">Atendimento: <span class="bed-request-chip ${escapeHtml(serviceSocialStatus.className || "none")}">${escapeHtml(serviceSocialStatus.label || "Solicitar")}</span></div>
        <div class="social-service-status-meta">${escapeHtml(serviceSocialStatus.meta || "Clique para registrar")}</div>
        <div class="social-service-form-actions">
          <button type="button" class="ghost btn-open-social-form" data-id="${escapeHtml(String(patient.id || ""))}" ${canSave ? "" : "disabled"}>${hasSocialForm ? "Editar ficha" : "Preencher ficha"}</button>
          <button type="button" class="ghost btn-print-social-form" data-id="${escapeHtml(String(patient.id || ""))}" ${hasSocialForm ? "" : "disabled"}>Imprimir</button>
        </div>
        ${socialSupport.dischargePending ? `<div class="social-service-status-meta">${escapeHtml(dischargeMeta)}</div>` : ""}
      </td>
      <td class="social-service-editor-cell social-service-observation-cell">
        <textarea data-field="observation" rows="3" placeholder="Observações importantes">${escapeHtml(socialSupport.observation || "")}</textarea>
        <div class="portaria-social-actions">
          <span class="portaria-social-updated">${socialSupport.dischargePending ? escapeHtml(dischargeMeta) : (socialSupport.updatedAt ? `Atualizado por ${escapeHtml(socialSupport.updatedBy || "-")} em ${escapeHtml(toBRDateTime(socialSupport.updatedAt) || "-")}` : (canSave ? "Sem anotações salvas ainda." : "Paciente exibido pelos leitos. Vincule ao cadastro para salvar o acompanhamento."))}</span>
          <div class="social-service-row-buttons">
            <button type="button" class="ghost btn-open-social-history" data-id="${escapeHtml(String(patient.id || ""))}">Histórico</button>
            <button type="button" class="ghost btn-close-portaria-social" data-id="${escapeHtml(String(patient.id || ""))}" ${canSave ? "" : "disabled"}>${canSave ? "Dar baixa" : "Cadastro pendente"}</button>
            <button type="button" class="btn-save-portaria-social" data-id="${escapeHtml(String(patient.id || ""))}" ${canSave ? "" : "disabled"}>${canSave ? "Salvar" : "Cadastro pendente"}</button>
          </div>
        </div>
      </td>
    `;
    container.appendChild(row);
  }
  // #region debug-point C:social-render
  reportDebugEvent("C", "public/app.js:renderPortariaSocialList", "[DEBUG] Social service render complete", {
    totalRows: patients.length,
    durationMs: Math.round(performance.now() - renderStartedAt)
  });
  // #endregion
}

async function openSocialPatientRegistry(patientId) {
  const patient = portariaActivePatients.find(item => String(item?.id || "") === String(patientId)) || null;
  if (patient?.id) {
    await openPatientRegistry(patient.id);
    return;
  }
  if (!patient) return;
  openNewPatientRegistry({
    nome: patient.nome || "",
    cpf: patient.cpf || "",
    birthDate: patient.birthDate || "",
    nir: patient.nir || "",
    cil: patient.cil || "",
    phone: patient.phone || ""
  });
}

function renderPortariaVisitorRegistry(items) {
  portariaVisitorEntries = Array.isArray(items) ? items : [];
  const container = document.getElementById("portaria-registry-list");
  const empty = document.getElementById("portaria-registry-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", portariaVisitorEntries.length > 0);
  updatePortariaRegistryCount(portariaVisitorEntries.length);

  for (const entry of portariaVisitorEntries) {
    const card = document.createElement("div");
    card.className = "portaria-registry-card";
    card.innerHTML = `
      <strong>${escapeHtml(entry.visitorName || "-")}</strong>
      <span>Codigo de acesso: ${escapeHtml(entry.accessCode || "-")}</span>
      <span>Setor ou motivo: ${escapeHtml(entry.sectorOrReason || "-")}</span>
      <span>Registrado por ${escapeHtml(entry.createdBy || "-")} em ${escapeHtml(toBRDateTime(entry.createdAt) || "-")}</span>
    `;
    container.appendChild(card);
  }
}

async function loadPortariaVisitorRegistry() {
  try {
    const data = await api("/api/portaria/visitors");
    renderPortariaVisitorRegistry(data.visitors || []);
    setPortariaRegistryFeedback("");
  } catch (error) {
    renderPortariaVisitorRegistry([]);
    setPortariaRegistryFeedback(error.message || "Nao foi possivel carregar os visitantes da portaria.", true);
  }
}

function renderPortariaVisitHistory(items) {
  const history = Array.isArray(items) ? items : [];
  const container = document.getElementById("portaria-visit-history");
  const empty = document.getElementById("portaria-visit-history-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", history.length > 0);

  for (const visit of history) {
    const card = document.createElement("div");
    card.className = "visit-history-card";
    card.innerHTML = `
      <strong>${escapeHtml(visit.visitorName || "-")}</strong>
      <span>Codigo de acesso: ${escapeHtml(visit.accessCode || "-")}</span>
      <span>Parentesco: ${escapeHtml(visit.kinship || "-")}</span>
      <span>Data: ${escapeHtml(toBRDate(visit.visitDate) || "-")} • Turno: ${escapeHtml(visit.visitShift || "-")} • Horario: ${escapeHtml(visit.visitTime || "-")}</span>
      <span>Registrado por ${escapeHtml(visit.createdBy || "-")} em ${escapeHtml(toBRDateTime(visit.createdAt) || "-")}</span>
      ${visit.note ? `<span>Observacao: ${escapeHtml(visit.note)}</span>` : ""}
    `;
    container.appendChild(card);
  }
}

function fillPortariaVisitForm(patient) {
  currentPortariaPatient = patient || null;
  const currentAdmission = patient?.currentAdmission || null;
  const name = patient?.nome || "-";
  const age = getPatientAgeLabel(patient?.birthDate) || "Idade não informada";
  const now = new Date();

  document.getElementById("portaria-visit-title").textContent = `Registrar visita - ${name}`;
  document.getElementById("portaria-visit-patient-name").textContent = name;
  document.getElementById("portaria-visit-patient-age").textContent = age;
  document.getElementById("portaria-visit-patient-ward").textContent = currentAdmission?.wardNome || "-";
  document.getElementById("portaria-visit-patient-bed").textContent = currentAdmission?.bedId || "-";
  document.getElementById("portaria-visit-access-code").value = "";
  document.getElementById("portaria-visit-visitor-name").value = "";
  document.getElementById("portaria-visit-kinship").value = "";
  document.getElementById("portaria-visit-date").value = getTodayIsoDate();
  document.getElementById("portaria-visit-shift").value = getSuggestedVisitShift(now);
  document.getElementById("portaria-visit-time").value = getCurrentTimeValue();
  document.getElementById("portaria-visit-note").value = "";
  updatePortariaVisitHeroSchedule();
  setPortariaVisitFeedback("");
  renderPortariaVisitHistory(patient?.visitHistory || []);
}

function updatePortariaVisitHeroSchedule() {
  const dateValue = document.getElementById("portaria-visit-date")?.value || "";
  const shiftValue = document.getElementById("portaria-visit-shift")?.value || "";
  const timeValue = document.getElementById("portaria-visit-time")?.value || "";

  const summaryDate = document.getElementById("portaria-visit-summary-date");
  const summaryShift = document.getElementById("portaria-visit-summary-shift");
  const summaryTime = document.getElementById("portaria-visit-summary-time");

  if (summaryDate) summaryDate.textContent = toBRDate(dateValue) || "-";
  if (summaryShift) summaryShift.textContent = shiftValue || "-";
  if (summaryTime) summaryTime.textContent = timeValue || "-";
}

function renderHospitalTrips(items) {
  hospitalTripEntries = Array.isArray(items) ? items : [];
  const container = document.getElementById("travel-list");
  const empty = document.getElementById("travel-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", hospitalTripEntries.length > 0);
  updateTravelSummary(hospitalTripEntries);
  updateTravelBatchSummary();

  for (const trip of hospitalTripEntries) {
    const card = document.createElement("div");
    card.className = "travel-trip-card";
    card.innerHTML = `
      <strong>${escapeHtml(trip.origin || "-")} -> ${escapeHtml(trip.destination || "-")}</strong>
      <span>Paciente: ${escapeHtml(trip.patient?.fullName || "-")} • CPF: ${escapeHtml(trip.patient?.cpf || "-")}</span>
      <span>Nascimento: ${escapeHtml(toBRDate(trip.patient?.birthDate || "") || "-")} • Telefone: ${escapeHtml(formatPhone(trip.patient?.phone || "") || "-")} • CEP: ${escapeHtml(formatCep(trip.patient?.cep || "") || "-")}</span>
      <span>Endereco do paciente: ${escapeHtml(trip.patient?.address || "-")}</span>
      <span>Acompanhante: ${escapeHtml(trip.companion?.fullName || "Nao informado")} • CPF: ${escapeHtml(trip.companion?.cpf || "-")}</span>
      <span>Endereco do acompanhante: ${escapeHtml(trip.companion?.address || "-")}</span>
      <span>Estimativa: ida ${escapeHtml(String(trip.estimatedOneWayKm ?? 0))} km • total ${escapeHtml(String(trip.estimatedRoundTripKm ?? 0))} km</span>
      <span>${escapeHtml(trip.patientProcedure?.code || "-")} • qtd ${escapeHtml(formatProcedureUnits(trip.patientProcedure?.units || 0))}</span>
      <span>${escapeHtml(trip.companionProcedure?.code || "-")} • qtd ${escapeHtml(formatProcedureUnits(trip.companionProcedure?.units || 0))}</span>
      <span>Registrado por ${escapeHtml(trip.createdBy || "-")} em ${escapeHtml(toBRDateTime(trip.createdAt) || "-")}</span>
      <div class="travel-trip-actions">
        <button type="button" class="ghost btn-travel-bpa-report" data-id="${escapeHtml(trip.id || "")}">Gerar BPA-I</button>
      </div>
    `;
    container.appendChild(card);
  }
}

async function loadHospitalTrips() {
  try {
    const data = await api("/api/hospital-trips");
    renderHospitalTrips(data.trips || []);
    setTravelFeedback("");
  } catch (error) {
    renderHospitalTrips([]);
    setTravelFeedback(error.message || "Nao foi possivel carregar as viagens.", true);
  }
}

async function openTravelView() {
  await refreshWards();
  setAppEnabled(false);
  showOnly("view-travel");
  closeSidebarOnMobile();
  ensureTravelBatchMonthDefault();
  await loadTravelCities();
  await loadHospitalTrips();
}

async function openPortariaVisitModal(patientId) {
  const numericId = parseInt(patientId, 10);
  if (!Number.isInteger(numericId)) {
    setPortariaFeedback("Nao foi possivel abrir o registro de visita enquanto a lista estiver em modo temporario.", true);
    return;
  }

  try {
    const data = await api(`/api/patients/${numericId}`);
    fillPortariaVisitForm(data.patient || null);
    document.getElementById("modal-portaria-visit")?.showModal();
  } catch (error) {
    setPortariaFeedback(error.message || "Nao foi possivel abrir o registro de visita.", true);
  }
}

function renderPortariaPatients(items) {
  const patients = Array.isArray(items) ? items : [];
  const container = document.getElementById("portaria-list");
  const empty = document.getElementById("portaria-list-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", patients.length > 0);

  for (const patient of patients) {
    const card = document.createElement("div");
    card.className = "portaria-card";
    card.dataset.id = patient.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.title = "Clique para registrar visita e ver o historico";
    card.innerHTML = `
      <strong>${patient.nome || "-"}</strong>
      <span>${getPatientAgeLabel(patient.birthDate) || "Idade não informada"}</span>
    `;
    container.appendChild(card);
  }
}

async function savePortariaSocialSupport(patientId, card) {
  const numericId = Number(patientId);
  if (!numericId || !card) return;

  const button = card.querySelector(".btn-save-portaria-social");
  const currentPatient = portariaActivePatients.find(patient => Number(patient?.id) === numericId) || {};
  const admission = currentPatient.currentAdmission || {};
  const wardId = Number(admission.wardId);
  const bedId = Number(admission.bedId);
  const currentSupport = createSocialSupportState(currentPatient.socialSupport);
  if (!normalizePhone(currentPatient.phone)) {
    setPortariaSocialFeedback("Cadastre o telefone do paciente antes de salvar o Serviço Social.", true);
    await openSocialPatientRegistry(patientId);
    return;
  }
  const payload = {
    contacts: formatPhone(currentPatient.phone || ""),
    admissionNotes: currentSupport.admissionNotes || "",
    socialRecord: hasSocialServiceFormContent(currentSupport.socialForm) ? "Concluído" : (currentSupport.socialRecord || "Pendente"),
    observation: card.querySelector('[data-field="observation"]')?.value.trim() || "",
    socialForm: currentSupport.socialForm
  };

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Salvando...";
    }
    const data = await api(`/api/patients/${numericId}/social-support`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    portariaActivePatients = portariaActivePatients.map(patient =>
      Number(patient.id) === numericId ? { ...patient, ...data.patient } : patient
    );
    if (ward && Number(currentWardId) === wardId && bedId && data.patient?.currentAdmission?.serviceSocialRequest) {
      ward.beds = ward.beds.map(item => item.id === bedId
        ? { ...item, serviceSocialRequest: data.patient.currentAdmission.serviceSocialRequest }
        : item);
      renderCounts(computeLocalWardCounts(ward.beds));
      renderBeds(ward.beds);
    }
    renderPortariaSocialList(portariaActivePatients.filter(hasServiceSocialRequest));
    setPortariaSocialFeedback("Acompanhamento salvo com sucesso.");
  } catch (error) {
    setPortariaSocialFeedback(error.message || "Nao foi possivel salvar o acompanhamento.", true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  }
}

async function closePortariaSocialSupport(patientId, card) {
  const numericId = Number(patientId);
  if (!numericId || !card) return;

  const button = card.querySelector(".btn-close-portaria-social");
  const currentPatient = portariaActivePatients.find(patient => Number(patient?.id) === numericId) || {};
  if (!normalizePhone(currentPatient.phone)) {
    setPortariaSocialFeedback("Cadastre o telefone do paciente antes de dar baixa no atendimento.", true);
    await openSocialPatientRegistry(patientId);
    return;
  }

  if (!confirm("Dar baixa neste atendimento do Serviço Social?")) return;

  const payload = {
    contacts: formatPhone(currentPatient.phone || ""),
    socialRecord: "Concluído",
    observation: card.querySelector('[data-field="observation"]')?.value.trim() || ""
  };

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Baixando...";
    }
    const data = await api(`/api/patients/${numericId}/social-support/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    portariaActivePatients = portariaActivePatients.map(patient =>
      Number(patient.id) === numericId ? { ...patient, ...data.patient } : patient
    );
    renderPortariaSocialList(portariaActivePatients.filter(hasServiceSocialRequest));
    await loadSocialServiceAttendances({ silent: true });
    setPortariaSocialFeedback("Atendimento baixado e enviado para o histórico.");
    setSocialServiceFeedback("Histórico do Serviço Social atualizado.");
  } catch (error) {
    setPortariaSocialFeedback(error.message || "Nao foi possivel dar baixa no atendimento.", true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Dar baixa";
    }
  }
}

async function openPortariaView() {
  await refreshWards();
  setAppEnabled(false);
  showOnly("view-portaria");
  closeSidebarOnMobile();

  try {
    const data = await api("/api/patients?active=true");
    const activePatients = (data.patients || [])
      .filter(patient => Boolean(patient.currentAdmission))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    portariaActivePatients = activePatients;
    renderPortariaPatients(activePatients);
    setPortariaFeedback(`${activePatients.length} paciente(s) internado(s) listado(s).`);
  } catch (error) {
    try {
      const fallbackPatients = (await buildPatientsFallbackList())
        .filter(patient => Boolean(patient.currentAdmission))
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
      portariaActivePatients = fallbackPatients;
      renderPortariaPatients(fallbackPatients);
      setPortariaFeedback("Lista da portaria carregada pelos leitos atuais enquanto a API completa não responde.");
    } catch (fallbackError) {
      portariaActivePatients = [];
      renderPortariaPatients([]);
      setPortariaFeedback(fallbackError.message || error.message || "Não foi possível carregar a lista da portaria.", true);
    }
  }
}

async function openSocialServiceView() {
  const startedAt = performance.now();
  await refreshWards();
  setWardPanelsEnabled(false, { showShift: false });
  showOnly("view-social-service");
  closeSidebarOnMobile();
  setSocialServiceActiveTab(currentSocialServiceTab);
  renderSocialServiceShiftPanel();
  await loadSocialServiceAttendances({ silent: true });

  try {
    const socialQueue = await buildServiceSocialQueueFromWards(wards);
    portariaActivePatients = socialQueue;
    renderPortariaSocialList(socialQueue);
    // #region debug-point D:social-view-success
    reportDebugEvent("D", "public/app.js:openSocialServiceView:success", "[DEBUG] Social service view opened", {
      totalPatients: socialQueue.length,
      durationMs: Math.round(performance.now() - startedAt)
    });
    // #endregion
    setPortariaSocialFeedback(socialQueue.length
      ? `${socialQueue.length} paciente(s) com solicitação para o Serviço Social.`
      : "Nenhuma solicitação para o Serviço Social no momento.");
  } catch (error) {
    // #region debug-point D:social-view-error
    reportDebugEvent("D", "public/app.js:openSocialServiceView:error", "[DEBUG] Social service view failed", {
      durationMs: Math.round(performance.now() - startedAt),
      error: error.message
    });
    // #endregion
    try {
      const socialQueue = getServiceSocialRequestedPatients(await buildPatientsFallbackList());
      portariaActivePatients = socialQueue;
      renderPortariaSocialList(socialQueue);
      setPortariaSocialFeedback(socialQueue.length
        ? "Solicitações do Serviço Social carregadas pela lista atual de leitos."
        : "Nenhuma solicitação para o Serviço Social foi encontrada nos leitos atuais.");
    } catch (fallbackError) {
      portariaActivePatients = [];
      renderPortariaSocialList([]);
      setPortariaSocialFeedback(fallbackError.message || error.message || "Nao foi possivel carregar o acompanhamento social.", true);
    }
  }
}

async function openPsychologyView() {
  await refreshWards();
  setWardPanelsEnabled(false, { showShift: false });
  showOnly("view-psychology");
  closeSidebarOnMobile();
  setPsychologyActiveTab(currentPsychologyTab);
  renderPsychologyShiftPanel();
  await loadPsychologyManualRequests();
  await loadPsychologyRecentAttendances();
  await loadPsychologyMonthlyAttendances({ silent: true });

  try {
    const psychologyQueue = await buildPsychologyQueueFromWards(wards);
    renderPsychologyPatients(psychologyQueue);
    setPsychologyFeedback(psychologyQueue.length
      ? "Solicitações da Psicologia carregadas pelos leitos atuais."
      : "Nenhuma solicitação para a Psicologia no momento.");
  } catch (error) {
    try {
      const fallbackPatients = getPsychologyRequestedPatients(await buildPatientsFallbackList());
      renderPsychologyPatients(fallbackPatients);
      setPsychologyFeedback(fallbackPatients.length
        ? "Solicitações da Psicologia carregadas pelos leitos atuais."
        : "Nenhuma solicitação para a Psicologia foi encontrada nos leitos atuais.");
    } catch (fallbackError) {
      renderPsychologyPatients([]);
      setPsychologyFeedback(fallbackError.message || error.message || "Nao foi possivel carregar a lista da psicologia.", true);
    }
  }
}

async function savePortariaVisitorRegistry() {
  const payload = {
    accessCode: document.getElementById("portaria-registry-access-code").value.trim(),
    visitorName: document.getElementById("portaria-registry-visitor-name").value.trim(),
    sectorOrReason: document.getElementById("portaria-registry-sector-reason").value.trim()
  };

  try {
    const data = await api("/api/portaria/visitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const nextItems = [data.visitor, ...portariaVisitorEntries].filter(Boolean);
    renderPortariaVisitorRegistry(nextItems);
    document.getElementById("portaria-registry-access-code").value = "";
    document.getElementById("portaria-registry-visitor-name").value = "";
    document.getElementById("portaria-registry-sector-reason").value = "";
    setPortariaRegistryFeedback("Visitante registrado com sucesso.");
  } catch (error) {
    setPortariaRegistryFeedback(error.message || "Nao foi possivel registrar o visitante.", true);
  }
}

async function saveHospitalTrip() {
  const payload = {
    origin: document.getElementById("travel-origin").value.trim(),
    destination: document.getElementById("travel-destination").value.trim(),
    estimatedOneWayKm: travelDistanceEstimate?.oneWayKm,
    estimatedRoundTripKm: travelDistanceEstimate?.roundTripKm,
    patient: {
      fullName: document.getElementById("travel-patient-name").value.trim(),
      cpf: document.getElementById("travel-patient-cpf").value.trim(),
      birthDate: document.getElementById("travel-patient-birthdate").value,
      phone: document.getElementById("travel-patient-phone").value.trim(),
      cep: document.getElementById("travel-patient-cep").value.trim(),
      address: document.getElementById("travel-patient-address").value.trim()
    },
    companion: {
      fullName: document.getElementById("travel-companion-name").value.trim(),
      cpf: document.getElementById("travel-companion-cpf").value.trim(),
      address: document.getElementById("travel-companion-address").value.trim()
    }
  };

  if (!payload.destination) {
    setTravelFeedback("Selecione a cidade de destino.", true);
    return;
  }
  if (!travelDistanceEstimate?.roundTripKm && travelDistanceEstimate?.roundTripKm !== 0) {
    setTravelFeedback("Escolha uma cidade valida para calcular a viagem.", true);
    return;
  }

  try {
    const data = await api("/api/hospital-trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    renderHospitalTrips([data.trip, ...hospitalTripEntries].filter(Boolean));
    document.getElementById("travel-destination").value = "";
    document.getElementById("travel-patient-name").value = "";
    document.getElementById("travel-patient-cpf").value = "";
    document.getElementById("travel-patient-birthdate").value = "";
    document.getElementById("travel-patient-phone").value = "";
    document.getElementById("travel-patient-cep").value = "";
    document.getElementById("travel-patient-address").value = "";
    document.getElementById("travel-companion-name").value = "";
    document.getElementById("travel-companion-cpf").value = "";
    document.getElementById("travel-companion-address").value = "";
    applyTravelEstimate(null);
    setTravelFeedback("Viagem registrada com sucesso.");
  } catch (error) {
    setTravelFeedback(error.message || "Nao foi possivel registrar a viagem.", true);
  }
}

async function savePortariaVisit() {
  const patientId = currentPortariaPatient?.id;
  if (!patientId) return;

  const payload = {
    accessCode: document.getElementById("portaria-visit-access-code").value.trim(),
    visitorName: document.getElementById("portaria-visit-visitor-name").value.trim(),
    kinship: document.getElementById("portaria-visit-kinship").value.trim(),
    visitDate: document.getElementById("portaria-visit-date").value,
    visitShift: document.getElementById("portaria-visit-shift").value,
    visitTime: document.getElementById("portaria-visit-time").value,
    note: document.getElementById("portaria-visit-note").value.trim()
  };

  try {
    const data = await api(`/api/patients/${patientId}/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    currentPortariaPatient = data.patient || currentPortariaPatient;
    renderPortariaVisitHistory(currentPortariaPatient?.visitHistory || []);
    document.getElementById("portaria-visit-access-code").value = "";
    document.getElementById("portaria-visit-visitor-name").value = "";
    document.getElementById("portaria-visit-kinship").value = "";
    document.getElementById("portaria-visit-date").value = getTodayIsoDate();
    document.getElementById("portaria-visit-shift").value = getSuggestedVisitShift(new Date());
    document.getElementById("portaria-visit-time").value = getCurrentTimeValue();
    document.getElementById("portaria-visit-note").value = "";
    updatePortariaVisitHeroSchedule();
    setPortariaVisitFeedback("Visita registrada com sucesso.");
  } catch (error) {
    setPortariaVisitFeedback(error.message || "Nao foi possivel registrar a visita.", true);
  }
}

function setNirFeedback(message = "", isError = false) {
  const feedback = document.getElementById("nir-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function setNirReportFeedback(message = "", isError = false) {
  const feedback = document.getElementById("nir-report-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", Boolean(message && isError));
}

function getPatientRegulationChannels() {
  const channels = [];
  if (document.getElementById("patient-regulation-email")?.checked) channels.push("EMAIL");
  if (document.getElementById("patient-regulation-cil")?.checked) channels.push("CIL");
  return channels;
}

function getNirChannelLabel(channel = "") {
  return String(channel || "").toUpperCase() === "CIL" ? "SIREL" : String(channel || "").toUpperCase();
}

function formatNirChannels(channels = []) {
  if (!Array.isArray(channels) || !channels.length) return "-";
  return channels.map(getNirChannelLabel).join(" / ");
}

function setPatientRegulationChannels(channels = []) {
  const normalized = Array.isArray(channels) ? channels.map(item => String(item || "").toUpperCase()) : [];
  const emailInput = document.getElementById("patient-regulation-email");
  const cilInput = document.getElementById("patient-regulation-cil");
  if (emailInput) emailInput.checked = normalized.includes("EMAIL");
  if (cilInput) cilInput.checked = normalized.includes("CIL");
}

function renderNirPreviousReports(previousItems = [], otherItems = []) {
  nirPreviousReports = Array.isArray(previousItems) ? previousItems : [];
  nirOtherUserReports = Array.isArray(otherItems) ? otherItems : [];
  const container = document.getElementById("nir-previous-reports");
  if (!container) return;

  container.innerHTML = "";
  const combinedReports = [
    ...nirOtherUserReports.map(item => ({ ...item, sourceLabel: "Outro login hoje" })),
    ...nirPreviousReports.map(item => ({ ...item, sourceLabel: "Plantão anterior" }))
  ];
  if (!combinedReports.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "Nenhum relatório encontrado em outros logins ou no plantão anterior.";
    container.appendChild(empty);
    return;
  }

  for (const item of combinedReports) {
    const card = document.createElement("div");
    card.className = "patient-history-card";
    card.innerHTML = `
      <strong>${item.authorName || "-"}</strong>
      <span>${item.sourceLabel || "-"}${item.operationalDay ? ` • Dia ${toBRDate(item.operationalDay)}` : "-"}${item.updatedAt ? ` • Atualizado em ${toBRDateTime(item.updatedAt)}` : ""}</span>
      <span>${item.content || "-"}</span>
      <button type="button" class="ghost btn-open-previous-nir-report" data-report-id="${item.id || ""}">Abrir relatório</button>
    `;
    container.appendChild(card);
  }
}

function renderNirCurrentReport(report) {
  nirCurrentReport = report || null;
  const container = document.getElementById("nir-current-report-saved");
  if (!container) return;

  container.innerHTML = "";
  if (!nirCurrentReport?.content) {
    const empty = document.createElement("span");
    empty.textContent = "Nenhum relatório salvo para este dia operacional.";
    container.appendChild(empty);
    return;
  }

  const author = document.createElement("strong");
  author.textContent = nirCurrentReport.authorName || currentUser?.nome || currentUser?.username || "-";
  const meta = document.createElement("span");
  meta.textContent = `${nirCurrentReport.operationalDay ? `Dia ${toBRDate(nirCurrentReport.operationalDay)}` : "-"}${nirCurrentReport.updatedAt ? ` • Salvo em ${toBRDateTime(nirCurrentReport.updatedAt)}` : ""}`;
  const content = document.createElement("span");
  content.textContent = nirCurrentReport.content || "";
  container.append(author, meta, content);
}

async function loadNirReports() {
  try {
    const data = await api("/api/nir/reports");
    nirCurrentReport = data.currentReport || null;
    const input = document.getElementById("nir-current-report-input");
    if (input) input.value = nirCurrentReport?.content || "";
    renderNirCurrentReport(nirCurrentReport);
    renderNirPreviousReports(data.previousReports || [], data.otherUserReports || []);
    setNirReportFeedback("");
  } catch (error) {
    renderNirCurrentReport(null);
    renderNirPreviousReports([], []);
    setNirReportFeedback(error.message || "Não foi possível carregar o relatório do NIR.", true);
  }
}

async function saveNirReport() {
  const input = document.getElementById("nir-current-report-input");
  const content = input?.value.trim() || "";
  if (!content) {
    setNirReportFeedback("Digite o relatório do enfermeiro antes de salvar.", true);
    return;
  }

  try {
    const data = await api("/api/nir/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    nirCurrentReport = data.currentReport || null;
    renderNirCurrentReport(nirCurrentReport);
    renderNirPreviousReports(data.previousReports || [], data.otherUserReports || []);
    setNirReportFeedback("Relatório do enfermeiro salvo com sucesso.");
  } catch (error) {
    setNirReportFeedback(error.message || "Não foi possível salvar o relatório do NIR.", true);
  }
}

function printNirReport() {
  const operationalDate = toBRDate(getOperationalDayKey(new Date())) || "-";
  const reportText = nirCurrentReport?.content || document.getElementById("nir-current-report-input")?.value.trim() || "Nenhum relatório salvo.";
  const allPatients = [...nirPatients, ...nirAcceptedPatients];
  const uniquePatients = allPatients.filter((patient, index, list) => (
    list.findIndex(item => String(item.id) === String(patient.id)) === index
  ));
  const cilPatients = uniquePatients.filter(patient => (
    String(patient.cil || "").trim()
    || (Array.isArray(patient.regulationChannels) && patient.regulationChannels.includes("CIL"))
    || (Array.isArray(patient.nirUpdateChannels) && patient.nirUpdateChannels.includes("CIL"))
  ));
  const popup = window.open("", "_blank", "width=1200,height=900");
  if (!popup) {
    setNirReportFeedback("Não foi possível abrir a janela de impressão.", true);
    return;
  }

  setNirReportFeedback("Folha do relatório aberta. Na nova aba, clique em 'Imprimir / Salvar PDF'.");

  popup.document.write(`<!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>Mapa de Pacientes Sinalizados ao NIR</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Arial, sans-serif; margin: 0; background: #e5edf5; color: #102a43; }
        .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px; align-items: center; padding: 14px 18px; background: #102a43; color: #fff; }
        .toolbar button { padding: 10px 16px; border: 0; border-radius: 8px; background: #16a34a; color: #fff; font-weight: 700; cursor: pointer; }
        .toolbar span { font-size: 14px; }
        .page-wrap { padding: 24px; display: flex; justify-content: center; }
        .sheet { width: 297mm; min-height: 210mm; background: #fff; box-shadow: 0 12px 40px rgba(16, 42, 67, 0.18); padding: 10mm; }
        ${buildHospitalReportPrintStyles()}
        h1, h2, h3 { margin: 0; }
        .nir-print-headline { margin: 0 0 8px; font-size: 22px; font-weight: 900; text-align: center; text-transform: uppercase; }
        .nir-print-meta { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #7f96b4; margin-bottom: 8px; }
        .nir-print-meta div { padding: 6px 8px; font-size: 11px; font-weight: 800; background: #dbe7f7; border-right: 1px solid #7f96b4; }
        .nir-print-meta div:last-child { border-right: 0; text-align: right; }
        .section { margin-top: 10px; }
        .section-title { margin-bottom: 4px; font-size: 12px; font-weight: 900; text-transform: uppercase; color: #334e68; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #7f96b4; padding: 4px 5px; font-size: 10px; text-align: center; vertical-align: middle; line-height: 1.15; }
        th { background: #c4d8f4; color: #0e2033; text-transform: uppercase; font-weight: 900; }
        td { background: #f7f9fc; }
        tbody tr:nth-child(odd) td { background: #dbe7f7; }
        tbody tr:nth-child(even) td { background: #e9eef6; }
        .empty { padding: 8px; border: 1px solid #7f96b4; background: #f8fbff; font-size: 10px; }
        .nir-print-patient strong { display: block; font-size: 10px; }
        .nir-print-patient span { display: block; font-size: 9px; color: #334e68; }
        .nir-print-status { font-weight: 800; }
        .nir-print-action { font-weight: 800; }
        .nir-print-channel { font-weight: 800; }
        .nir-print-report { border: 1px solid #7f96b4; background: #fff9b1; padding: 10px; min-height: 56px; white-space: pre-wrap; font-size: 11px; line-height: 1.3; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page-wrap { padding: 0; }
          .sheet { width: auto; min-height: auto; box-shadow: none; padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button onclick="window.print()">Imprimir / Salvar PDF</button>
        <span>Visualização da folha do relatório do plantão.</span>
      </div>
      <div class="page-wrap">
        <div class="sheet">
          ${buildHospitalReportTop({
            title: "Mapa de Pacientes Sinalizados ao NIR",
            subtitle: "Relatório operacional com a mesma leitura da tabela do NIR.",
            metaHtml: `<div><strong>Gerado em:</strong> ${escapeHtml(toBRDateTime(new Date().toISOString()))}</div>`
          })}
          <div class="nir-print-headline">Mapa de Pacientes Sinalizados ao NIR</div>
          <div class="nir-print-meta">
            <div>DATA: ${escapeHtml(operationalDate)}</div>
            <div>ENFERMEIRO: ${escapeHtml(currentUser?.nome || currentUser?.username || "-")}</div>
          </div>
          <div class="section">
            <div class="section-title">Pacientes sinalizados</div>
            ${buildNirPrintTable(uniquePatients, "Nenhum paciente internado ativo neste dia operacional.")}
          </div>
          <div class="section">
            <div class="section-title">Pacientes aceitos</div>
            ${buildNirPrintTable(nirAcceptedPatients, "Nenhum paciente aceito neste dia operacional.")}
          </div>
          ${cilPatients.length ? `
          <div class="section">
            <div class="section-title">Pacientes com SIREL informado</div>
            ${buildNirPrintTable(cilPatients, "Nenhum paciente em SIREL neste dia operacional.")}
          </div>` : ""}
          <div class="section">
            <div class="section-title">Relatório do enfermeiro</div>
            <div class="nir-print-report">${escapeHtml(reportText)}</div>
          </div>
        </div>
      </div>
    </body>
  </html>`);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => {
    try {
      popup.print();
    } catch (error) {
      console.warn("Falha ao abrir a impressão do NIR", error);
    }
  }, 300);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHospitalReportPrintStyles() {
  return `
    .hma-report-brand {
      margin: -14mm -14mm 18px;
      padding: 18px 22px 16px;
      background: linear-gradient(180deg, #020817, #06142f);
      color: #fff;
    }
    .hma-report-brand-shell {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
    }
    .hma-report-brand-mark {
      font-size: 64px;
      font-weight: 900;
      line-height: 0.88;
      letter-spacing: -3px;
      color: #3b82f6;
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
    }
    .hma-report-brand-copy {
      display: grid;
      gap: 4px;
    }
    .hma-report-brand-title {
      font-size: 24px;
      font-weight: 900;
      line-height: 1.1;
      color: #eff6ff;
    }
    .hma-report-brand-subtitle {
      font-size: 14px;
      font-weight: 700;
      color: #cbd5e1;
    }
    .hma-report-brand-divider {
      height: 3px;
      margin-top: 12px;
      border-radius: 999px;
      background: linear-gradient(90deg, #3b82f6, #bfdbfe);
    }
    .hma-report-heading {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #dbe4f0;
    }
    .hma-report-title {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
    }
    .hma-report-subtitle {
      margin: 4px 0 0;
      font-size: 13px;
      color: #475569;
    }
    .hma-report-meta {
      display: grid;
      gap: 4px;
      text-align: right;
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
    }
    .hma-report-meta strong {
      color: #0f172a;
    }
    @media print {
      .hma-report-brand {
        margin: 0 0 18px;
      }
    }
  `;
}

function buildHospitalReportTop({ title = "", subtitle = "", metaHtml = "" } = {}) {
  return `
    <div class="hma-report-brand">
      <div class="hma-report-brand-shell">
        <div class="hma-report-brand-mark">HMA</div>
        <div class="hma-report-brand-copy">
          <div class="hma-report-brand-title">HOSPITAL MUNICIPAL DE AÇAILÂNDIA</div>
          <div class="hma-report-brand-subtitle">Rua João de Deus, s/n, Getat</div>
        </div>
      </div>
      <div class="hma-report-brand-divider"></div>
    </div>
    <div class="hma-report-heading">
      <div>
        <h1 class="hma-report-title">${escapeHtml(title)}</h1>
        <p class="hma-report-subtitle">${escapeHtml(subtitle)}</p>
      </div>
      <div class="hma-report-meta">${metaHtml}</div>
    </div>
  `;
}

function buildNirPrintTable(items = [], emptyMessage = "Nenhum paciente.") {
  if (!items.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  const rows = items.map(patient => {
    const current = patient.currentAdmission || patient.lastAdmission || {};
    const updatedChannels = Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels.map(item => String(item || "").toUpperCase()) : [];
    const specialtyLabel = patient.nirAcceptedLocation || "-";
    const reasonLabel = patient.nir || patient.nirActionReason || patient.diagnostico || "-";
    const accepted = patient.regulationAcceptedAt ? toBRDateTime(patient.regulationAcceptedAt) : (patient.updatedAt ? toBRDate(patient.updatedAt) : "-");
    const actionLabel = patient.nirDischargePending
      ? "Alta pendente"
      : (String(patient.nirWorkflowStatus || "").trim() || "Solicitado");
    return `
      <tr>
        <td>${escapeHtml(current.wardNome || "-")}</td>
        <td class="nir-print-patient">
          <strong>${escapeHtml(patient.nome || "-")}</strong>
          <span>CPF ${escapeHtml(formatCpf(patient.cpf || "") || "-")}</span>
          <span>${escapeHtml(patient.diagnostico || "-")}</span>
        </td>
        <td>${escapeHtml(current.bedId || "-")}</td>
        <td>${escapeHtml(patient.cil || "-")}</td>
        <td>${escapeHtml(reasonLabel)}</td>
        <td>${escapeHtml(toBRDate(current.admittedAt) || "-")}</td>
        <td>${escapeHtml(specialtyLabel)}</td>
        <td>${escapeHtml(accepted)}</td>
        <td class="nir-print-channel">${updatedChannels.includes("EMAIL") ? "SIM" : "-"}</td>
        <td class="nir-print-action">${escapeHtml(actionLabel)}</td>
      </tr>
    `;
  }).join("");
  return `
    <table>
      <thead>
        <tr>
          <th>Setor</th>
          <th>Paciente</th>
          <th>Leito</th>
          <th>SIREL</th>
          <th>Motivo da Regulação</th>
          <th>Data da Internação</th>
          <th>Especialidade</th>
          <th>Data da Regulação</th>
          <th>EMAIL</th>
          <th>Ação</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function getTravelBpaCompetenceLabel(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "--/----";
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function getTravelBpaCompetenceValue(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function ensureTravelBatchMonthDefault() {
  const input = document.getElementById("travel-batch-month");
  if (!input || input.value) return;
  input.value = getTravelBpaCompetenceValue(new Date().toISOString());
}

function getTravelTripsByCompetence(monthValue) {
  const competence = String(monthValue || "").trim();
  if (!competence) return [];
  return hospitalTripEntries.filter(item => getTravelBpaCompetenceValue(item.createdAt) === competence);
}

function updateTravelBatchSummary() {
  ensureTravelBatchMonthDefault();
  const summary = document.getElementById("travel-batch-summary");
  if (!summary) return;
  const monthValue = document.getElementById("travel-batch-month")?.value || "";
  const trips = getTravelTripsByCompetence(monthValue);
  const rows = trips.flatMap(buildTravelBpaProcedureRows);
  const totalKm = trips.reduce((sum, item) => sum + (Number(item.estimatedRoundTripKm) || 0), 0);
  const competenceLabel = monthValue ? monthValue.split("-").reverse().join("/") : "--/----";
  summary.textContent = `${trips.length} viagem(ns) e ${rows.length} lancamento(s) BPA-I em ${competenceLabel}. Total estimado: ${formatTravelKm(totalKm)}.`;
}

function buildTravelBpaProcedureRows(trip) {
  const rows = [];
  const attendanceDate = toBRDate(String(trip?.createdAt || "").slice(0, 10)) || toBRDate(getTodayIsoDate()) || "-";
  const commonMeta = {
    attendanceDate,
    destination: trip?.destination || "-",
    totalKm: formatTravelKm(trip?.estimatedRoundTripKm || 0),
    origin: trip?.origin || "-"
  };

  rows.push({
    type: "Paciente",
    person: trip?.patient || {},
    procedure: trip?.patientProcedure || {},
    ...commonMeta
  });

  if ((trip?.companionProcedure?.units || 0) > 0 && trip?.companion?.fullName) {
    rows.push({
      type: "Acompanhante",
      person: trip.companion || {},
      procedure: trip.companionProcedure || {},
      ...commonMeta
    });
  }

  return rows;
}

function openPrintPreviewWindow(html, title = "Relatorio") {
  const popup = window.open("", "_blank", "width=1280,height=920");
  if (!popup) {
    throw new Error("Nao foi possivel abrir a janela de impressao.");
  }

  try {
    popup.document.open("text/html", "replace");
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    return popup;
  } catch (error) {
    try {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      popup.location.replace(blobUrl);
      popup.document.title = title;
      popup.focus();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return popup;
    } catch {
      popup.close();
      throw error;
    }
  }
}

function printTravelBpaReport(tripId) {
  const trip = hospitalTripEntries.find(item => String(item.id) === String(tripId));
  if (!trip) {
    setTravelFeedback("Nao foi possivel localizar a viagem para gerar o BPA-I.", true);
    return;
  }

  try {
    const rows = buildTravelBpaProcedureRows(trip);
    const rowHtml = rows.map(item => `
    <tr>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.person?.fullName || "-")}</td>
      <td>${escapeHtml(formatCpf(item.person?.cpf || "") || "-")}</td>
      <td>${escapeHtml(item.person?.address || "-")}</td>
      <td>${escapeHtml(item.procedure?.code || "-")}<br><small>${escapeHtml(item.procedure?.description || "-")}</small></td>
      <td>${escapeHtml(formatProcedureUnits(item.procedure?.units || 0))}</td>
      <td>${escapeHtml(item.attendanceDate)}</td>
      <td>____________________</td>
      <td>____________________</td>
    </tr>
  `).join("");

    const html = `<!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>BPA-I - Transporte Terrestre</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #e5edf5; color: #102a43; }
        .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px; align-items: center; padding: 14px 18px; background: #102a43; color: #fff; }
        .toolbar button { padding: 10px 16px; border: 0; border-radius: 8px; background: #16a34a; color: #fff; font-weight: 700; cursor: pointer; }
        .page-wrap { padding: 24px; display: flex; justify-content: center; }
        .sheet { width: 210mm; min-height: 297mm; background: #fff; box-shadow: 0 12px 40px rgba(16, 42, 67, 0.18); padding: 14mm; }
        ${buildHospitalReportPrintStyles()}
        .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
        .meta-card { border: 1px solid #c9d7e6; border-radius: 10px; padding: 10px; background: #f8fbff; }
        .meta-card strong { display: block; font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
        .meta-card span { font-size: 13px; font-weight: 700; color: #0f172a; }
        .section { margin-top: 16px; }
        .section h2 { margin: 0 0 8px; font-size: 16px; }
        .section p { margin: 0; font-size: 12px; color: #475569; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #8ea3c2; padding: 8px; font-size: 11px; text-align: left; vertical-align: top; }
        th { background: #c4d8f4; }
        small { color: #64748b; }
        .notes { margin-top: 14px; padding: 12px; border: 1px dashed #94a3b8; border-radius: 10px; background: #f8fafc; font-size: 12px; color: #334155; }
        .notes ul { margin: 8px 0 0 18px; padding: 0; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page-wrap { padding: 0; }
          .sheet { width: auto; min-height: auto; box-shadow: none; padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button onclick="window.print()">Imprimir / Salvar PDF</button>
        <span>Espelho BPA-I baseado nos dados da viagem cadastrada.</span>
      </div>
      <div class="page-wrap">
        <div class="sheet">
          ${buildHospitalReportTop({
            title: "Espelho BPA-I - Transporte Terrestre",
            subtitle: "Relatório individualizado para conferência e digitação no BPA.",
            metaHtml: `
              <div><strong>Competência:</strong> ${escapeHtml(getTravelBpaCompetenceLabel(trip.createdAt))}</div>
              <div><strong>Gerado em:</strong> ${escapeHtml(toBRDateTime(new Date().toISOString()))}</div>
            `
          })}

          <div class="meta-grid">
            <div class="meta-card"><strong>Origem</strong><span>${escapeHtml(trip.origin || "-")}</span></div>
            <div class="meta-card"><strong>Destino</strong><span>${escapeHtml(trip.destination || "-")}</span></div>
            <div class="meta-card"><strong>Km ida</strong><span>${escapeHtml(formatTravelKm(trip.estimatedOneWayKm || 0))}</span></div>
            <div class="meta-card"><strong>Km total</strong><span>${escapeHtml(formatTravelKm(trip.estimatedRoundTripKm || 0))}</span></div>
            <div class="meta-card"><strong>Paciente</strong><span>${escapeHtml(trip.patient?.fullName || "-")}</span></div>
            <div class="meta-card"><strong>Acompanhante</strong><span>${escapeHtml(trip.companion?.fullName || "Nao informado")}</span></div>
            <div class="meta-card"><strong>Digitador</strong><span>${escapeHtml(currentUser?.nome || currentUser?.username || "-")}</span></div>
            <div class="meta-card"><strong>Data atendimento</strong><span>${escapeHtml(toBRDate(String(trip.createdAt || "").slice(0, 10)) || "-")}</span></div>
          </div>

          <div class="section">
            <h2>Lancamentos BPA-I</h2>
            <p>Os procedimentos abaixo seguem a regra de 1 unidade a cada 50 km do total da viagem.</p>
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Nome completo</th>
                  <th>CPF/CNS</th>
                  <th>Endereco</th>
                  <th>Procedimento</th>
                  <th>Qtd</th>
                  <th>Data at.</th>
                  <th>Municipio/IBGE</th>
                  <th>CNS Prof./CBO</th>
                </tr>
              </thead>
              <tbody>
                ${rowHtml}
              </tbody>
            </table>
          </div>

          <div class="notes">
            <strong>Campos do modelo BPA-I para conferencia:</strong>
            <ul>
              <li>Baseado no registro individualizado do BPA, com identificacao do usuario e do atendimento.</li>
              <li>Os procedimentos 08.03.01.012-5 e 08.03.01.010-9 usam instrumento de registro BPA-I e exigem CPF/CNS.</li>
              <li>Se necessario no fechamento oficial, complete CNES, CNS do profissional, CBO, data de nascimento e municipio de residencia.</li>
            </ul>
          </div>
        </div>
      </div>
    </body>
  </html>`;

    openPrintPreviewWindow(html, "BPA-I - Transporte Terrestre");
    setTravelFeedback("Espelho BPA-I aberto. Na nova aba, clique em 'Imprimir / Salvar PDF'.");
  } catch (error) {
    console.error("Falha ao gerar BPA-I da viagem", error);
    setTravelFeedback(error.message || "Nao foi possivel gerar o BPA-I.", true);
  }
}

function printTravelBpaBatchReport() {
  ensureTravelBatchMonthDefault();
  const monthValue = document.getElementById("travel-batch-month")?.value || "";
  const trips = getTravelTripsByCompetence(monthValue);
  if (!trips.length) {
    setTravelFeedback("Nao ha viagens nesse mes para gerar o BPA-I em lote.", true);
    return;
  }

  try {
    const rows = trips.flatMap((trip, index) =>
      buildTravelBpaProcedureRows(trip).map(item => ({ trip, index: index + 1, item }))
    );
    const rowHtml = rows.map(({ trip, index, item }) => `
    <tr>
      <td>${escapeHtml(String(index))}</td>
      <td>${escapeHtml(item.attendanceDate)}</td>
      <td>${escapeHtml(trip.destination || "-")}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.person?.fullName || "-")}</td>
      <td>${escapeHtml(formatCpf(item.person?.cpf || "") || "-")}</td>
      <td>${escapeHtml(item.person?.address || "-")}</td>
      <td>${escapeHtml(item.procedure?.code || "-")}</td>
      <td>${escapeHtml(formatProcedureUnits(item.procedure?.units || 0))}</td>
      <td>____________________</td>
      <td>____________________</td>
    </tr>
  `).join("");
    const totalKm = trips.reduce((sum, item) => sum + (Number(item.estimatedRoundTripKm) || 0), 0);
    const competenceLabel = monthValue ? monthValue.split("-").reverse().join("/") : "--/----";
    const html = `<!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>BPA-I em lote - ${escapeHtml(competenceLabel)}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #e5edf5; color: #102a43; }
        .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px; align-items: center; padding: 14px 18px; background: #102a43; color: #fff; }
        .toolbar button { padding: 10px 16px; border: 0; border-radius: 8px; background: #16a34a; color: #fff; font-weight: 700; cursor: pointer; }
        .page-wrap { padding: 24px; display: flex; justify-content: center; }
        .sheet { width: 210mm; min-height: 297mm; background: #fff; box-shadow: 0 12px 40px rgba(16, 42, 67, 0.18); padding: 14mm; }
        ${buildHospitalReportPrintStyles()}
        .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
        .meta-card { border: 1px solid #c9d7e6; border-radius: 10px; padding: 10px; background: #f8fbff; }
        .meta-card strong { display: block; font-size: 11px; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
        .meta-card span { font-size: 13px; font-weight: 700; color: #0f172a; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #8ea3c2; padding: 7px; font-size: 10px; text-align: left; vertical-align: top; }
        th { background: #c4d8f4; }
        .notes { margin-top: 14px; padding: 12px; border: 1px dashed #94a3b8; border-radius: 10px; background: #f8fafc; font-size: 12px; color: #334155; }
        .notes ul { margin: 8px 0 0 18px; padding: 0; }
        @media print {
          body { background: #fff; }
          .toolbar { display: none; }
          .page-wrap { padding: 0; }
          .sheet { width: auto; min-height: auto; box-shadow: none; padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button onclick="window.print()">Imprimir / Salvar PDF</button>
        <span>PDF unico com todos os lancamentos BPA-I da competencia selecionada.</span>
      </div>
      <div class="page-wrap">
        <div class="sheet">
          ${buildHospitalReportTop({
            title: "BPA-I em lote - Transporte Terrestre",
            subtitle: "Espelho único de todas as viagens da competência selecionada.",
            metaHtml: `
              <div><strong>Competência:</strong> ${escapeHtml(competenceLabel)}</div>
              <div><strong>Gerado em:</strong> ${escapeHtml(toBRDateTime(new Date().toISOString()))}</div>
            `
          })}
          <div class="meta-grid">
            <div class="meta-card"><strong>Viagens</strong><span>${escapeHtml(String(trips.length))}</span></div>
            <div class="meta-card"><strong>Lancamentos BPA-I</strong><span>${escapeHtml(String(rows.length))}</span></div>
            <div class="meta-card"><strong>Km total do mes</strong><span>${escapeHtml(formatTravelKm(totalKm))}</span></div>
            <div class="meta-card"><strong>Digitador</strong><span>${escapeHtml(currentUser?.nome || currentUser?.username || "-")}</span></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Viagem</th>
                <th>Data</th>
                <th>Destino</th>
                <th>Tipo</th>
                <th>Nome completo</th>
                <th>CPF/CNS</th>
                <th>Endereco</th>
                <th>Procedimento</th>
                <th>Qtd</th>
                <th>Municipio/IBGE</th>
                <th>CNS Prof./CBO</th>
              </tr>
            </thead>
            <tbody>${rowHtml}</tbody>
          </table>
          <div class="notes">
            <strong>Conferencia BPA-I do mes:</strong>
            <ul>
              <li>Os procedimentos de transporte terrestre seguem BPA-I e exigem CPF/CNS.</li>
              <li>O PDF agrupa todas as viagens da competencia escolhida em um unico espelho.</li>
              <li>Se necessario no faturamento oficial, complemente CNES, CNS profissional, CBO e municipio/IBGE.</li>
            </ul>
          </div>
        </div>
      </div>
    </body>
  </html>`;

    openPrintPreviewWindow(html, `BPA-I em lote - ${competenceLabel}`);
    setTravelFeedback("BPA-I em lote aberto. Na nova aba, clique em 'Imprimir / Salvar PDF'.");
  } catch (error) {
    console.error("Falha ao gerar BPA-I em lote", error);
    setTravelFeedback(error.message || "Nao foi possivel gerar o BPA-I em lote.", true);
  }
}

function openPreviousNirReport(reportId) {
  const report = [...nirPreviousReports, ...nirOtherUserReports].find(item => String(item.id) === String(reportId));
  if (!report) return;
  const title = document.getElementById("nir-report-view-title");
  const meta = document.getElementById("nir-report-view-meta");
  const content = document.getElementById("nir-report-view-content");
  if (title) title.textContent = `Relatório de ${report.authorName || "-"}`;
  if (meta) meta.textContent = `${report.operationalDay ? `Dia ${toBRDate(report.operationalDay)}` : "-"}${report.updatedAt ? ` • Atualizado em ${toBRDateTime(report.updatedAt)}` : ""}`;
  if (content) {
    content.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = report.content || "";
    content.appendChild(text);
  }
  document.getElementById("modal-nir-report-view")?.showModal();
}

function getNirTrackingPresentation(patient = {}) {
  const request = patient?.currentAdmission?.nirRequest || {};
  const regulationChannels = Array.isArray(patient.regulationChannels) && patient.regulationChannels.length
    ? formatNirChannels(patient.regulationChannels)
    : (Array.isArray(patient.nirUpdateChannels) && patient.nirUpdateChannels.length
      ? formatNirChannels(patient.nirUpdateChannels)
      : "-");
  if (!hasNirRequest(patient)) {
    return {
      label: "Inativo",
      className: "none",
      meta: "Aguardando sinalização do setor."
    };
  }
  if (patient?.nirDischargePending) {
    return {
      label: "Em acompanhamento",
      className: "in-progress",
      meta: patient.nirDischargeNote || "Setor deu alta. Finalize o acompanhamento no NIR."
    };
  }
  if (String(patient.nirWorkflowStatus || "").toUpperCase() === "EM_ACOMPANHAMENTO" || String(request.status || "").toUpperCase() === "EM_ACOMPANHAMENTO") {
    return {
      label: "Em acompanhamento",
      className: "in-progress",
      meta: patient.nirAcceptedLocation
        ? `Aceito para ${patient.nirAcceptedLocation} em ${toBRDateTime(patient.regulationAcceptedAt) || "-"}`
        : `Aceito em ${toBRDateTime(patient.regulationAcceptedAt) || "-"}`
    };
  }
  if (request.viewedAt) {
    return {
      label: "Visualizada",
      className: "done",
      meta: request.viewedBy
        ? `Visto por ${request.viewedBy}`
        : `Visto em ${toBRDateTime(request.viewedAt) || "-"}`
    };
  }
  return {
    label: "Aceitar",
    className: "pending",
    meta: request.requestedBy
      ? `Solicitado por ${request.requestedBy}`
      : `Solicitado em ${toBRDateTime(request.requestedAt) || "-"}`
  };
}

function buildNirChannelCell(patient = {}, channel = "") {
  const normalizedChannel = String(channel || "").toUpperCase();
  const channels = Array.isArray(patient.nirUpdateChannels)
    ? patient.nirUpdateChannels.map(item => String(item || "").toUpperCase())
    : [];
  const active = channels.includes(normalizedChannel);
  const meta = active
    ? `Salvo ${patient.nirLastUpdateAt ? `em ${toBRDateTime(patient.nirLastUpdateAt)}` : "automaticamente"}`
    : "Clique para salvar.";
  return `
    <div class="nir-support-cell">
      <label class="nir-channel-radio-wrap">
        <input type="checkbox" class="nir-channel-radio" data-id="${escapeHtml(String(patient.id || ""))}" data-channel="${escapeHtml(normalizedChannel)}" ${active ? "checked" : ""}>
        <span class="bed-request-chip ${active ? "done" : "none"}">${escapeHtml(getNirChannelLabel(normalizedChannel))}</span>
      </label>
      ${normalizedChannel === "CIL" ? `<input type="text" inputmode="numeric" maxlength="20" class="nir-sirel-input" data-id="${escapeHtml(String(patient.id || ""))}" value="${escapeHtml(patient.cil || "")}" placeholder="Numero da SIREL">` : ""}
      <div class="nir-support-meta">${escapeHtml(meta)}</div>
    </div>
  `;
}

function getSelectedNirChannels(patientId) {
  const selectors = Array.from(document.querySelectorAll(`.nir-channel-radio[data-id="${String(patientId)}"]`));
  return selectors
    .filter(input => input.checked)
    .map(input => String(input.dataset.channel || "").toUpperCase())
    .filter(channel => channel === "EMAIL" || channel === "CIL");
}

function syncPatientAcrossViews(updatedPatient = {}) {
  const patientId = String(updatedPatient?.id || "");
  if (!patientId) return;
  const mergePatient = list => list.map(item => String(item?.id || "") === patientId ? { ...item, ...updatedPatient } : item);
  nirPatients = mergePatient(nirPatients);
  nirAcceptedPatients = mergePatient(nirAcceptedPatients);
  registeredPatients = mergePatient(registeredPatients);
  portariaActivePatients = mergePatient(portariaActivePatients);
  psychologyActivePatients = mergePatient(psychologyActivePatients);
  if (String(currentPatientRecord?.id || "") === patientId) {
    currentPatientRecord = { ...currentPatientRecord, ...updatedPatient };
  }
}

async function saveNirSirelValue(patientId, value) {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || nirAcceptedPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  if (!patient) return;
  const timerKey = String(patientId || "");
  const pendingTimer = nirSirelSaveTimers.get(timerKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    nirSirelSaveTimers.delete(timerKey);
  }
  const normalizedValue = String(value || "").replace(/\D/g, "").slice(0, 20);
  if (String(patient.cil || "") === normalizedValue) return;

  try {
    const data = await api(`/api/patients/${patientId}/nir-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cil: normalizedValue,
        channels: Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : []
      })
    });
    if (data?.patient) {
      syncPatientAcrossViews(data.patient);
      await loadNirPatientsView();
    }
    setNirFeedback(`Numero da SIREL salvo para ${patient.nome || "o paciente"}.`);
  } catch (error) {
    setNirFeedback(error.message || "Nao foi possivel salvar o numero da SIREL.", true);
  }
}

function scheduleNirSirelSave(patientId, value) {
  const timerKey = String(patientId || "");
  if (!timerKey) return;
  const existingTimer = nirSirelSaveTimers.get(timerKey);
  if (existingTimer) clearTimeout(existingTimer);
  nirSirelSaveTimers.set(timerKey, window.setTimeout(async () => {
    nirSirelSaveTimers.delete(timerKey);
    await saveNirSirelValue(timerKey, value);
  }, 450));
}

function renderNirPatients(items) {
  nirPatients = Array.isArray(items) ? items : [];
  const container = document.getElementById("nir-list");
  const empty = document.getElementById("nir-list-empty");
  const dateLabel = document.getElementById("nir-report-date");
  const nurseLabel = document.getElementById("nir-report-nurse");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", nirPatients.length > 0);
  if (dateLabel) dateLabel.textContent = `DATA: ${toBRDate(getOperationalDayKey(new Date())) || "-"}`;
  if (nurseLabel) nurseLabel.textContent = `ENFERMEIRO: ${currentUser?.nome || currentUser?.username || "-"}`;

  for (const patient of nirPatients) {
    const row = document.createElement("tr");
    const current = patient.currentAdmission || patient.lastAdmission || {};
    const currentWard = current?.wardNome || "-";
    const currentBed = current?.bedId || "-";
    const admittedAt = current?.admittedAt ? toBRDate(current.admittedAt) : "-";
    const regulationDate = patient.updatedAt ? toBRDate(String(patient.updatedAt).slice(0, 10)) : "-";
    const nirStatus = getNirTrackingPresentation(patient);
    const acceptedLabel = patient.regulationAcceptedAt ? `Aceito em ${toBRDateTime(patient.regulationAcceptedAt)}` : "Ainda aguardando aceite";
    row.innerHTML = `
      <td>${currentWard}</td>
      <td>
        <strong>${patient.nome || "-"}</strong>
        <span>CPF ${formatCpf(patient.cpf || "") || "-"}</span>
        <span>${patient.diagnostico || "-"}</span>
      </td>
      <td>${currentBed}</td>
      <td>${admittedAt}</td>
      <td>
        <div class="nir-support-cell">
          <div class="bed-request-chip ${nirStatus.className}">${escapeHtml(nirStatus.label)}</div>
          <div class="nir-support-meta">${escapeHtml(nirStatus.meta)}</div>
          <div class="nir-support-meta">${escapeHtml(patient.nir || "-")}${patient.cil ? ` • SIREL ${escapeHtml(patient.cil)}` : ""}</div>
        </div>
      </td>
      <td>${buildNirChannelCell(patient, "EMAIL")}</td>
      <td>${buildNirChannelCell(patient, "CIL")}</td>
      <td>${regulationDate}</td>
      <td>
        <div class="nir-actions">
          <button type="button" class="ghost btn-nir-open" data-id="${patient.id}">Abrir</button>
          <button type="button" class="ghost btn-nir-accept" data-id="${patient.id}" title="${acceptedLabel}">Aceitar</button>
        </div>
      </td>
    `;
    container.appendChild(row);
  }
}

function renderNirAcceptedPatients(items) {
  nirAcceptedPatients = Array.isArray(items) ? items : [];
  const container = document.getElementById("nir-accepted-list");
  const empty = document.getElementById("nir-accepted-list-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", nirAcceptedPatients.length > 0);

  for (const patient of nirAcceptedPatients) {
    const row = document.createElement("tr");
    const current = patient.currentAdmission || patient.lastAdmission || {};
    const currentWard = current?.wardNome || "-";
    const currentBed = current?.bedId || "-";
    const admittedAt = current?.admittedAt ? toBRDate(current.admittedAt) : "-";
    const acceptedAt = patient.regulationAcceptedAt ? toBRDateTime(patient.regulationAcceptedAt) : "-";
    const nirStatus = getNirTrackingPresentation(patient);
    row.innerHTML = `
      <td>${currentWard}</td>
      <td>
        <strong>${patient.nome || "-"}</strong>
        <span>CPF ${formatCpf(patient.cpf || "") || "-"}</span>
        <span>${patient.diagnostico || "-"}</span>
      </td>
      <td>${currentBed}</td>
      <td>${admittedAt}</td>
      <td>
        <div class="nir-support-cell">
          <div class="bed-request-chip ${nirStatus.className}">${escapeHtml(nirStatus.label)}</div>
          <div class="nir-support-meta">${escapeHtml(nirStatus.meta)}</div>
          <div class="nir-support-meta">${escapeHtml(patient.nir || "-")}${patient.cil ? ` • SIREL ${escapeHtml(patient.cil)}` : ""}</div>
        </div>
      </td>
      <td>${buildNirChannelCell(patient, "EMAIL")}</td>
      <td>${buildNirChannelCell(patient, "CIL")}</td>
      <td>${acceptedAt}</td>
      <td>
        <div class="nir-actions">
          <button type="button" class="ghost btn-nir-open" data-id="${patient.id}">Abrir</button>
          <button type="button" class="ghost btn-nir-close" data-id="${patient.id}">Dar baixa</button>
          <button type="button" class="ghost btn-nir-cancel" data-id="${patient.id}">Cancelado</button>
        </div>
      </td>
    `;
    container.appendChild(row);
  }
}

async function markNirPatientUpdated(patientId, forcedChannels = []) {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || nirAcceptedPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  if (!patient) return;

  let channels = Array.isArray(forcedChannels)
    ? forcedChannels.map(item => String(item || "").toUpperCase()).filter(item => item === "EMAIL" || item === "CIL")
    : [];
  if (!channels.length) {
    const updatedSirel = window.confirm(`Paciente: ${patient.nome || "-"}\n\nHouve atualização no SIREL?`);
    const updatedEmail = window.confirm(`Paciente: ${patient.nome || "-"}\n\nHouve atualização no EMAIL?`);
    if (updatedSirel) channels.push("CIL");
    if (updatedEmail) channels.push("EMAIL");
  }
  channels = Array.from(new Set(channels));

  if (!channels.length) {
    setNirFeedback("Nenhuma atualização foi registrada para este paciente.", true);
    return;
  }

  try {
    await api(`/api/patients/${patientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: patient.nome || "",
        cpf: normalizeCpf(patient.cpf || ""),
        birthDate: patient.birthDate || "",
        diagnostico: patient.diagnostico || "",
        nir: patient.nir || "",
        cil: patient.cil || "",
        regulationChannels: patient.regulationChannels || [],
        nirLastUpdateAt: new Date().toISOString(),
        nirLastUpdateBy: currentUser?.nome || currentUser?.username || "",
        nirUpdateChannels: channels,
        nirHistory: [
          {
            status: `CANAL ${formatNirChannels(channels)}`,
            at: new Date().toISOString(),
            by: currentUser?.nome || currentUser?.username || "",
            channel: formatNirChannels(channels)
          },
          ...(Array.isArray(patient.nirHistory) ? patient.nirHistory : [])
        ].slice(0, 20)
      })
    });
    await loadNirPatientsView();
    setNirFeedback(`Atualização registrada para ${patient.nome || "o paciente"}: ${formatNirChannels(channels)}.`);
  } catch (error) {
    setNirFeedback(error.message || "Não foi possível registrar a atualização do NIR.", true);
  }
}

async function markNirPatientAccepted(patientId) {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || nirAcceptedPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  if (!patient) return;
  const location = window.prompt(`Paciente: ${patient.nome || "-"}\n\nInforme o local do aceite:`)?.trim() || "";
  if (!location) {
    setNirFeedback("Informe o local do aceite para salvar.", true);
    return;
  }

  try {
    const now = new Date().toISOString();
    if (patient.currentAdmission?.wardId && patient.currentAdmission?.bedId) {
      const currentRequest = patient.currentAdmission?.nirRequest || {};
      await api(`/api/wards/${patient.currentAdmission.wardId}/beds/${patient.currentAdmission.bedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nirRequest: {
            ...currentRequest,
            requested: true,
            requestedAt: currentRequest.requestedAt || new Date().toISOString(),
            requestedBy: currentRequest.requestedBy || currentUser?.nome || currentUser?.username || "",
            viewedAt: currentRequest.viewedAt || new Date().toISOString(),
            viewedBy: currentRequest.viewedBy || currentUser?.nome || currentUser?.username || "",
            startedAt: currentRequest.startedAt || new Date().toISOString(),
            startedBy: currentRequest.startedBy || currentUser?.nome || currentUser?.username || "",
            closedAt: "",
            closedBy: "",
            observation: location,
            status: "EM_ACOMPANHAMENTO"
          }
        })
      });
    }
    await api(`/api/patients/${patientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: patient.nome || "",
        cpf: normalizeCpf(patient.cpf || ""),
        birthDate: patient.birthDate || "",
        diagnostico: patient.diagnostico || "",
        nir: patient.nir || "",
        cil: patient.cil || "",
        regulationChannels: patient.regulationChannels || [],
        regulationAcceptedAt: now,
        nirLastUpdateAt: patient.nirLastUpdateAt || "",
        nirLastUpdateBy: patient.nirLastUpdateBy || "",
        nirUpdateChannels: patient.nirUpdateChannels || [],
        nirWorkflowStatus: "EM_ACOMPANHAMENTO",
        nirAcceptedLocation: location,
        nirActionReason: "",
        nirStatusUpdatedAt: now,
        nirStatusUpdatedBy: currentUser?.nome || currentUser?.username || "",
        nirDischargePending: false,
        nirDischargeNote: "",
        nirDischargeAt: "",
        nirDischargeBy: "",
        nirHistory: [
          {
            status: "ACEITO",
            at: now,
            by: currentUser?.nome || currentUser?.username || "",
            location
          },
          ...(Array.isArray(patient.nirHistory) ? patient.nirHistory : [])
        ].slice(0, 20)
      })
    });
    await loadNirPatientsView();
    setNirFeedback(`Paciente ${patient.nome || "-"} aceito para ${location}.`);
  } catch (error) {
    setNirFeedback(error.message || "Não foi possível marcar o paciente como aceito.", true);
  }
}

async function finalizeNirPatient(patientId, mode = "") {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || nirAcceptedPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  if (!patient) return;
  const normalizedMode = String(mode || "").trim().toUpperCase();
  const promptLabel = normalizedMode === "CANCELADO"
    ? "Justifique o motivo do cancelamento:"
    : "Informe o motivo da baixa:";
  const reason = window.prompt(`Paciente: ${patient.nome || "-"}\n\n${promptLabel}`)?.trim() || "";
  if (!reason) {
    setNirFeedback("Informe o motivo para salvar.", true);
    return;
  }

  try {
    const now = new Date().toISOString();
    if (patient.currentAdmission?.wardId && patient.currentAdmission?.bedId) {
      const currentRequest = patient.currentAdmission?.nirRequest || {};
      await api(`/api/wards/${patient.currentAdmission.wardId}/beds/${patient.currentAdmission.bedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nirRequest: {
            ...currentRequest,
            requested: false,
            viewedAt: currentRequest.viewedAt || "",
            viewedBy: currentRequest.viewedBy || "",
            startedAt: currentRequest.startedAt || "",
            startedBy: currentRequest.startedBy || "",
            closedAt: now,
            closedBy: currentUser?.nome || currentUser?.username || "",
            observation: reason,
            status: "BAIXA"
          }
        })
      });
    }
    await api(`/api/patients/${patientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: patient.nome || "",
        cpf: normalizeCpf(patient.cpf || ""),
        birthDate: patient.birthDate || "",
        diagnostico: patient.diagnostico || "",
        nir: patient.nir || "",
        cil: patient.cil || "",
        regulationChannels: patient.regulationChannels || [],
        regulationAcceptedAt: patient.regulationAcceptedAt || "",
        nirLastUpdateAt: patient.nirLastUpdateAt || "",
        nirLastUpdateBy: patient.nirLastUpdateBy || "",
        nirUpdateChannels: patient.nirUpdateChannels || [],
        nirWorkflowStatus: normalizedMode,
        nirAcceptedLocation: patient.nirAcceptedLocation || "",
        nirActionReason: reason,
        nirStatusUpdatedAt: now,
        nirStatusUpdatedBy: currentUser?.nome || currentUser?.username || "",
        nirDischargePending: false,
        nirDischargeNote: "",
        nirDischargeAt: "",
        nirDischargeBy: "",
        nirHistory: [
          {
            status: normalizedMode,
            at: now,
            by: currentUser?.nome || currentUser?.username || "",
            reason
          },
          ...(Array.isArray(patient.nirHistory) ? patient.nirHistory : [])
        ].slice(0, 20)
      })
    });
    await loadNirPatientsView();
    setNirFeedback(`Paciente ${patient.nome || "-"} atualizado como ${normalizedMode === "CANCELADO" ? "cancelado" : "baixa"}.`);
  } catch (error) {
    setNirFeedback(error.message || "Não foi possível salvar a atualização do NIR.", true);
  }
}

async function activateNirSupportRequest(patientId, requestKey) {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || nirAcceptedPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  const admission = patient?.currentAdmission || null;
  if (!patient || !admission?.wardId || !admission?.bedId) return;

  const wardId = Number(admission.wardId);
  const bedId = Number(admission.bedId);
  const actor = currentUser?.nome || currentUser?.username || "";
  const now = new Date().toISOString();

  let payload = null;
  if (requestKey === "psychologyRequest") {
    payload = {
      psychologyRequest: buildPsychologyRequestPayload(admission.psychologyRequest || {}, "SOLICITADO", {})
    };
  } else {
    payload = {
      serviceSocialRequest: {
        ...(admission.serviceSocialRequest || {}),
        requested: true,
        requestedAt: now,
        requestedBy: actor,
        viewedAt: "",
        viewedBy: "",
        startedAt: "",
        startedBy: "",
        closedAt: "",
        closedBy: "",
        observation: "",
        status: "SOLICITADO"
      }
    };
  }

  try {
    await api(`/api/wards/${wardId}/beds/${bedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    await loadNirPatientsView();
    setNirFeedback(`${requestKey === "psychologyRequest" ? "Psicologia" : "Serviço Social"} ativado(a) para ${patient.nome || "o paciente"}.`);
  } catch (error) {
    setNirFeedback(error.message || "Não foi possível ativar a solicitação pelo NIR.", true);
  }
}

async function buildPatientsFallbackList() {
  const wardsData = await api("/api/wards");
  const wardItems = wardsData.wards || [];
  const patients = [];

  for (const wardItem of wardItems) {
    const wardData = await api(`/api/wards/${wardItem.id}`);
    for (const bed of wardData.beds || []) {
      if (!String(bed.nome || "").trim()) continue;
      patients.push({
        id: `bed-${wardItem.id}-${bed.id}`,
        nome: bed.nome || "",
        cpf: bed.cpf || "",
        birthDate: bed.birthDate || "",
        diagnostico: bed.diagnostico || "",
        nir: bed.nir || "",
        cil: bed.cil || "",
        regulationChannels: [],
        regulationAcceptedAt: "",
        nirLastUpdateAt: "",
        nirLastUpdateBy: "",
        nirUpdateChannels: [],
        createdAt: "",
        updatedAt: "",
        admissionCount: 1,
        currentAdmission: {
          wardId: wardItem.id,
          wardNome: wardData.nome || wardItem.nome || "",
          bedId: bed.id,
          enfermaria: bed.enfermaria || "",
          admittedAt: bed.admissao || "",
          active: true,
          nirRequest: bed.nirRequest || { requested: false },
          serviceSocialRequest: bed.serviceSocialRequest || { requested: false },
          psychologyRequest: bed.psychologyRequest || { requested: false }
        },
        admissionHistory: [{
          wardId: wardItem.id,
          wardNome: wardData.nome || wardItem.nome || "",
          bedId: bed.id,
          enfermaria: bed.enfermaria || "",
          admittedAt: bed.admissao || "",
          dischargedAt: null,
          outcome: null,
          transferHistory: []
        }],
        fallbackWardId: wardItem.id,
        fallbackBedId: bed.id
      });
    }
  }

  return patients;
}

async function loadNirPatientsView() {
  try {
    const data = await api("/api/patients");
    const signaledPatients = (data.patients || [])
      .filter(hasNirRequest)
      .map(patient => ({
        ...patient,
        currentAdmission: patient.currentAdmission || (patient.lastAdmission ? {
          ...patient.lastAdmission,
          active: false,
          nirRequest: patient.lastAdmission?.nirRequest || { requested: false }
        } : null)
      }))
      .filter(patient => patient.currentAdmission || patient.lastAdmission)
      .sort((a, b) =>
        String((a.currentAdmission?.wardNome || a.lastAdmission?.wardNome || "")).localeCompare(String((b.currentAdmission?.wardNome || b.lastAdmission?.wardNome || "")), "pt-BR")
        || Number(a.currentAdmission?.bedId || a.lastAdmission?.bedId || 0) - Number(b.currentAdmission?.bedId || b.lastAdmission?.bedId || 0)
        || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
      );
    nirAcceptedPatients = signaledPatients.filter(patient => String(patient.regulationAcceptedAt || "").trim());
    const activePatients = signaledPatients.filter(patient => !String(patient.regulationAcceptedAt || "").trim());
    renderNirPatients(activePatients);
    renderNirAcceptedPatients(nirAcceptedPatients);
    await loadNirReports();
    setNirFeedback(`${signaledPatients.length} paciente(s) sinalizado(s) ao NIR.`);
    return signaledPatients;
  } catch (error) {
    try {
      const fallback = await buildPatientsFallbackList();
      const signaledPatients = fallback
        .filter(patient => patient.currentAdmission)
        .filter(hasNirRequest)
        .sort((a, b) =>
          String(a.currentAdmission?.wardNome || "").localeCompare(String(b.currentAdmission?.wardNome || ""), "pt-BR")
          || Number(a.currentAdmission?.bedId || 0) - Number(b.currentAdmission?.bedId || 0)
          || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
        );
      nirAcceptedPatients = signaledPatients.filter(patient => String(patient.regulationAcceptedAt || "").trim());
      const activePatients = signaledPatients.filter(patient => !String(patient.regulationAcceptedAt || "").trim());
      renderNirPatients(activePatients);
      renderNirAcceptedPatients(nirAcceptedPatients);
      renderNirPreviousReports([], []);
      renderNirCurrentReport(null);
      setNirReportFeedback("O relatório do NIR depende da API principal ativa.", true);
      setNirFeedback("Lista do NIR carregada pelos leitos atuais sinalizados enquanto a API completa não responde.");
      return signaledPatients;
    } catch (fallbackError) {
      renderNirPatients([]);
      nirAcceptedPatients = [];
      renderNirAcceptedPatients([]);
      renderNirPreviousReports([], []);
      setNirFeedback(fallbackError.message || error.message || "Não foi possível carregar a lista do NIR.", true);
      return [];
    }
  }
}

async function loadPatientsRegistry() {
  const search = document.getElementById("patients-search")?.value?.trim() || "";
  const active = document.getElementById("patients-active-filter")?.value || "";
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (active) params.set("active", active);
  const query = params.toString() ? `?${params.toString()}` : "";

  try {
    const data = await api(`/api/patients${query}`);
    renderRegisteredPatients(data.patients || []);
    setPatientsFeedback(`${(data.patients || []).length} paciente(s) carregado(s).`);
    return data.patients || [];
  } catch (error) {
    try {
      let fallbackPatients = await buildPatientsFallbackList();
      const searchDigits = normalizeCpf(search);
      const searchUpper = String(search || "").trim().toUpperCase();

      if (searchUpper) {
        fallbackPatients = fallbackPatients.filter(patient =>
          String(patient.nome || "").toUpperCase().includes(searchUpper)
          || (searchDigits && normalizeCpf(patient.cpf).includes(searchDigits))
        );
      }

      if (active === "true") fallbackPatients = fallbackPatients.filter(patient => Boolean(patient.currentAdmission));
      if (active === "false") fallbackPatients = fallbackPatients.filter(patient => !patient.currentAdmission);

      renderRegisteredPatients(fallbackPatients);
      setPatientsFeedback("Lista carregada pelos leitos atuais enquanto a API completa de pacientes não responde.");
      return fallbackPatients;
    } catch (fallbackError) {
      renderRegisteredPatients([]);
      setPatientsFeedback(fallbackError.message || error.message || "Não foi possível carregar os pacientes.", true);
      return [];
    }
  }
}

async function openPatientRegistry(patientId) {
  const fallbackPatient = registeredPatients.find(item => String(item.id) === String(patientId));
  if (String(patientId).startsWith("bed-") && fallbackPatient) {
    fillPatientRegistryModal(fallbackPatient);
    document.getElementById("patient-registry-save").disabled = true;
    document.getElementById("patient-registry-delete").disabled = true;
    document.getElementById("modal-patient-registry").showModal();
    return;
  }

  const data = await api(`/api/patients/${patientId}`);
  fillPatientRegistryModal(data.patient);
  document.getElementById("patient-registry-save").disabled = false;
  document.getElementById("modal-patient-registry").showModal();
}

function renderPendingHistory(items) {
  const container = document.getElementById("modal-pendencias-historico");
  if (!container) return;
  container.innerHTML = "";
  if (!items?.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "Nenhuma pendência cadastrada.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("label");
    row.className = "history-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "pendencia-status";
    checkbox.dataset.id = item.id;
    checkbox.checked = item.status === "FINALIZADA";
    const content = document.createElement("div");
    content.className = "history-content";
    const title = document.createElement("strong");
    title.textContent = item.texto;
    const badge = document.createElement("span");
    badge.className = `history-badge ${item.status === "FINALIZADA" ? "done" : "active"}`;
    badge.textContent = item.status === "FINALIZADA" ? "Finalizada" : "Ativa";
    const meta = document.createElement("span");
    meta.textContent = item.status === "FINALIZADA"
      ? `Aberta por ${item.createdBy || "-"} em ${toBRDateTime(item.createdAt)} • Finalizada por ${item.finishedBy || "-"} em ${toBRDateTime(item.finishedAt)}`
      : `Aberta por ${item.createdBy || "-"} em ${toBRDateTime(item.createdAt)}`;
    content.append(title, badge, meta);
    row.append(checkbox, content);
    container.appendChild(row);
  }
}

function renderProcedureHistory(items) {
  const container = document.getElementById("modal-procedimentos-historico");
  if (!container) return;
  container.innerHTML = "";
  if (!items?.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "Nenhum procedimento registrado.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";
    const content = document.createElement("div");
    content.className = "history-content";
    const title = document.createElement("strong");
    title.textContent = item.tipo;
    const meta = document.createElement("span");
    meta.textContent = `Registrado por ${item.createdBy || "-"} em ${toBRDateTime(item.createdAt)}`;
    content.append(title, meta);
    row.append(content);
    container.appendChild(row);
  }
}

function renderCurrentUser() {
  const userName = currentUser?.nome || currentUser?.username || "-";
  const role = currentUser?.role || "-";
  const activeShift = currentUser?.activeShift || null;
  syncAdminAccess();
  const topbarUser = document.getElementById("topbar-user");
  if (topbarUser) topbarUser.textContent = userName;
  const avatar = document.getElementById("profile-avatar");
  if (avatar) avatar.textContent = userName.charAt(0).toUpperCase() || "U";
  const roleSummary = document.getElementById("profile-role-summary");
  if (roleSummary) roleSummary.textContent = `Perfil ${role}`;
  const shiftSummary = document.getElementById("profile-shift-status");
  if (shiftSummary) shiftSummary.textContent = activeShift ? "Aberto" : "Fechado";
  const currentWardLabel = document.getElementById("profile-current-ward");
  if (currentWardLabel) currentWardLabel.textContent = activeShift?.wardNome || ward?.nome || "-";
  const shiftStatusLabel = document.getElementById("shift-status-label");
  if (shiftStatusLabel) shiftStatusLabel.textContent = activeShift ? "Aberto" : "Fechado";
  const shiftStatusMeta = document.getElementById("shift-status-meta");
  if (shiftStatusMeta) {
    shiftStatusMeta.textContent = activeShift
      ? `${activeShift.wardNome} • ${toBRDate(activeShift.shiftDate || getTodayIsoDate())} • ${activeShift.shiftLength || "12H"} • ${getShiftPeriodLabel(activeShift.shiftPeriod)} • início ${toBRDateTime(activeShift.openedAt)}`
      : "Nenhum plantão aberto";
  }

  const shiftWard = document.getElementById("shift-ward");
  const shiftLength = document.getElementById("shift-length");
  const shiftPeriod = document.getElementById("shift-period");
  if (shiftWard) {
    if (activeShift) shiftWard.value = String(activeShift.wardId);
    else if (currentWardId) shiftWard.value = String(currentWardId);
    shiftWard.disabled = Boolean(activeShift);
  }
  if (shiftLength) {
    shiftLength.value = activeShift?.shiftLength || "12H";
    shiftLength.disabled = Boolean(activeShift);
  }
  if (shiftPeriod) {
    shiftPeriod.value = activeShift?.shiftPeriod || "DIA";
  }
  const shiftNursingReport = document.getElementById("shift-nursing-report");
  const saveShiftNursingReportButton = document.getElementById("btn-save-shift-nursing-report");
  if (shiftNursingReport) {
    shiftNursingReport.value = activeShift?.nursingReport || "";
    shiftNursingReport.disabled = !activeShift;
  }

  const openButton = document.getElementById("btn-open-shift");
  const closeButton = document.getElementById("btn-close-shift");
  const openTeamButton = document.getElementById("btn-open-team-modal");
  if (openButton) openButton.disabled = Boolean(activeShift);
  if (closeButton) closeButton.disabled = !activeShift;
  if (openTeamButton) openTeamButton.disabled = !activeShift;
  if (saveShiftNursingReportButton) saveShiftNursingReportButton.disabled = !activeShift;
  syncWardShiftEntryState();
  syncShiftFormVisibility();
  renderPsychologyShiftPanel();
  renderSocialServiceShiftPanel();
  renderShiftTeamForm();
  renderShiftTeamSummary();
  renderShiftHistory();
}

async function refreshCurrentUser() {
  const data = await api("/api/me");
  currentUser = data.user || null;
  renderCurrentUser();
  return currentUser;
}

function isPsychologyViewVisible() {
  return !document.getElementById("view-psychology")?.classList.contains("hidden");
}

function buildPsychologyPrintRows(items = []) {
  return (Array.isArray(items) ? items : []).map((patient, index) => ({
    number: String(index + 1).padStart(2, "0"),
    sector: patient?.currentAdmission?.wardNome || "-",
    bed: String(patient?.currentAdmission?.bedId || "-"),
    patient: patient?.nome || "-",
    age: getPatientAgeLabel(patient?.birthDate) || "-",
    interventions: patient?.psychologySupport?.interventions || "",
    observation: patient?.psychologySupport?.observation || ""
  }));
}

function buildSocialServicePrintRows(items = []) {
  return (Array.isArray(items) ? items : []).map(patient => {
    const socialSupport = createSocialSupportState(patient?.socialSupport);
    const socialRecordMeta = socialSupport.socialRecord === "Concluído" && socialSupport.socialRecordUpdatedAt
      ? `Concluído por ${socialSupport.socialRecordUpdatedBy || "-"} em ${toBRDateTime(socialSupport.socialRecordUpdatedAt) || "-"}`
      : "";
    return {
      bed: String(patient?.currentAdmission?.bedId || "-"),
      sector: patient?.currentAdmission?.wardNome || "-",
      patient: patient?.nome || "-",
      age: getPatientAgeLabel(patient?.birthDate) || "-",
      contacts: getSocialServiceContactValue(patient),
      admission: toBRDate(patient?.currentAdmission?.admittedAt) || "-",
      socialRecord: socialSupport.socialRecord || "",
      socialRecordMeta,
      observation: socialSupport.observation || "",
      updatedAt: socialSupport.updatedAt || "",
      updatedBy: socialSupport.updatedBy || ""
    };
  });
}

function printPsychologyShiftReport(report) {
  if (!report) return;
  const rows = Array.isArray(report.psychologyRows) ? report.psychologyRows : [];
  const fixedRows = Array.from({ length: 14 }, (_, index) => rows[index] || {
    number: String(index + 1).padStart(2, "0"),
    sector: "",
    bed: "",
    patient: "",
    age: "",
    interventions: "",
    observation: ""
  });
  const shiftDate = report.shift?.shiftDate || String(report.shift?.closedAt || "").slice(0, 10) || getTodayIsoDate();
  const shiftPeriod = String(report.shift?.shiftPeriod || "DIA").trim().toUpperCase();
  const markTurn = option => shiftPeriod === option || shiftPeriod === "COMPLETO" ? "X" : " ";
  const totalPatients = rows.filter(item => String(item.patient || "").trim()).length;
  const legendColumns = [
    ["AP - Avaliacao Psicologica", "RP - Reavaliacao Psicologica", "AQ - Acolhimento / Escuta Qualificada", "PE - Psicoeducacao / Orientacao"],
    ["AF - Atendimento Familiar", "IC - Intervencao em Crise", "RS - Avaliacao de Risco Suicida", "LO - Acolhimento ao Obito / Luto"],
    ["AM - Articulacao Multiprofissional", "EN - Encaminhamento", "CM - Comunicacao de Mas Noticias", "OU - Outros"]
  ];
  const tableRows = fixedRows.map(row => `
    <tr>
      <td class="num">${escapeHtml(row.number)}</td>
      <td>${escapeHtml(row.sector)}</td>
      <td>${escapeHtml(row.bed)}</td>
      <td>${escapeHtml(row.patient)}</td>
      <td>${escapeHtml(row.age)}</td>
      <td class="notes">${escapeHtml(row.interventions)}</td>
      <td class="notes">${escapeHtml(row.observation)}</td>
    </tr>
  `).join("");
  const legendHtml = legendColumns.map(items => `
    <div class="legend-col">
      ${items.map(item => `<div>${escapeHtml(item)}</div>`).join("")}
    </div>
  `).join("");
  const win = window.open("", "_blank", "width=1200,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Mapa Diario de Atividades - Psicologia</title><style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #f3f6fb; color: #0f172a; padding: 18px; }
    .sheet { width: 1120px; margin: 0 auto; background: #fff; padding: 18px 18px 14px; border: 1px solid #a6b7d0; }
    .top { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 14px; align-items: start; }
    .logo { display: grid; place-items: center; text-align: center; color: #0f4c81; font-weight: 900; }
    .logo-mark { font-size: 54px; line-height: 0.9; letter-spacing: -2px; }
    .logo-sub { font-size: 10px; line-height: 1.1; }
    .title { text-align: center; }
    .title .line-1 { font-size: 18px; font-weight: 900; color: #143b63; }
    .title .line-2 { font-size: 18px; font-weight: 900; color: #143b63; }
    .title .badge { margin: 6px auto 0; width: 70%; padding: 4px 10px; border-radius: 4px; background: #cfe0f4; font-size: 16px; font-weight: 900; color: #143b63; }
    .meta { display: grid; grid-template-columns: 50px 120px 320px 80px 1fr 40px 90px; gap: 8px; align-items: end; margin-top: 10px; font-size: 13px; font-weight: 700; }
    .line { border-bottom: 1px solid #243b53; min-height: 18px; }
    .turn { display: flex; gap: 8px; font-size: 12px; font-weight: 700; align-items: center; white-space: nowrap; }
    .turn span { display: inline-flex; gap: 3px; align-items: center; }
    .table-wrap { margin-top: 10px; border: 1px solid #7e93ae; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #7e93ae; padding: 4px 6px; font-size: 12px; vertical-align: top; }
    th { background: #cfe0f4; color: #10283d; font-size: 11px; font-weight: 900; text-transform: uppercase; text-align: center; }
    th small { display: block; font-size: 9px; text-transform: none; line-height: 1.1; }
    td { height: 30px; }
    td.num { width: 38px; text-align: center; font-weight: 700; }
    td.notes { width: 260px; white-space: pre-wrap; }
    .footer { display: grid; grid-template-columns: minmax(0, 2.2fr) 130px minmax(0, 1fr); gap: 10px; margin-top: 10px; align-items: start; }
    .box-title { background: #cfe0f4; color: #143b63; font-size: 11px; font-weight: 900; padding: 4px 6px; }
    .legend { border: 1px solid #a8b8cf; }
    .legend-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 6px 8px 8px; font-size: 11px; line-height: 1.5; }
    .total-box { border: 1px solid #a8b8cf; }
    .total-body { min-height: 72px; display: grid; place-items: center; font-size: 28px; font-weight: 900; color: #143b63; }
    .general-box { border: 1px solid #a8b8cf; }
    .general-body { min-height: 72px; padding: 8px; display: grid; gap: 12px; }
    .general-line { border-bottom: 1px solid #7e93ae; }
    .footer-note { margin-top: 8px; text-align: right; font-size: 10px; font-weight: 700; color: #274c77; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { width: auto; margin: 0; border: 0; }
    }
  </style></head><body>
    <div class="sheet">
      <div class="top">
        <div class="logo">
          <div class="logo-mark">HMA</div>
          <div class="logo-sub">HOSPITAL MUNICIPAL DE ACAILANDIA<br>URGENCIA E EMERGENCIA</div>
        </div>
        <div class="title">
          <div class="line-1">HOSPITAL MUNICIPAL DE ACAILANDIA - HMA</div>
          <div class="line-2">SERVICO DE PSICOLOGIA HOSPITALAR</div>
          <div class="badge">MAPA DIARIO DE ATIVIDADES</div>
        </div>
      </div>
      <div class="meta">
        <div>Data:</div>
        <div class="line">${escapeHtml(toBRDate(shiftDate) || "-")}</div>
        <div class="turn">
          <span>Turno:</span>
          <span>(${markTurn("DIA")}) Manha</span>
          <span>(${markTurn("TARDE")}) Tarde</span>
          <span>(${markTurn("NOITE")}) Noite</span>
        </div>
        <div>Psicologo(a):</div>
        <div class="line">${escapeHtml(currentUser?.nome || currentUser?.username || report.shift?.nome || report.shift?.username || "-")}</div>
        <div>CRP:</div>
        <div class="line"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nº</th>
              <th>Setor</th>
              <th>Leito</th>
              <th>Paciente</th>
              <th>Idade</th>
              <th>Intervenções Psicológicas<small>(usar siglas da legenda)</small></th>
              <th>Observações</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="footer">
        <div class="legend">
          <div class="box-title">LEGENDA - INTERVENCOES PSICOLOGICAS (SIGLAS)</div>
          <div class="legend-body">${legendHtml}</div>
        </div>
        <div class="total-box">
          <div class="box-title">TOTAL DE PACIENTES REGISTRADOS:</div>
          <div class="total-body">${escapeHtml(String(totalPatients))}</div>
        </div>
        <div class="general-box">
          <div class="box-title">OBSERVACOES GERAIS:</div>
          <div class="general-body">
            <div class="general-line"></div>
            <div class="general-line"></div>
            <div class="general-line"></div>
          </div>
        </div>
      </div>
      <div class="footer-note">HMA - A servico da vida.</div>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
}

function printSocialServiceShiftReport(report) {
  if (!report) return;
  const rows = Array.isArray(report.socialServiceRows) ? report.socialServiceRows : [];
  const fixedRows = Array.from({ length: 10 }, (_, index) => rows[index] || {
    bed: String(index + 1),
    patient: "",
    age: "",
    contacts: "",
    admission: "",
    socialRecord: "",
    observation: ""
  });
  const shiftDate = report.shift?.shiftDate || String(report.shift?.closedAt || "").slice(0, 10) || getTodayIsoDate();
  const shiftPeriod = String(report.shift?.shiftPeriod || "DIA").trim().toUpperCase();
  const markTurn = option => shiftPeriod === option || shiftPeriod === "COMPLETO" ? "X" : " ";
  const tableRows = fixedRows.map(row => `
    <tr>
      <td class="bed">${escapeHtml(row.bed)}</td>
      <td>${escapeHtml(row.patient)}</td>
      <td class="age">${escapeHtml(row.age)}</td>
      <td>${escapeHtml(row.contacts)}</td>
      <td class="admission">${escapeHtml(toBRDate(row.admission) || row.admission || "-")}</td>
      <td>${escapeHtml(row.socialRecord)}${row.socialRecordMeta ? `<div class="status-meta">${escapeHtml(row.socialRecordMeta)}</div>` : ""}</td>
      <td>${escapeHtml(row.observation)}</td>
    </tr>
  `).join("");
  const win = window.open("", "_blank", "width=1280,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Mapa Diario do Serviço Social</title><style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #f3f6fb; color: #0f172a; padding: 18px; }
    .sheet { width: 1220px; margin: 0 auto; background: #fff; padding: 14px 16px; border: 1px solid #a6b7d0; }
    .header { display: grid; grid-template-columns: 220px minmax(0, 1fr) 120px; gap: 8px; align-items: start; border-bottom: 1px solid #7e93ae; padding-bottom: 6px; }
    .brand { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; align-items: start; }
    .brand-mark { font-size: 40px; font-weight: 900; color: #10283d; line-height: 1; }
    .brand-text { font-size: 11px; font-weight: 800; text-align: center; color: #10283d; }
    .title { text-align: center; padding-top: 8px; }
    .title .line-1 { font-size: 14px; font-weight: 900; color: #10283d; }
    .title .line-2 { font-size: 16px; font-weight: 900; color: #10283d; margin-top: 4px; }
    .meta { text-align: right; font-size: 11px; font-weight: 700; color: #10283d; padding-top: 10px; }
    .subheader { display: grid; grid-template-columns: minmax(0, 1fr) 160px 220px; gap: 8px; align-items: stretch; margin-top: 6px; font-size: 11px; font-weight: 700; color: #10283d; }
    .sub-box { border: 1px solid #7e93ae; padding: 4px 6px; min-height: 38px; }
    .sub-box.center { text-align: center; }
    .shift-marks { margin-top: 4px; font-size: 10px; display: flex; justify-content: center; gap: 12px; }
    .table-wrap { margin-top: 8px; border: 1px solid #7e93ae; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #7e93ae; padding: 4px 5px; font-size: 11px; vertical-align: top; }
    th { background: #ead0c2; color: #10283d; font-size: 10px; font-weight: 900; text-transform: uppercase; text-align: center; }
    td { height: 28px; }
    td.bed, td.age, td.admission { text-align: center; white-space: nowrap; }
    .status-meta { margin-top: 4px; font-size: 9px; line-height: 1.3; color: #475569; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { width: auto; margin: 0; border: 0; }
    }
  </style></head><body>
    <div class="sheet">
      <div class="header">
        <div class="brand">
          <div class="brand-mark">HMA</div>
          <div class="brand-text">HOSPITAL MUNICIPAL DE ACAILANDIA<br>URGENCIA E EMERGENCIA</div>
        </div>
        <div class="title">
          <div class="line-1">UNIDADE: HOSPITAL MUNICIPAL DE ACAILANDIA - HMA</div>
          <div class="line-2">MAPA DIARIO DO SERVICO SOCIAL</div>
        </div>
        <div class="meta">DATA ${escapeHtml(toBRDate(shiftDate) || "-")}</div>
      </div>
      <div class="subheader">
        <div class="sub-box">UNIDADE: HOSPITAL MUNICIPAL DE ACAILANDIA - HMA</div>
        <div class="sub-box center">PLANTONISTA<br><strong>${escapeHtml(currentUser?.nome || currentUser?.username || report.shift?.nome || report.shift?.username || "-")}</strong></div>
        <div class="sub-box center">
          <div class="shift-marks">
            <span>(P) ${markTurn("DIA")}</span>
            <span>(S) ${markTurn("NOITE")}</span>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Leito</th>
              <th>Paciente</th>
              <th>Idade</th>
              <th>Contatos</th>
              <th>Admissão</th>
              <th>Ficha social</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
}

function printSocialServiceSectorReport(items = []) {
  const rows = buildSocialServicePrintRows(items);
  if (!rows.length) {
    setPortariaSocialFeedback("Nao ha pacientes na planilha do Serviço Social para imprimir.", true);
    return;
  }
  const reportDate = toBRDate(getTodayIsoDate()) || "-";
  const generatedAt = toBRDateTime(new Date().toISOString()) || "-";
  const professionalName = currentUser?.nome || currentUser?.username || "-";
  const tableRows = rows.map(row => `
    <tr>
      <td class="bed">${escapeHtml(row.bed)}</td>
      <td>${escapeHtml(row.sector)}</td>
      <td>${escapeHtml(row.patient)}</td>
      <td class="age">${escapeHtml(row.age)}</td>
      <td>${escapeHtml(row.contacts)}</td>
      <td class="admission">${escapeHtml(row.admission)}</td>
      <td>${escapeHtml(row.socialRecord)}${row.socialRecordMeta ? `<div class="status-meta">${escapeHtml(row.socialRecordMeta)}</div>` : ""}</td>
      <td>${escapeHtml(row.observation)}</td>
    </tr>
  `).join("");
  const win = window.open("", "_blank", "width=1360,height=920");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatorio do Setor - Serviço Social</title><style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #f3f6fb; color: #0f172a; padding: 18px; }
    .sheet { width: 1320px; margin: 0 auto; background: #fff; padding: 16px 18px; border: 1px solid #a6b7d0; }
    .header { display: grid; grid-template-columns: 220px minmax(0, 1fr) 200px; gap: 10px; align-items: start; border-bottom: 1px solid #7e93ae; padding-bottom: 8px; }
    .brand { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; align-items: start; }
    .brand-mark { font-size: 40px; font-weight: 900; color: #10283d; line-height: 1; }
    .brand-text { font-size: 11px; font-weight: 800; text-align: center; color: #10283d; }
    .title { text-align: center; padding-top: 6px; }
    .title .line-1 { font-size: 14px; font-weight: 900; color: #10283d; }
    .title .line-2 { font-size: 16px; font-weight: 900; color: #10283d; margin-top: 4px; }
    .meta { text-align: right; font-size: 11px; font-weight: 700; color: #10283d; line-height: 1.5; }
    .table-wrap { margin-top: 10px; border: 1px solid #7e93ae; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #7e93ae; padding: 5px 6px; font-size: 11px; vertical-align: top; }
    th { background: #ead0c2; color: #10283d; font-size: 10px; font-weight: 900; text-transform: uppercase; text-align: center; }
    td.bed, td.age, td.admission { text-align: center; white-space: nowrap; }
    .status-meta { margin-top: 4px; font-size: 9px; line-height: 1.3; color: #475569; }
    .footer-note { margin-top: 8px; text-align: right; font-size: 10px; font-weight: 700; color: #274c77; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { width: auto; margin: 0; border: 0; }
    }
  </style></head><body>
    <div class="sheet">
      <div class="header">
        <div class="brand">
          <div class="brand-mark">HMA</div>
          <div class="brand-text">HOSPITAL MUNICIPAL DE ACAILANDIA<br>URGENCIA E EMERGENCIA</div>
        </div>
        <div class="title">
          <div class="line-1">UNIDADE: HOSPITAL MUNICIPAL DE ACAILANDIA - HMA</div>
          <div class="line-2">RELATORIO COMPLETO DO SETOR - SERVICO SOCIAL</div>
        </div>
        <div class="meta">
          <div>Data: ${escapeHtml(reportDate)}</div>
          <div>Gerado em: ${escapeHtml(generatedAt)}</div>
          <div>Profissional: ${escapeHtml(professionalName)}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Leito</th>
              <th>Setor</th>
              <th>Paciente</th>
              <th>Idade</th>
              <th>Contatos</th>
              <th>Admissão</th>
              <th>Ficha social</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="footer-note">HMA - A servico da vida.</div>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function printShiftReport(report) {
  if (!report) return;
  const buildMovementLines = (items = [], emptyLabel = "Nenhum registro no plantão.") => {
    if (!Array.isArray(items) || !items.length) {
      return `<div class="movement-empty">${escapeHtml(emptyLabel)}</div>`;
    }
    return items.map(item => {
      const local = [item.enfermaria || "", item.bedId ? `Leito ${item.bedId}` : ""].filter(Boolean).map(value => escapeHtml(value)).join(" / ");
      const route = item.source || item.destination
        ? [
          item.source ? `Origem: ${escapeHtml(item.source)}` : "",
          item.destination ? `Destino: ${escapeHtml(item.destination)}` : ""
        ].filter(Boolean).join("<br>")
        : "";
      const detail = [local, item.detail ? escapeHtml(item.detail) : "", route, escapeHtml(toBRDateTime(item.at))].filter(Boolean).join("<br>");
      return `
        <div class="movement-line">
          <strong>${escapeHtml(item.patientName || "-")}</strong>
          <span>${detail}</span>
        </div>
      `;
    }).join("");
  };
  const devices = (report.summary?.dispositivos || []).map(item => `
    <div class="device-chip">
      <strong>${item.label}</strong>
      <span>${item.value}</span>
    </div>
  `).join("") || '<div class="empty-box">Sem dispositivos registrados.</div>';
  const team = report.shift?.team || {};
  const teamRows = [
    ["Medico do plantao", team.medicoPlantao || "-"],
    ["Enfermeiro(a) dia", team.enfermeiroDia || "-"],
    ["Tecnicos(as) dia", team.tecnicosDia || "-"],
    ["Enfermeiro(a) noite", team.enfermeiroNoite || "-"],
    ["Tecnicos(as) noite", team.tecnicosNoite || "-"],
    ["Faltosos", team.faltosos || "-"]
  ].map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("");
  const patients = (report.patients || []).map(patient => `
    <tr>
      <td><strong>${patient.leito || "-"}</strong><br><small>${patient.enfermaria || "-"}</small></td>
      <td><strong>${patient.nome || "-"}</strong><br><small>CPF ${formatCpf(patient.cpf || "") || "-"} • ${toBRDate(patient.birthDate) || "-"} • ${patient.idade || "-"}</small></td>
      <td>${formatPhone(patient.telefone || "") || "-"}</td>
      <td><strong>Adm.</strong> ${toBRDate(patient.admissao)}<br><strong>Alta</strong> ${toBRDate(patient.alta) || "-"}</td>
      <td>${patient.diagnostico || "-"}</td>
      <td>${patient.nir || "-"}<br><small>${patient.cil ? `SIREL ${patient.cil}` : "-"} • ${patient.nirStatus || "-"}</small></td>
      <td>${patient.socialStatus || "-"}</td>
      <td>${patient.psychologyStatus || "-"}</td>
      <td>${(patient.procedimentos || []).join(", ")}</td>
      <td>${patient.pendencias || "-"}</td>
      <td>${patient.ativoNoFechamento ? "Sim" : "Nao"}</td>
    </tr>
  `).join("");
  const activePendings = (report.pending?.active || []).map(item => `
    <tr>
      <td>${item.leito}</td>
      <td>${item.enfermaria || ""}</td>
      <td>${item.paciente || ""}</td>
      <td>${item.texto}</td>
      <td>${item.createdBy || ""}</td>
      <td>${toBRDateTime(item.createdAt)}</td>
    </tr>
  `).join("");
  const solvedPendings = (report.pending?.solved || []).map(item => `
    <tr>
      <td>${item.leito}</td>
      <td>${item.enfermaria || ""}</td>
      <td>${item.paciente || ""}</td>
      <td>${item.texto}</td>
      <td>${item.finishedBy || ""}</td>
      <td>${toBRDateTime(item.finishedAt)}</td>
    </tr>
  `).join("");
  const actionRows = (report.actions || []).map(action => {
    const meta = [];
    if (action.meta?.bedId) meta.push(`Leito ${action.meta.bedId}`);
    if (action.meta?.patientName) meta.push(`Paciente: ${action.meta.patientName}`);
    else if (action.meta?.patient) meta.push(`Paciente: ${action.meta.patient}`);
    if (action.meta?.visitedPersonName && action.meta?.visitedPersonName !== action.meta?.patientName) {
      meta.push(`Visitado: ${action.meta.visitedPersonName}`);
    }
    if (action.meta?.wardNome) meta.push(`Setor: ${action.meta.wardNome}`);
    if (action.meta?.toWardNome) meta.push(`Destino: ${action.meta.toWardNome}${action.meta?.toBedId ? ` / Leito ${action.meta.toBedId}` : ""}`);
    if (Array.isArray(action.meta?.procedimentos) && action.meta.procedimentos.length) meta.push(`Procedimentos: ${action.meta.procedimentos.join(", ")}`);
    if (Array.isArray(action.meta?.pendenciasRegistradas) && action.meta.pendenciasRegistradas.length) {
      meta.push(`Pendências abertas: ${action.meta.pendenciasRegistradas.map(item => item.texto).join(", ")}`);
    }
    if (Array.isArray(action.meta?.pendenciasFinalizadas) && action.meta.pendenciasFinalizadas.length) {
      meta.push(`Pendências finalizadas: ${action.meta.pendenciasFinalizadas.map(item => item.texto).join(", ")}`);
    }
    return `
      <tr>
        <td>${toBRDateTime(action.at)}</td>
        <td>${action.authorName || action.username || "-"}</td>
        <td>${action.description || "-"}</td>
        <td>${meta.join(" • ") || "-"}</td>
      </tr>
    `;
  }).join("");
  const movements = report.movements || {};
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de Plantão</title><style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: #eef3f8; color: #111827; padding: 10px; }
    h1, h2, h3, p { margin: 0; }
    .sheet { max-width: 1080px; margin: 0 auto; background: #fff; border: 1px solid #dbe4f0; border-radius: 12px; padding: 12px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
    ${buildHospitalReportPrintStyles()}
    .meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
    .meta-card { border: 1px solid #d7deea; border-radius: 8px; padding: 6px 8px; background: #f8fbff; min-height: 0; }
    .meta-card strong { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 3px; }
    .meta-card span { display: block; font-size: 10px; font-weight: 700; color: #0f172a; line-height: 1.15; }
    .summary-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
    .summary-card { border: 1px solid #d7deea; border-radius: 8px; padding: 6px 8px; background: linear-gradient(180deg, #ffffff, #f8fbff); }
    .summary-card strong { display: block; margin-bottom: 5px; font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-card div { font-size: 12px; font-weight: 800; color: #0f172a; line-height: 1; }
    .section { margin-top: 8px; padding: 8px; border: 1px solid #dbe4f0; border-radius: 10px; background: #fff; }
    .section-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .section-title h2 { font-size: 12px; color: #0f172a; }
    .section-title span { font-size: 10px; color: #64748b; }
    .section-subtitle { font-size: 9px; color: #64748b; margin-top: 0; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d7deea; padding: 4px 5px; font-size: 9px; text-align: left; vertical-align: top; line-height: 1.2; }
    th { background: #eef4fb; color: #334155; font-size: 8px; text-transform: uppercase; letter-spacing: 0.3px; }
    td small { font-size: 8px; color: #475569; }
    tbody tr:nth-child(even) td { background: #fbfdff; }
    .device-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
    .device-chip { border: 1px solid #d7deea; border-radius: 8px; padding: 6px; background: #f8fbff; display: grid; gap: 2px; }
    .device-chip strong { font-size: 9px; color: #334155; }
    .device-chip span { font-size: 11px; font-weight: 800; color: #0f172a; }
    .empty-box { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 8px; color: #64748b; background: #f8fafc; font-size: 9px; }
    .movements-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
    .movement-card { border: 1px solid #d7deea; border-radius: 8px; min-height: 112px; overflow: hidden; background: #fbfdff; }
    .movement-card h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.35px; padding: 6px 7px; background: #eef4fb; color: #334155; border-bottom: 1px solid #d7deea; }
    .movement-card-body { padding: 6px; display: grid; gap: 5px; }
    .movement-line { border-bottom: 1px dashed #d7deea; padding-bottom: 4px; }
    .movement-line:last-child { border-bottom: 0; padding-bottom: 0; }
    .movement-line strong { display: block; font-size: 9px; color: #0f172a; }
    .movement-line span { display: block; font-size: 8px; line-height: 1.25; color: #475569; }
    .movement-empty { font-size: 8px; color: #64748b; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { max-width: none; border: 0; border-radius: 0; box-shadow: none; padding: 0; }
      .section { break-inside: avoid; }
    }
  </style></head><body>
    <div class="sheet">
      ${buildHospitalReportTop({
        title: "Ficha de Fechamento de Plantão",
        subtitle: "Relatório consolidado do plantão com equipe, pacientes, pendências e histórico de alterações.",
        metaHtml: `
          <div><strong>Setor:</strong> ${escapeHtml(report.shift?.wardNome || "-")}</div>
          <div><strong>Fechado em:</strong> ${escapeHtml(toBRDateTime(report.shift?.closedAt))}</div>
          <div><strong>Responsável:</strong> ${escapeHtml(report.shift?.nome || report.shift?.username || "-")}</div>
        `
      })}
      <div class="meta-grid">
        <div class="meta-card"><strong>Profissional</strong><span>${report.shift?.nome || report.shift?.username || "-"} (${report.shift?.username || "-"})</span></div>
        <div class="meta-card"><strong>Setor</strong><span>${report.shift?.wardNome || "-"}</span></div>
        <div class="meta-card"><strong>Plantão</strong><span>${report.shift?.shiftLength || "12H"} / ${getShiftPeriodLabel(report.shift?.shiftPeriod)}</span></div>
        <div class="meta-card"><strong>Período</strong><span>${toBRDateTime(report.shift?.openedAt)}<br>até ${toBRDateTime(report.shift?.closedAt)}</span></div>
      </div>
      <div class="summary-grid">
        <div class="summary-card"><strong>Pacientes no dia</strong><div>${report.summary?.pacientesNoPeriodo ?? report.patients?.length ?? 0}</div></div>
        <div class="summary-card"><strong>Admissões</strong><div>${report.summary?.admissoes ?? 0}</div></div>
        <div class="summary-card"><strong>Transf. internas</strong><div>${report.summary?.transferenciasInternas ?? 0}</div></div>
        <div class="summary-card"><strong>Transf. externas</strong><div>${report.summary?.transferenciasExternas ?? 0}</div></div>
        <div class="summary-card"><strong>Altas</strong><div>${report.summary?.altas ?? 0}</div></div>
        <div class="summary-card"><strong>Óbitos</strong><div>${report.summary?.obitos ?? 0}</div></div>
        <div class="summary-card"><strong>Evasões</strong><div>${report.summary?.evasoes ?? 0}</div></div>
        <div class="summary-card"><strong>Alterações</strong><div>${report.summary?.totalAlteracoes ?? 0}</div></div>
        <div class="summary-card"><strong>Pendências ativas</strong><div>${report.summary?.pendenciasAtivas ?? 0}</div></div>
        <div class="summary-card"><strong>Pendências solucionadas</strong><div>${report.summary?.pendenciasSolucionadas ?? 0}</div></div>
      </div>
      <div class="section">
        <div class="section-title"><h2>Equipe do plantao</h2><span>${report.shift?.shiftLength || "12H"} / ${getShiftPeriodLabel(report.shift?.shiftPeriod)}</span></div>
        <div class="section-subtitle">Equipe registrada para este plantão e profissional responsável pelo fechamento.</div>
        <table>
          <tbody>
            <tr><th>Plantão vinculado ao login</th><td>${report.shift?.nome || report.shift?.username || "-"} (${report.shift?.username || "-"})</td></tr>
            ${teamRows}
            <tr><th>Equipe atualizada por</th><td>${report.shift?.teamUpdatedBy || "-"}${report.shift?.teamUpdatedAt ? ` em ${toBRDateTime(report.shift.teamUpdatedAt)}` : ""}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-title"><h2>Relatório de enfermagem</h2><span>${report.shift?.nursingReportUpdatedAt ? toBRDateTime(report.shift.nursingReportUpdatedAt) : "Sem horário salvo"}</span></div>
        <div class="section-subtitle">Texto digitado pelo responsável do plantão para compor a ficha final do setor.</div>
        <div class="empty-box" style="white-space: pre-wrap;">${report.shift?.nursingReport ? escapeHtml(report.shift.nursingReport) : "Nenhum relatório de enfermagem registrado neste plantão."}</div>
      </div>
      <div class="section">
        <div class="section-title"><h2>Dispositivos e procedimentos</h2><span>${(report.summary?.dispositivos || []).length} item(ns)</span></div>
        <div class="section-subtitle">Resumo dos principais dispositivos e procedimentos registrados no plantão.</div>
        <div class="device-grid">${devices}</div>
      </div>
      <div class="section">
        <div class="section-title"><h2>Pacientes internados no período</h2><span>${(report.patients || []).length} paciente(s)</span></div>
        <div class="section-subtitle">Aqui aparecem todos os pacientes que passaram internados neste setor durante o plantão, com campos assistenciais e status do NIR, Serviço Social e Psicologia.</div>
        <table>
          <thead><tr><th>Local</th><th>Paciente</th><th>Telefone</th><th>Período</th><th>Diagnóstico</th><th>NIR</th><th>Serv. Social</th><th>Psicologia</th><th>Dispositivos</th><th>Pendências</th><th>Ativo</th></tr></thead>
          <tbody>${patients || '<tr><td colspan="11">Nenhum paciente internado neste plantão.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-title"><h2>Pendências ativas do plantão</h2><span>${report.summary?.pendenciasAtivas ?? 0} registro(s)</span></div>
        <div class="section-subtitle">Pendências que permaneceram abertas até o fechamento.</div>
        <table>
          <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Pendência</th><th>Registrado por</th><th>Data</th></tr></thead>
          <tbody>${activePendings || '<tr><td colspan="6">Nenhuma pendência ativa no fechamento.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-title"><h2>Pendências solucionadas no plantão</h2><span>${report.summary?.pendenciasSolucionadas ?? 0} registro(s)</span></div>
        <div class="section-subtitle">Pendências encerradas durante este plantão.</div>
        <table>
          <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Pendência</th><th>Finalizado por</th><th>Data</th></tr></thead>
          <tbody>${solvedPendings || '<tr><td colspan="6">Nenhuma pendência solucionada neste plantão.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-title"><h2>Histórico de alterações do plantão</h2><span>${report.summary?.totalAlteracoes ?? 0} alteração(ões)</span></div>
        <div class="section-subtitle">Registro cronológico das ações realizadas durante o plantão.</div>
        <table>
          <thead><tr><th>Data</th><th>Registrado por</th><th>Ação</th><th>Detalhes</th></tr></thead>
          <tbody>${actionRows || '<tr><td colspan="4">Nenhuma alteração registrada neste plantão.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="section">
        <div class="section-title"><h2>Movimentações finais do plantão</h2><span>Baseado nos registros do período</span></div>
        <div class="section-subtitle">Aqui ficam os desfechos e movimentações lançados durante este plantão do setor.</div>
        <div class="movements-grid">
          <div class="movement-card">
            <h3>Transferência externa</h3>
            <div class="movement-card-body">${buildMovementLines(movements.externalTransfers, "Nenhuma transferência externa.")}</div>
          </div>
          <div class="movement-card">
            <h3>Transferência interna</h3>
            <div class="movement-card-body">${buildMovementLines(movements.internalTransfers, "Nenhuma transferência interna.")}</div>
          </div>
          <div class="movement-card">
            <h3>Óbito</h3>
            <div class="movement-card-body">${buildMovementLines(movements.obitos, "Nenhum óbito.")}</div>
          </div>
          <div class="movement-card">
            <h3>Admissões</h3>
            <div class="movement-card-body">${buildMovementLines(movements.admissions, "Nenhuma admissão.")}</div>
          </div>
          <div class="movement-card">
            <h3>Altas</h3>
            <div class="movement-card-body">${buildMovementLines(movements.altas, "Nenhuma alta.")}</div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function renderDashboard(data) {
  const overview = data.overview || {};
  document.getElementById("dash-pacientes").textContent = overview.pacientesInternados ?? 0;
  document.getElementById("dash-leitos").textContent = overview.leitosTotais ?? 0;
  document.getElementById("dash-admissoes").textContent = overview.admissoesNoPeriodo ?? 0;
  document.getElementById("dash-permanencia").textContent = `${overview.mediaPermanencia ?? 0} dias`;
  document.getElementById("dash-ocupacao").textContent = `${overview.taxaOcupacao ?? 0}%`;
  document.getElementById("dash-bloqueio").textContent = `${overview.taxaBloqueio ?? 0}%`;
  document.getElementById("dash-altas").textContent = overview.altasAcumuladas ?? 0;
  document.getElementById("dash-obitos").textContent = overview.obitosAcumuladas ?? overview.obitosAcumulados ?? 0;
  document.getElementById("dash-rotatividade").textContent = `${overview.taxaRotatividade ?? 0}%`;
  document.getElementById("dash-evasao").textContent = `${overview.taxaEvasao ?? 0}%`;

  renderBarGroup("dashboard-pathology", data.charts?.patologias || [], {
    emptyText: "Sem patologias registradas no período.",
    getColorClass: (item, index) => getDashboardColorClass("pathology", item, index)
  });
  renderBarGroup("dashboard-stay", data.charts?.permanencia || [], {
    emptyText: "Sem tempo de permanência no período.",
    getColorClass: item => getDashboardColorClass("stay", item, 0)
  });
  renderBarGroup("dashboard-procedures", data.charts?.procedimentos || [], {
    emptyText: "Sem procedimentos registrados no período.",
    getColorClass: (item, index) => getDashboardColorClass("procedures", item, index)
  });
  renderBarGroup("dashboard-sectors", data.charts?.setores || [], {
    labelKey: "label",
    valueKey: "taxa",
    formatValue: item => `${item.taxa}%`,
    getColorClass: item => getDashboardColorClass("sectors", item, 0)
  });

  setDashboardFeedback(data.scope?.label ? `Exibindo: ${data.scope.label}` : "", false);

  const headerTitle = document.getElementById("header-title");
  if (headerTitle) headerTitle.textContent = "Dashboard Hospitalar";
  const headerDate = document.getElementById("date");
  if (headerDate) {
    headerDate.textContent = data.period?.from || data.period?.to
      ? `${data.period.from || "Início"} até ${data.period.to || "Hoje"}`
      : new Date().toLocaleDateString("pt-BR");
  }
}

async function loadDashboard() {
  try {
    const data = await api(`/api/dashboard${getDashboardQuery()}`);
    renderDashboard(data);
    return data;
  } catch (error) {
    setDashboardFeedback(error.message || "Não foi possível carregar o dashboard.", true);
    return null;
  }
}

function getBedRequestStatus(request = {}, requestKey = "") {
  if (requestKey === "psychologyRequest") {
    const psychologyStatus = getPsychologyStatusPresentation(request);
    if (psychologyStatus.state === "BAIXA") {
      return {
        label: "Solicitar",
        className: "none",
        meta: "Clique para solicitar"
      };
    }
    return {
      label: psychologyStatus.state ? psychologyStatus.label : "Solicitar",
      className: psychologyStatus.state ? psychologyStatus.chipClassName : "none",
      meta: psychologyStatus.meta || "Clique para solicitar"
    };
  }

  if (!request?.requested) {
    return {
      label: "Solicitar",
      className: "none",
      meta: "Clique para registrar"
    };
  }

  if (String(request.status || "").toUpperCase() === "EM_ACOMPANHAMENTO" || request.startedAt) {
    return {
      label: "Em acompanhamento",
      className: "in-progress",
      meta: request.startedBy
        ? `Em acompanhamento por ${request.startedBy}`
        : `Iniciado em ${toBRDateTime(request.startedAt) || "-"}`
    };
  }

  if (request.viewedAt) {
    return {
      label: "Visualizada",
      className: "done",
      meta: request.viewedBy
        ? `Visto por ${request.viewedBy}`
        : `Visto em ${toBRDateTime(request.viewedAt) || "-"}`
    };
  }

  return {
    label: "Pendente",
    className: "pending",
    meta: request.requestedBy
      ? `Solicitado por ${request.requestedBy}`
      : `Solicitado em ${toBRDateTime(request.requestedAt) || "-"}`
  };
}

async function updateBedRequestField(bedId, requestKey) {
  if (!ward || !currentWardId) return;
  const bed = ward.beds.find(item => item.id === bedId);
  if (!bed) return;
  if (String(bed.status || "").toUpperCase() !== "OCUPADO" || !String(bed.nome || "").trim()) {
    alert("Só é possível sinalizar NIR, Serviço Social ou Psicologia em leito ocupado.");
    return;
  }

  const current = bed[requestKey] || {};
  let next = null;

  if (requestKey === "psychologyRequest") {
    const currentState = getPsychologyRequestState(current);
    if (currentState === "SOLICITADO" || currentState === "EM_ACOMPANHAMENTO") return;
    next = {
      ...current,
      requested: true,
      requestedAt: new Date().toISOString(),
      requestedBy: currentUser?.nome || currentUser?.username || "",
      viewedAt: "",
      viewedBy: "",
      startedAt: "",
      startedBy: "",
      closedAt: "",
      closedBy: "",
      observation: "",
      status: "SOLICITADO"
    };
  } else if (!current.requested) {
    next = {
      requested: true,
      requestedAt: new Date().toISOString(),
      requestedBy: currentUser?.nome || currentUser?.username || "",
      viewedAt: "",
      viewedBy: ""
    };
  } else if (!current.viewedAt) {
    next = {
      ...current,
      requested: true,
      viewedAt: new Date().toISOString(),
      viewedBy: currentUser?.nome || currentUser?.username || ""
    };
  } else {
    return;
  }

  try {
    const data = await api(`/api/wards/${currentWardId}/beds/${bedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [requestKey]: next })
    });
    ward.beds = ward.beds.map(item => item.id === bedId ? data.bed : item);
    renderCounts(data.counts || computeLocalWardCounts(ward.beds));
    renderBeds(ward.beds);
  } catch (error) {
    showUnexpectedError(error);
  }
}

function computeLocalWardCounts(beds = []) {
  const counts = { OCUPADO: 0, LIVRE: 0, BLOQUEADO: 0, RESERVADO: 0, EXTRA: 0, TOTAL: 0 };
  for (const bed of beds) {
    const status = String(bed?.status || "");
    if (counts[status] === undefined) counts[status] = 0;
    counts[status] += 1;
    counts.TOTAL += 1;
  }
  return counts;
}

function renderBeds(beds) {
  const tbody = document.getElementById("tbody-leitos");
  tbody.innerHTML = "";

  const bedsByEnf = {};
  for (const b of beds) {
    const enf = b.enfermaria || "SEM ENFERMARIA";
    if (!bedsByEnf[enf]) bedsByEnf[enf] = [];
    bedsByEnf[enf].push(b);
  }

  const ordered = Object.keys(bedsByEnf).sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const enf of ordered) {
    const enfBeds = bedsByEnf[enf];
    const enfKey = `enf-${enf.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const enfTr = document.createElement("tr");
    const enfTd = document.createElement("td");
    enfTd.colSpan = 10;
    enfTd.id = enfKey;
    enfTd.textContent = enf;
    enfTd.style.background = "var(--bg-main)";
    enfTd.style.fontWeight = "800";
    enfTd.style.color = "var(--primary)";
    enfTr.appendChild(enfTd);
    tbody.appendChild(enfTr);

    for (const b of enfBeds) {
      const tr = document.createElement("tr");
      const tdId = document.createElement("td");
      tdId.textContent = `LEITO ${b.id}`;
      const tdStatus = document.createElement("td");
      tdStatus.className = "clickable status-cell";
      const badge = document.createElement("span");
      badge.className = `badge ${b.status}`;
      badge.textContent = statusLabel(b.status);
      tdStatus.appendChild(badge);
      tdStatus.addEventListener("click", () => openPatientModal(b.id));
      const tdTempo = document.createElement("td");
      tdTempo.textContent = b.tempoMedio ?? 0;
      const tdAdm = document.createElement("td");
      tdAdm.textContent = toBRDate(b.admissao);
      const tdNome = document.createElement("td");
      tdNome.className = "clickable";
      if (b.nome) {
        tdNome.textContent = b.nome;
      } else {
        const span = document.createElement("span");
        span.className = "placeholder";
        span.textContent = "CLIQUE PARA CADASTRAR";
        tdNome.appendChild(span);
      }
      tdNome.addEventListener("click", () => openPatientModal(b.id));
      const tdDiag = document.createElement("td");
      tdDiag.textContent = b.diagnostico || "";
      const tdSocial = document.createElement("td");
      tdSocial.className = "bed-request-cell";
      const socialStatus = getBedRequestStatus(b.serviceSocialRequest, "serviceSocialRequest");
      tdSocial.innerHTML = `
        <button type="button" class="bed-request-chip ${socialStatus.className}" data-bed-request="serviceSocialRequest" data-bed-id="${b.id}">
          ${escapeHtml(socialStatus.label)}
        </button>
        <span class="bed-request-meta">${escapeHtml(socialStatus.meta)}</span>
      `;
      const tdPsychology = document.createElement("td");
      tdPsychology.className = "bed-request-cell";
      const psychologyStatus = getBedRequestStatus(b.psychologyRequest, "psychologyRequest");
      tdPsychology.innerHTML = `
        <button type="button" class="bed-request-chip ${psychologyStatus.className}" data-bed-request="psychologyRequest" data-bed-id="${b.id}">
          ${escapeHtml(psychologyStatus.label)}
        </button>
        <span class="bed-request-meta">${escapeHtml(psychologyStatus.meta)}</span>
      `;
      const tdPend = document.createElement("td");
      tdPend.textContent = b.pendencias || "";
      const tdNir = document.createElement("td");
      tdNir.className = "bed-request-cell";
      const nirStatus = getBedRequestStatus(b.nirRequest, "nirRequest");
      tdNir.innerHTML = `
        <button type="button" class="bed-request-chip ${nirStatus.className}" data-bed-request="nirRequest" data-bed-id="${b.id}">
          ${escapeHtml(nirStatus.label)}
        </button>
        <span class="bed-request-meta">${escapeHtml(nirStatus.meta)}</span>
      `;
      tr.append(tdId, tdStatus, tdTempo, tdAdm, tdNome, tdDiag, tdSocial, tdPsychology, tdPend, tdNir);
      tbody.appendChild(tr);
    }
  }
}

async function openPatientModal(bedId) {
  if (!ward) return;
  const bed = ward.beds.find(b => b.id === bedId);
  if (!bed) return;
  currentBedId = bedId;
  selectedRegistryPatient = null;
  document.getElementById("modal-title").textContent = `Leito ${bed.id}`;
  document.getElementById("modal-leito").value = `LEITO ${bed.id}`;
  document.getElementById("modal-status").value = bed.status;
  document.getElementById("modal-nome").value = formatCpf(bed.cpf || "");
  document.getElementById("modal-admissao").value = bed.admissao || "";
  document.getElementById("modal-diagnostico").value = bed.diagnostico || "";
  document.getElementById("modal-pendencias").value = "";
  document.getElementById("modal-external-transfer-note").value = "";
  toggleExternalTransferPanel(false);
  setPatientIdentityDisplay("", "");
  toggleCreatePatientButton(false);
  if (bed.cpf) {
    const patient = await findPatientRegistryByCpf(bed.cpf);
    if (patient) {
      applyRegistryPatientToBedForm(patient);
    } else {
      setPatientIdentityDisplay(bed.nome || "", bed.birthDate || "");
      setPatientLookupFeedback("CPF já informado neste leito, mas ainda sem cadastro localizado.");
      toggleCreatePatientButton(true);
    }
  } else {
    setPatientIdentityDisplay(bed.nome || "", bed.birthDate || "");
    setPatientLookupFeedback(bed.nome ? `Paciente atual: ${bed.nome}` : "");
  }
  const current = new Set();
  for (const el of document.querySelectorAll(".proc-check")) {
    el.checked = current.has(el.value);
  }
  renderPendingHistory(Array.isArray(bed.pendenciasHistorico) ? bed.pendenciasHistorico : []);
  renderProcedureHistory(Array.isArray(bed.procedimentosHistorico) ? bed.procedimentosHistorico : []);
  await updateTransferOptions(bed.id, currentWardId);
  setPatientFieldsEnabled(bed.status === "OCUPADO");
  document.getElementById("modal-paciente").showModal();
}

function getSelectedProcedures() {
  const selected = [];
  for (const p of procedureOptions) {
    const el = document.querySelector(`.proc-check[value="${p}"]`);
    if (el?.checked) selected.push(p);
  }
  return selected;
}

function getPendingStatusPayload() {
  return Array.from(document.querySelectorAll(".pendencia-status")).map(input => ({
    id: input.dataset.id,
    status: input.checked ? "FINALIZADA" : "ATIVA"
  }));
}

async function getTransferWardData(wardId) {
  if (!Number.isInteger(wardId)) return null;
  if (ward?.id === wardId) return ward;
  if (transferWardCache.has(wardId)) return transferWardCache.get(wardId);
  const data = await api(`/api/wards/${wardId}`);
  transferWardCache.set(wardId, data);
  return data;
}

function setTransferControlsDisabled(disabled, title = "") {
  const ids = ["modal-transfer-ward", "modal-transfer-bed", "modal-transferir"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = disabled;
    el.title = title;
  }
}

function fillTransferWardOptions(selectedWardId) {
  const wardSelect = document.getElementById("modal-transfer-ward");
  if (!wardSelect) return;
  wardSelect.innerHTML = "";
  for (const item of wards) {
    wardSelect.appendChild(new Option(item.nome, String(item.id)));
  }
  const targetValue = selectedWardId ?? currentWardId;
  if (targetValue && Array.from(wardSelect.options).some(option => option.value === String(targetValue))) {
    wardSelect.value = String(targetValue);
  }
}

function fillTransferBedOptions(targetWard, sourceBedId) {
  const bedSelect = document.getElementById("modal-transfer-bed");
  const transferButton = document.getElementById("modal-transferir");
  if (!bedSelect || !transferButton) return;

  bedSelect.innerHTML = "";
  bedSelect.appendChild(new Option("Selecione o leito de destino", ""));

  const destinationBeds = (targetWard?.beds || []).filter(item => {
    if (targetWard.id === currentWardId && item.id === sourceBedId) return false;
    if (item.status !== "LIVRE" && item.status !== "EXTRA") return false;
    return true;
  });

  for (const item of destinationBeds) {
    const enfermaria = item.enfermaria || "SEM ENFERMARIA";
    bedSelect.appendChild(new Option(`LEITO ${item.id} - ${enfermaria}`, String(item.id)));
  }

  bedSelect.disabled = destinationBeds.length === 0;
  transferButton.disabled = destinationBeds.length === 0;
  bedSelect.title = destinationBeds.length ? "" : "Não há leitos disponíveis para o destino selecionado.";
}

async function updateTransferOptions(selectedBedId, selectedWardId = currentWardId) {
  fillTransferWardOptions(selectedWardId);
  const sourceBed = ward?.beds?.find(item => item.id === selectedBedId);
  const isTransferAllowed = sourceBed?.status === "OCUPADO" && Boolean(sourceBed?.nome);

  if (!isTransferAllowed) {
    setTransferControlsDisabled(true, "A transferência só está disponível para paciente ocupado.");
    fillTransferBedOptions({ id: currentWardId, beds: [] }, selectedBedId);
    return;
  }

  setTransferControlsDisabled(false, "");
  try {
    const targetWard = await getTransferWardData(Number.parseInt(String(selectedWardId), 10));
    fillTransferBedOptions(targetWard, selectedBedId);
  } catch (error) {
    setTransferControlsDisabled(true, "Não foi possível carregar os destinos.");
    setShiftFeedback(error.message || "Não foi possível carregar os destinos de transferência.", true);
  }
}

async function salvarPaciente() {
  if (currentBedId == null) return;
  const status = document.getElementById("modal-status").value;

  if (status !== "OCUPADO") {
    await api(`/api/wards/${currentWardId}/beds/${currentBedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    transferWardCache.clear();
    await load();
    document.getElementById("modal-paciente").close();
    return;
  }

  const cpfDigitado = normalizeCpf(document.getElementById("modal-nome").value);
  if (!cpfDigitado || cpfDigitado.length !== 11) {
    setPatientLookupFeedback("Digite um CPF válido com 11 dígitos para localizar o paciente.", true);
    return;
  }
  const patient = selectedRegistryPatient && normalizeCpf(selectedRegistryPatient.cpf) === cpfDigitado
    ? selectedRegistryPatient
    : await resolvePatientFromBedCpf({ openRegistryIfMissing: true });
  if (!patient) return;

  const admissao = document.getElementById("modal-admissao").value;
  const diagnostico = document.getElementById("modal-diagnostico").value.trim();
  const pendenciasAdd = document.getElementById("modal-pendencias").value.trim();
  const procedimentos = getSelectedProcedures();
  const pendenciasStatus = getPendingStatusPayload();
  const payload = {
    status: "OCUPADO",
    nome: patient.nome || "",
    cpf: normalizeCpf(patient.cpf),
    birthDate: patient.birthDate || "",
    admissao,
    diagnostico,
    pendenciasAdd,
    pendenciasStatus,
    nir: patient.nir || "",
    cil: patient.cil || "",
    procedimentos
  };
  await api(`/api/wards/${currentWardId}/beds/${currentBedId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  transferWardCache.clear();
  await load();
  document.getElementById("modal-paciente").close();
}

async function transferirPaciente() {
  if (currentBedId == null) return;
  const destinationWardId = parseInt(document.getElementById("modal-transfer-ward").value, 10);
  const destinationBedId = parseInt(document.getElementById("modal-transfer-bed").value, 10);
  if (!Number.isInteger(destinationWardId) || !Number.isInteger(destinationBedId)) {
    alert("Selecione o leito de destino.");
    return;
  }

  const sourceBed = ward?.beds?.find(item => item.id === currentBedId);
  const destinationWard = await getTransferWardData(destinationWardId);
  const destinationBed = destinationWard?.beds?.find(item => item.id === destinationBedId);
  if (!sourceBed || !destinationWard || !destinationBed) {
    alert("Não foi possível localizar os leitos da transferência.");
    return;
  }

  const destinationLabel = `${destinationWard.nome} - ${destinationBed.enfermaria || "SEM ENFERMARIA"} - LEITO ${destinationBed.id}`;
  if (!confirm(`Transferir ${sourceBed.nome || "o paciente"} para ${destinationLabel}?`)) return;

  await api(`/api/wards/${currentWardId}/beds/${currentBedId}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetWardId: destinationWardId, targetBedId: destinationBedId })
  });
  transferWardCache.clear();
  await load();
  document.getElementById("modal-paciente").close();
}

async function darBaixa() {
  if (currentBedId == null) return;
  const bed = ward?.beds?.find(item => item.id === currentBedId) || null;
  if (bed) {
    const linkedSignals = [
      hasNirRequest({ currentAdmission: { nirRequest: bed.nirRequest } }) ? "NIR" : "",
      hasServiceSocialRequest({ currentAdmission: { serviceSocialRequest: bed.serviceSocialRequest } }) ? "Serviço Social" : "",
      hasPsychologyRequest({ currentAdmission: { psychologyRequest: bed.psychologyRequest } }) ? "Psicologia" : ""
    ].filter(Boolean);
    if (linkedSignals.length && !confirm(`O paciente está sinalizado em ${linkedSignals.join(", ")}.\n\nAo liberar o leito, essas solicitações serão encerradas automaticamente.\n\nDeseja continuar?`)) {
      return;
    }
  }
  await api(`/api/wards/${currentWardId}/beds/${currentBedId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "LIVRE" })
  });
  transferWardCache.clear();
  await load();
  document.getElementById("modal-paciente").close();
}

async function registrarOutcome(type) {
  if (currentBedId == null) return;
  const normalizedType = String(type || "").trim().toUpperCase();
  const bed = ward?.beds?.find(item => item.id === currentBedId) || null;
  const note = normalizedType === "TRANSFERENCIA_EXTERNA"
    ? document.getElementById("modal-external-transfer-note")?.value.trim() || ""
    : "";
  if (normalizedType === "TRANSFERENCIA_EXTERNA" && !note) {
    toggleExternalTransferPanel(true);
    setPatientLookupFeedback("Descreva a transferência externa antes de registrar.", true);
    return;
  }
  if (bed) {
    const linkedSignals = [
      hasNirRequest({ currentAdmission: { nirRequest: bed.nirRequest } }) ? "NIR" : "",
      hasServiceSocialRequest({ currentAdmission: { serviceSocialRequest: bed.serviceSocialRequest } }) ? "Serviço Social" : "",
      hasPsychologyRequest({ currentAdmission: { psychologyRequest: bed.psychologyRequest } }) ? "Psicologia" : ""
    ].filter(Boolean);
    if (linkedSignals.length && !confirm(`O paciente está sinalizado em ${linkedSignals.join(", ")}.\n\nAo registrar ${normalizedType.replace("_", " ")}, essas solicitações serão encerradas automaticamente.\n\nDeseja continuar?`)) {
      return;
    }
  }
  await api(`/api/wards/${currentWardId}/beds/${currentBedId}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: normalizedType, note })
  });
  transferWardCache.clear();
  await load();
  document.getElementById("modal-paciente").close();
}

async function load() {
  if (!currentWardId) return;
  const startedAt = performance.now();
  ward = await api(`/api/wards/${currentWardId}`);
  transferWardCache.set(currentWardId, ward);
  renderWardDetailToolbar();
  syncWardShiftEntryState();
  const headerTitle = document.getElementById("header-title");
  if (headerTitle) headerTitle.textContent = ward.nome;
  const headerDate = document.getElementById("date");
  if (headerDate) headerDate.textContent = ward.data;
  renderCounts(ward.counts);
  renderIndicadores(ward.indicadores);
  renderBeds(ward.beds);
  await Promise.all([
    refreshCurrentUser(),
    refreshStaffSuggestions(),
    refreshSidebarPatients()
  ]);
  document.getElementById("profile-current-ward")?.replaceChildren(document.createTextNode(ward.nome));

  if (pendingScrollEnf) {
    const target = document.getElementById(pendingScrollEnf);
    pendingScrollEnf = null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // #region debug-point E:load-finish
  reportDebugEvent("E", "public/app.js:load", "[DEBUG] Main ward load complete", {
    wardId: currentWardId,
    beds: Array.isArray(ward?.beds) ? ward.beds.length : 0,
    durationMs: Math.round(performance.now() - startedAt)
  });
  // #endregion
}

document.getElementById("salvar-equipe").addEventListener("click", async () => {
  if (!currentUser?.activeShift) {
    setShiftFeedback("Abra o plantao antes de cadastrar a equipe.", true);
    return;
  }
  const saveButton = document.getElementById("salvar-equipe");
  const payload = {
    medicoPlantao: document.getElementById("eq-medico").value.trim(),
    enfermeiroDia: document.getElementById("field-eq-enf-dia")?.classList.contains("hidden") ? "" : document.getElementById("eq-enf-dia").value.trim(),
    tecnicosDia: document.getElementById("field-eq-tec-dia")?.classList.contains("hidden") ? "" : document.getElementById("eq-tec-dia").value.trim(),
    enfermeiroNoite: document.getElementById("field-eq-enf-noite")?.classList.contains("hidden") ? "" : document.getElementById("eq-enf-noite").value.trim(),
    tecnicosNoite: document.getElementById("field-eq-tec-noite")?.classList.contains("hidden") ? "" : document.getElementById("eq-tec-noite").value.trim(),
    faltosos: document.getElementById("eq-faltosos").value.trim()
  };
  try {
    if (saveButton) saveButton.disabled = true;
    const shiftResponse = await api("/api/shifts/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    currentUser = shiftResponse?.user || currentUser;
    if (ward?.id === currentWardId) {
      ward.equipe = { ...(ward.equipe || {}), ...payload };
    }
    renderCurrentUser();
    await refreshStaffSuggestions();
    setShiftFeedback("Equipe salva neste plantao com sucesso.");
    document.getElementById("modal-shift-team")?.close();
  } catch (error) {
    setShiftFeedback(error.message || "Nao foi possivel salvar a equipe do plantao.", true);
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
});

document.getElementById("modal-salvar").addEventListener("click", async (e) => {
  e.preventDefault();
  await salvarPaciente();
});

document.getElementById("modal-transferir")?.addEventListener("click", async (e) => {
  e.preventDefault();
  toggleExternalTransferPanel(false);
  await transferirPaciente();
});

document.getElementById("modal-baixa").addEventListener("click", async (e) => {
  e.preventDefault();
  await darBaixa();
});

document.getElementById("modal-alta")?.addEventListener("click", async (e) => {
  e.preventDefault();
  toggleExternalTransferPanel(false);
  if (!confirm("Registrar ALTA e liberar o leito?")) return;
  await registrarOutcome("ALTA");
});

document.getElementById("modal-transferencia-externa")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const panel = document.getElementById("modal-external-transfer-panel");
  const note = document.getElementById("modal-external-transfer-note")?.value.trim() || "";
  if (panel?.classList.contains("hidden")) {
    toggleExternalTransferPanel(true);
    return;
  }
  if (!note) {
    setPatientLookupFeedback("Descreva a transferência externa antes de registrar.", true);
    return;
  }
  if (!confirm("Registrar TRANSFERÊNCIA EXTERNA e liberar o leito?")) return;
  await registrarOutcome("TRANSFERENCIA_EXTERNA");
});

document.getElementById("modal-evasao")?.addEventListener("click", async (e) => {
  e.preventDefault();
  toggleExternalTransferPanel(false);
  if (!confirm("Registrar EVASÃO e liberar o leito?")) return;
  await registrarOutcome("EVASAO");
});

document.getElementById("modal-obito")?.addEventListener("click", async (e) => {
  e.preventDefault();
  toggleExternalTransferPanel(false);
  if (!confirm("Registrar ÓBITO e liberar o leito?")) return;
  await registrarOutcome("OBITO");
});

document.getElementById("modal-status").addEventListener("change", () => {
  const status = document.getElementById("modal-status").value;
  const isOcupado = status === "OCUPADO";
  setPatientFieldsEnabled(isOcupado);
  if (!isOcupado) toggleExternalTransferPanel(false);
  updateTransferOptions(
    currentBedId,
    parseInt(document.getElementById("modal-transfer-ward").value || String(currentWardId), 10)
  );
  if (!isOcupado) clearPatientFields();
});

document.getElementById("modal-transfer-ward")?.addEventListener("change", async () => {
  await updateTransferOptions(
    currentBedId,
    parseInt(document.getElementById("modal-transfer-ward").value || String(currentWardId), 10)
  );
});

document.getElementById("btn-dashboard-apply")?.addEventListener("click", async () => {
  dashboardFilters = {
    wardId: document.getElementById("dashboard-ward").value,
    month: document.getElementById("dashboard-month").value,
    from: document.getElementById("dashboard-from").value,
    to: document.getElementById("dashboard-to").value
  };
  await loadDashboard();
});

document.getElementById("btn-dashboard-clear")?.addEventListener("click", async () => {
  dashboardFilters = { wardId: "", month: "", from: "", to: "" };
  updateDashboardFilterInputs();
  await loadDashboard();
});

async function refreshWards() {
  const isAdmin = isAdminUser();
  const requests = [api("/api/wards")];
  if (isAdmin) {
    requests.push(api("/api/wards?includeArchived=true"));
  }
  const [data, adminData] = await Promise.all(requests);
  wards = data.wards || [];
  allWards = isAdmin ? (adminData?.wards || []) : [...wards];
  const select = document.getElementById("select-ward");
  const modalStartWard = document.getElementById("modal-start-ward-select");
  const dashboardWard = document.getElementById("dashboard-ward");
  const shiftWard = document.getElementById("shift-ward");
  const adminSelectEdit = document.getElementById("admin-ward-select-edit");
  const adminSelectEnf = document.getElementById("admin-ward-select-enf");
  const adminSelectBed = document.getElementById("admin-ward-select-bed");
  const adminSelectDel = document.getElementById("admin-ward-select-del");
  if (select) select.innerHTML = "";
  if (modalStartWard) modalStartWard.innerHTML = "";
  if (dashboardWard) {
    dashboardWard.innerHTML = "";
    dashboardWard.appendChild(new Option("Todos os setores", ""));
  }
  if (shiftWard) shiftWard.innerHTML = "";
  if (adminSelectEdit) adminSelectEdit.innerHTML = "";
  if (adminSelectEnf) adminSelectEnf.innerHTML = "";
  if (adminSelectBed) adminSelectBed.innerHTML = "";
  if (adminSelectDel) adminSelectDel.innerHTML = "";
  for (const w of wards) {
    if (select) select.appendChild(new Option(w.nome, w.id));
    if (modalStartWard) modalStartWard.appendChild(new Option(w.nome, w.id));
    if (dashboardWard) dashboardWard.appendChild(new Option(w.nome, w.id));
    if (shiftWard) shiftWard.appendChild(new Option(w.nome, w.id));
    if (adminSelectEdit) adminSelectEdit.appendChild(new Option(w.nome, w.id));
    if (adminSelectEnf) adminSelectEnf.appendChild(new Option(w.nome, w.id));
    if (adminSelectBed) adminSelectBed.appendChild(new Option(w.nome, w.id));
    if (adminSelectDel) adminSelectDel.appendChild(new Option(w.nome, w.id));
  }
  if (adminSelectEdit) {
    adminSelectEdit.innerHTML = "";
    for (const w of allWards) {
      const label = w.archived ? `${w.nome} (Arquivado)` : w.nome;
      adminSelectEdit.appendChild(new Option(label, w.id));
    }
  }
  if (!wards.length) currentWardId = null;
  else if (!currentWardId || !wards.some(item => item.id === currentWardId)) currentWardId = wards[0].id;
  if (currentWardId) {
    if (select) select.value = String(currentWardId);
    if (modalStartWard) modalStartWard.value = String(currentWardId);
    if (shiftWard) shiftWard.value = String(currentWardId);
    if (adminSelectEnf) adminSelectEnf.value = String(currentWardId);
    if (adminSelectBed) adminSelectBed.value = String(currentWardId);
    if (adminSelectDel) adminSelectDel.value = String(currentWardId);
  }
  if (adminSelectEdit) {
    const preferredWardId = currentWardId && allWards.some(item => item.id === currentWardId)
      ? currentWardId
      : allWards[0]?.id;
    if (preferredWardId) adminSelectEdit.value = String(preferredWardId);
  }
  renderHeaderWardTabs();
  syncAdminWardEditForm();
  renderAdminWardList();
  updateAdminEnfDropdown();
  updateDeleteEnfDropdown();
  if (dashboardWard && !Array.from(dashboardWard.options).some(option => option.value === String(dashboardFilters.wardId))) {
    dashboardFilters.wardId = "";
  }
  updateDashboardFilterInputs();
  updateTopbarWardSelectors();
  renderCurrentUser();
  await refreshSidebarPatients();
}

function syncAdminWardEditForm() {
  const select = document.getElementById("admin-ward-select-edit");
  const input = document.getElementById("admin-ward-edit-name");
  const archiveButton = document.getElementById("btn-archive-ward");
  const title = document.getElementById("admin-ward-editor-title");
  const subtitle = document.getElementById("admin-ward-editor-subtitle");
  const adminSelectEnf = document.getElementById("admin-ward-select-enf");
  const adminSelectBed = document.getElementById("admin-ward-select-bed");
  const adminSelectDel = document.getElementById("admin-ward-select-del");
  if (!select || !input) return;
  const wardId = parseInt(select.value, 10);
  const selectedWard = allWards.find(item => item.id === wardId);
  input.value = selectedWard?.nome || "";
  if (title) {
    title.textContent = selectedWard ? `Editar setor ${selectedWard.nome}` : "Editar setor";
  }
  if (subtitle) {
    subtitle.textContent = selectedWard
      ? "Use este menu para alterar o nome, cadastrar enfermarias e gerenciar leitos deste setor."
      : "Abra um setor para alterar estrutura, enfermarias e leitos.";
  }
  if (selectedWard) {
    if (adminSelectEnf) adminSelectEnf.value = String(selectedWard.id);
    if (adminSelectBed) adminSelectBed.value = String(selectedWard.id);
    if (adminSelectDel) adminSelectDel.value = String(selectedWard.id);
  }
  if (archiveButton) {
    archiveButton.textContent = selectedWard?.archived ? "Reativar setor" : "Arquivar setor";
    archiveButton.disabled = !selectedWard;
  }
  updateAdminEnfDropdown();
  updateDeleteEnfDropdown();
  syncAdminWardEditorFlow();
}

function setElementsDisabled(ids, disabled) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.disabled = disabled;
    element.classList.toggle("muted", disabled);
  }
}

async function loadAdminWardDetails(wardId) {
  if (!wardId) {
    currentAdminWardDetails = null;
    renderAdminBedList();
    return null;
  }
  currentAdminWardDetails = await api(`/api/wards/${wardId}`);
  renderAdminBedList();
  return currentAdminWardDetails;
}

function syncAdminWardEditorFlow() {
  const wardId = parseInt(document.getElementById("admin-ward-select-edit")?.value || "", 10);
  const selectedWard = allWards.find(item => item.id === wardId);
  const hasEnfermarias = Boolean(selectedWard?.enfermarias?.length);
  const isArchived = Boolean(selectedWard?.archived);
  const flowHint = document.getElementById("admin-ward-flow-hint");
  const bedRow = document.getElementById("admin-bed-row");
  const deleteRow = document.getElementById("admin-delete-row");

  setElementsDisabled(
    ["admin-ward-select-bed", "admin-enf-select-bed", "admin-bed-start", "admin-bed-end", "btn-add-beds"],
    isArchived || !hasEnfermarias
  );
  setElementsDisabled(
    ["admin-ward-select-del", "admin-enf-select-del", "del-bed-start", "del-bed-end", "btn-del-beds", "btn-del-enf"],
    isArchived || !hasEnfermarias
  );

  bedRow?.classList.toggle("muted", isArchived || !hasEnfermarias);
  deleteRow?.classList.toggle("muted", isArchived || !hasEnfermarias);

  if (flowHint) {
    if (isArchived) {
      flowHint.textContent = "Este setor está arquivado. Reative o setor para alterar enfermarias e leitos.";
    } else if (!hasEnfermarias) {
      flowHint.textContent = "Passo 1: crie a enfermaria deste setor. Depois disso o cadastro de leitos será liberado.";
    } else {
      flowHint.textContent = "Passo 2: enfermaria criada. Agora você pode cadastrar ou excluir leitos deste setor.";
    }
  }
}

function renderAdminBedList() {
  const container = document.getElementById("admin-bed-list");
  const empty = document.getElementById("admin-bed-list-empty");
  if (!container || !empty) return;

  const beds = Array.isArray(currentAdminWardDetails?.beds) ? currentAdminWardDetails.beds.slice() : [];
  container.innerHTML = "";
  empty.classList.toggle("hidden", beds.length > 0);
  if (!beds.length) return;

  const groups = new Map();
  for (const bed of beds.sort((a, b) => a.id - b.id)) {
    const key = bed.enfermaria || "Sem enfermaria";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bed);
  }

  const list = document.createElement("div");
  list.className = "bed-group-list";

  for (const [enfermaria, groupBeds] of groups.entries()) {
    const card = document.createElement("div");
    card.className = "bed-group-card";
    const rows = groupBeds.map(bed => `
      <div class="bed-admin-row">
        <div>
          <strong>Leito ${bed.id}</strong>
          <span>Status: ${bed.status || "-"}${bed.nome ? ` • ${bed.nome}` : ""}</span>
        </div>
        <div>
          <strong>${enfermaria}</strong>
          <span>${bed.admissao ? `Admissao: ${toBRDate(bed.admissao)}` : "Sem admissao ativa"}</span>
        </div>
        <div class="bed-admin-actions">
          <button type="button" class="ghost btn-admin-bed-edit" data-id="${bed.id}">Alterar</button>
          <button type="button" class="ghost btn-admin-bed-delete" data-id="${bed.id}">Excluir</button>
        </div>
      </div>
    `).join("");

    card.innerHTML = `
      <div class="bed-group-header">
        <strong>${enfermaria}</strong>
        <span>${groupBeds.length} leito(s)</span>
      </div>
      ${rows}
    `;
    list.appendChild(card);
  }

  container.appendChild(list);
}

function openAdminBedEditModal(bedId) {
  const bed = currentAdminWardDetails?.beds?.find(item => item.id === bedId);
  if (!bed) return;
  currentAdminBedEdit = bed;
  document.getElementById("admin-bed-current-id").value = String(bed.id);
  document.getElementById("admin-bed-current-status").value = bed.status || "";
  document.getElementById("admin-bed-edit-id").value = String(bed.id);
  const select = document.getElementById("admin-bed-edit-enfermaria");
  select.innerHTML = "";
  for (const enfermaria of currentAdminWardDetails?.enfermarias || []) {
    select.appendChild(new Option(enfermaria, enfermaria));
  }
  if (bed.enfermaria) select.value = bed.enfermaria;
  setAdminBedEditFeedback(
    bed.status === "OCUPADO" || bed.nome
      ? "Leito ocupado: o sistema nao permite trocar numero ou enfermaria enquanto houver paciente internado."
      : ""
  );
  document.getElementById("modal-admin-bed")?.showModal();
}

async function saveAdminBedEdit() {
  if (!currentAdminBedEdit || !currentAdminWardDetails?.id) return;
  const nextBedId = parseInt(document.getElementById("admin-bed-edit-id").value, 10);
  const enfermaria = document.getElementById("admin-bed-edit-enfermaria").value;
  try {
    await api(`/api/wards/${currentAdminWardDetails.id}/beds/${currentAdminBedEdit.id}/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextBedId, enfermaria })
    });
    await refreshWards();
    await loadAdminWardDetails(currentAdminWardDetails.id);
    setAdminWardFeedback("Leito alterado com sucesso.");
    document.getElementById("modal-admin-bed")?.close();
    currentAdminBedEdit = null;
  } catch (error) {
    setAdminBedEditFeedback(error.message || "Nao foi possivel alterar o leito.", true);
  }
}

async function deleteAdminBed(bedId) {
  const bed = currentAdminWardDetails?.beds?.find(item => item.id === bedId);
  if (!bed || !currentAdminWardDetails?.id) return;
  if (bed.status === "OCUPADO" || bed.nome) {
    setAdminWardFeedback("Nao e possivel excluir leito com paciente internado.", true);
    return;
  }
  if (!confirm(`Excluir o leito ${bed.id} da enfermaria ${bed.enfermaria || "Sem enfermaria"}?`)) return;
  try {
    await api(`/api/wards/${currentAdminWardDetails.id}/beds/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enfermaria: bed.enfermaria || "", start: bed.id, end: bed.id })
    });
    await refreshWards();
    await loadAdminWardDetails(currentAdminWardDetails.id);
    setAdminWardFeedback("Leito excluido com sucesso.");
  } catch (error) {
    setAdminWardFeedback(error.message || "Nao foi possivel excluir o leito.", true);
  }
}

function renderAdminWardList() {
  const container = document.getElementById("admin-ward-list");
  const empty = document.getElementById("admin-ward-list-empty");
  if (!container || !empty) return;

  container.innerHTML = "";
  empty.classList.toggle("hidden", allWards.length > 0);

  for (const item of allWards) {
    const row = document.createElement("div");
    row.className = "patient-row";
    row.innerHTML = `
      <div>
        <strong>${item.nome || "-"}</strong>
        <span>${item.archived ? "Setor arquivado" : "Setor ativo"}</span>
      </div>
      <div>
        <strong>${item.enfermariasCount || 0}</strong>
        <span>Enfermarias</span>
      </div>
      <div>
        <strong>${item.bedsCount || 0}</strong>
        <span>Leitos</span>
      </div>
      <div class="patient-actions">
        <button type="button" class="ghost btn-ward-edit" data-id="${item.id}">Alterar</button>
        <button type="button" class="ghost btn-ward-archive" data-id="${item.id}">${item.archived ? "Reativar" : "Arquivar"}</button>
        <button type="button" class="ghost btn-ward-delete" data-id="${item.id}">Excluir</button>
      </div>
    `;
    container.appendChild(row);
  }
}

function focusAdminWard(wardId) {
  const select = document.getElementById("admin-ward-select-edit");
  const editor = document.getElementById("admin-ward-editor");
  if (!select) return;
  select.value = String(wardId);
  if (editor) editor.classList.remove("hidden");
  syncAdminWardEditForm();
  loadAdminWardDetails(parseInt(wardId, 10)).catch(() => {
    setAdminWardFeedback("Nao foi possivel carregar os leitos do setor.", true);
  });
  editor?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeAdminWardEditor() {
  document.getElementById("admin-ward-editor")?.classList.add("hidden");
}

async function updateSelectedWard() {
  const wardId = parseInt(document.getElementById("admin-ward-select-edit").value, 10);
  const nome = document.getElementById("admin-ward-edit-name").value.trim();
  if (!wardId) {
    setAdminWardFeedback("Selecione um setor.", true);
    return;
  }
  if (!nome) {
    setAdminWardFeedback("Informe o novo nome do setor.", true);
    return;
  }

  try {
    await api(`/api/wards/${wardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome })
    });
    await refreshWards();
    await refreshCurrentUser();
    if (currentWardId === wardId) await load();
    focusAdminWard(wardId);
    setAdminWardFeedback("Setor alterado com sucesso.");
  } catch (error) {
    setAdminWardFeedback(error.message || "Não foi possível alterar o setor.", true);
  }
}

async function toggleArchiveWard(wardId) {
  const selectedWard = allWards.find(item => item.id === wardId);
  if (!selectedWard) {
    setAdminWardFeedback("Selecione um setor.", true);
    return;
  }
  const nextArchived = !selectedWard.archived;
  const message = nextArchived
    ? `Arquivar o setor "${selectedWard.nome}"?`
    : `Reativar o setor "${selectedWard.nome}"?`;
  if (!confirm(message)) return;

  try {
    await api(`/api/wards/${wardId}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: nextArchived })
    });
    if (currentWardId === wardId && nextArchived) {
      currentWardId = wards.find(item => item.id !== wardId)?.id || null;
    }
    await refreshWards();
    await refreshCurrentUser();
    if (currentWardId) await load();
    else setAppEnabled(false);
    focusAdminWard(wardId);
    setAdminWardFeedback(nextArchived ? "Setor arquivado com sucesso." : "Setor reativado com sucesso.");
  } catch (error) {
    setAdminWardFeedback(error.message || "Não foi possível atualizar o setor.", true);
  }
}

async function deleteSelectedWard(wardId) {
  const selectedWard = allWards.find(item => item.id === wardId);
  if (!selectedWard) {
    setAdminWardFeedback("Selecione um setor.", true);
    return;
  }
  if (!confirm(`Excluir o setor "${selectedWard.nome}"?`)) return;

  try {
    await api(`/api/wards/${wardId}`, {
      method: "DELETE"
    });
    if (currentWardId === wardId) {
      currentWardId = wards.find(item => item.id !== wardId)?.id || null;
    }
    await refreshWards();
    await refreshCurrentUser();
    if (currentWardId) await load();
    else setAppEnabled(false);
    setAdminWardFeedback("Setor excluído com sucesso.");
  } catch (error) {
    setAdminWardFeedback(error.message || "Não foi possível excluir o setor.", true);
  }
}

function updateAdminEnfDropdown() {
  const bedSelect = document.getElementById("admin-ward-select-bed");
  if (!bedSelect) return;
  const wardId = parseInt(bedSelect.value, 10);
  const w = wards.find(x => x.id === wardId);
  const select = document.getElementById("admin-enf-select-bed");
  if (!select) return;
  select.innerHTML = "";
  if (w && w.enfermarias) {
    for (const enf of w.enfermarias) {
      select.appendChild(new Option(enf, enf));
    }
  }
}

document.getElementById("admin-ward-select-bed")?.addEventListener("change", updateAdminEnfDropdown);
document.getElementById("admin-ward-select-edit")?.addEventListener("change", syncAdminWardEditForm);
document.getElementById("admin-ward-select-edit")?.addEventListener("change", async event => {
  await loadAdminWardDetails(parseInt(event.target.value, 10));
});

function updateDeleteEnfDropdown() {
  const wardSelect = document.getElementById("admin-ward-select-del");
  if (!wardSelect) return;
  const wardId = parseInt(wardSelect.value, 10);
  const w = wards.find(x => x.id === wardId);
  const select = document.getElementById("admin-enf-select-del");
  if (!select) return;
  select.innerHTML = "";
  if (w && w.enfermarias) {
    for (const enf of w.enfermarias) {
      select.appendChild(new Option(enf, enf));
    }
  }
}

document.getElementById("admin-ward-select-del")?.addEventListener("change", updateDeleteEnfDropdown);

function updateTopbarWardSelectors() {
  const wardSelect = document.getElementById("topbar-ward-select");
  const enfSelect = document.getElementById("topbar-enf-select");
  if (!wardSelect || !enfSelect) return;

  wardSelect.innerHTML = "";
  for (const w of wards) {
    wardSelect.appendChild(new Option(w.nome, w.id));
  }

  if (currentWardId) wardSelect.value = String(currentWardId);
  else if (wards.length) wardSelect.value = String(wards[0].id);

  updateTopbarEnfSelect();
}

function updateTopbarEnfSelect() {
  const wardSelect = document.getElementById("topbar-ward-select");
  const enfSelect = document.getElementById("topbar-enf-select");
  if (!wardSelect || !enfSelect) return;

  const wardId = parseInt(wardSelect.value, 10);
  const selectedWard = wards.find(item => item.id === wardId);
  enfSelect.innerHTML = "";
  enfSelect.appendChild(new Option("Todas", ""));

  for (const enf of selectedWard?.enfermarias || []) {
    enfSelect.appendChild(new Option(enf, enf));
  }
}

function closeSidebarOnMobile() {
}

function syncStartupWardModalOptions() {
  const select = document.getElementById("modal-start-ward-select");
  if (!select) return;
  select.innerHTML = "";
  for (const w of wards) {
    select.appendChild(new Option(w.nome, w.id));
  }
  if (currentWardId && wards.some(item => item.id === currentWardId)) {
    select.value = String(currentWardId);
  }
}

function syncStartupShiftForm() {
  const serviceSelect = document.getElementById("modal-start-service-select");
  const shiftLength = document.getElementById("modal-start-shift-length");
  const wardField = document.getElementById("modal-start-ward-field");
  const periodField = document.getElementById("modal-start-period-field");
  const isWardShift = serviceSelect?.value === "ward";
  wardField?.classList.toggle("hidden", !isWardShift);
  periodField?.classList.toggle("hidden", !isWardShift);

  const fullDay = shiftLength?.value === "24H";
  const periodSelect = document.getElementById("modal-start-shift-period");
  if (periodSelect) {
    if (fullDay) periodSelect.value = "COMPLETO";
    periodSelect.disabled = !isWardShift || fullDay;
  }
}

function setStartupShiftFeedback(message, isError = false) {
  const feedback = document.getElementById("modal-start-shift-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("hidden", !message);
  feedback.classList.toggle("error-text", isError);
}

async function openSelectedWard(wardId) {
  if (!wardId) return;
  currentWardId = wardId;
  wardShiftPanelRequested = hasActiveWardShiftForCurrentWard();
  renderHeaderWardTabs();
  renderWardDetailToolbar();
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-psychology")?.classList.add("ghost");
  document.getElementById("nav-social-service")?.classList.add("ghost");
  document.getElementById("nav-portaria")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-nir")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
}

async function openWardInsideHome(wardId) {
  if (!wardId) return;
  currentWardId = wardId;
  wardShiftPanelRequested = hasActiveWardShiftForCurrentWard();
  renderHeaderWardTabs();
  renderWardDetailToolbar();
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-psychology")?.classList.add("ghost");
  document.getElementById("nav-social-service")?.classList.add("ghost");
  document.getElementById("nav-portaria")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-nir")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
}

function maybeOpenStartWardModal() {
  const modal = document.getElementById("modal-start-ward");
  if (!modal || currentUser?.activeShift) return;
  syncStartupWardModalOptions();
  syncStartupShiftForm();
  setStartupShiftFeedback("");
  if (!modal.open) {
    modal.showModal();
  }
}

async function openTopbarWard() {
  const wardId = parseInt(document.getElementById("topbar-ward-select")?.value, 10);
  if (!wardId) return;
  currentWardId = wardId;
  wardShiftPanelRequested = hasActiveWardShiftForCurrentWard();
  renderWardDetailToolbar();
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-psychology")?.classList.add("ghost");
  document.getElementById("nav-social-service")?.classList.add("ghost");
  document.getElementById("nav-portaria")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-nir")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
}

async function openTopbarEnfermaria() {
  const wardId = parseInt(document.getElementById("topbar-ward-select")?.value, 10);
  const enfermaria = document.getElementById("topbar-enf-select")?.value;
  if (!wardId) return;

  currentWardId = wardId;
  wardShiftPanelRequested = hasActiveWardShiftForCurrentWard();
  renderWardDetailToolbar();
  if (enfermaria) {
    pendingScrollEnf = `enf-${enfermaria.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-psychology")?.classList.add("ghost");
  document.getElementById("nav-social-service")?.classList.add("ghost");
  document.getElementById("nav-portaria")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-nir")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
}

async function openPatientsView() {
  await refreshWards();
  setAppEnabled(false);
  showOnly("view-patients");
  await loadPatientsRegistry();
  closeSidebarOnMobile();
}

async function openNirView() {
  await refreshWards();
  setAppEnabled(false);
  showOnly("view-nir");
  await loadNirPatientsView();
  closeSidebarOnMobile();
}

async function savePatientRegistry() {
  setPatientRegistryFeedback("");
  const payload = {
    nome: document.getElementById("patient-registry-name").value.trim(),
    cpf: normalizeCpf(document.getElementById("patient-registry-cpf").value),
    birthDate: document.getElementById("patient-registry-birthdate").value,
    phone: normalizePhone(document.getElementById("patient-registry-phone").value)
  };

  try {
    const isNew = !currentPatientRecord?.id;
    const pendingLink = pendingBedRegistryLink;
    const saved = await api(isNew ? "/api/patients" : `/api/patients/${currentPatientRecord.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    document.getElementById("modal-patient-registry")?.close();
    currentPatientRecord = saved?.patient || null;
    setPatientRegistryFeedback("");
    setPatientsFeedback(isNew ? "Paciente cadastrado com sucesso." : "Cadastro do paciente atualizado com sucesso.");
    await loadPatientsRegistry();
    await loadNirPatientsView();
    if (currentWardId && currentPatientRecord?.currentAdmission?.wardId === currentWardId) {
      await load();
    }
    if (!document.getElementById("view-social-service")?.classList.contains("hidden")) {
      await openSocialServiceView();
    }
    if (pendingLink?.bedId && normalizeCpf(payload.cpf) === normalizeCpf(pendingLink.cpf)) {
      pendingBedRegistryLink = null;
      await openPatientModal(pendingLink.bedId);
      applyRegistryPatientToBedForm(saved?.patient || currentPatientRecord);
      setPatientLookupFeedback("CPF cadastrado com sucesso. Agora conclua o registro do leito.");
    }
  } catch (error) {
    setPatientRegistryFeedback(error.message || "Não foi possível salvar o paciente.", true);
    setPatientsFeedback(error.message || "Não foi possível salvar o paciente.", true);
  }
}

async function deletePatientRegistry() {
  if (!currentPatientRecord?.id) return;
  if (!confirm(`Excluir o cadastro de ${currentPatientRecord.nome || "este paciente"}?`)) return;

  try {
    await api(`/api/patients/${currentPatientRecord.id}`, {
      method: "DELETE"
    });

    document.getElementById("modal-patient-registry")?.close();
    currentPatientRecord = null;
    setPatientsFeedback("Cadastro do paciente excluído com sucesso.");
    await loadPatientsRegistry();
    if (currentWardId) await load();
  } catch (error) {
    setPatientsFeedback(error.message || "Não foi possível excluir o paciente.", true);
  }
}

async function startApp(options = {}) {
  if (!options.skipUserRefresh) {
    await refreshCurrentUser();
  }
  await Promise.all([
    refreshStaffSuggestions(),
    refreshWards()
  ]);
  renderCurrentUser();
  const activeShift = currentUser?.activeShift || null;
  const activeServiceType = String(activeShift?.serviceType || "").trim().toUpperCase();
  if (activeServiceType === "PSICOLOGIA") {
    await openPsychologyView();
    return;
  }
  if (activeServiceType === "SERVICO_SOCIAL") {
    await openSocialServiceView();
    return;
  }
  if (activeShift?.wardId) {
    await openSelectedWard(activeShift.wardId);
    return;
  }
  setAppEnabled(false);
  showOnly("view-home");
  maybeOpenStartWardModal();
}

async function checkAuth() {
  try {
    // #region debug-point E:check-auth-start
    reportDebugEvent("E", "public/app.js:checkAuth:start", "[DEBUG] Auth check start");
    // #endregion
    const data = await api("/api/me");
    currentUser = data.user || null;
    await startApp({ skipUserRefresh: true });
    // #region debug-point E:check-auth-success
    reportDebugEvent("E", "public/app.js:checkAuth:success", "[DEBUG] Auth check success", {
      user: currentUser?.username || currentUser?.nome || ""
    });
    // #endregion
  } catch (error) {
    // #region debug-point E:check-auth-failure
    reportDebugEvent("E", "public/app.js:checkAuth:failure", "[DEBUG] Auth check failure");
    // #endregion
    currentUser = null;
    setAppEnabled(false);
    showOnly("view-login");
    setLoginFeedback(error?.isAuthError
      ? ""
      : "Banco central indisponível. O acesso e as gravações ficam bloqueados até a conexão voltar.");
  }
}

document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  setLoginFeedback("");
  try {
    const res = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (res.sid) {
      sessionId = res.sid;
      sessionStorage.setItem("sid", sessionId);
    }
    currentUser = res.user || null;
    document.getElementById("login-password").value = "";
    setLoginFeedback("");
    await startApp({ skipUserRefresh: true });
  } catch (e) {
    setLoginFeedback(e?.status === 401
      ? e.message
      : "Banco central indisponível. O acesso e as gravações ficam bloqueados até a conexão voltar.");
  }
});

async function doLogout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  sessionId = null;
  sessionStorage.removeItem("sid");
  currentWardId = null;
  wardShiftPanelRequested = false;
  ward = null;
  currentUser = null;
  lastClosedReport = null;
  await checkAuth();
}

document.getElementById("btn-logout-side")?.addEventListener("click", doLogout);
document.getElementById("btn-logout-top")?.addEventListener("click", doLogout);
document.getElementById("topbar-ward-select")?.addEventListener("change", async () => {
  updateTopbarEnfSelect();
  await refreshSidebarPatients();
});

document.getElementById("header-ward-tabs")?.addEventListener("click", async event => {
  const tab = event.target.closest(".hero-tab");
  if (!tab) return;
  const wardId = parseInt(tab.dataset.id, 10);
  if (!wardId) return;
  await openWardInsideHome(wardId);
});

document.getElementById("btn-gerenciar").addEventListener("click", async () => {
  if (!isAdminUser()) {
    setShiftFeedback("Somente administrador pode acessar o cadastro.", true);
    return;
  }
  await refreshWards();
  await loadAdminUsers();
  clearAdminUserForm();
  setAppEnabled(false);
  showOnly("view-admin");
});

document.getElementById("nav-gerenciar")?.addEventListener("click", async () => {
  if (!isAdminUser()) {
    setShiftFeedback("Somente administrador pode acessar o cadastro.", true);
    return;
  }
  await refreshWards();
  await loadAdminUsers();
  clearAdminUserForm();
  setAppEnabled(false);
  showOnly("view-admin");
  closeSidebarOnMobile();
});

document.getElementById("nav-dashboard")?.addEventListener("click", async () => {
  await refreshWards();
  setAppEnabled(false);
  showOnly("view-dashboard");
  await loadDashboard();
  closeSidebarOnMobile();
});

document.getElementById("nav-home")?.addEventListener("click", async () => {
  await refreshWards();
  wardShiftPanelRequested = false;
  setAppEnabled(false);
  showOnly("view-home");
  closeSidebarOnMobile();
});

document.getElementById("nav-psychology")?.addEventListener("click", openPsychologyView);
document.getElementById("nav-social-service")?.addEventListener("click", openSocialServiceView);
document.getElementById("nav-portaria")?.addEventListener("click", openPortariaView);
document.getElementById("nav-travel")?.addEventListener("click", openTravelView);
document.getElementById("nav-patients")?.addEventListener("click", openPatientsView);
document.getElementById("nav-nir")?.addEventListener("click", openNirView);
document.getElementById("btn-psychology-tab-queue")?.addEventListener("click", () => {
  setPsychologyActiveTab("queue");
});
document.getElementById("btn-psychology-tab-monthly")?.addEventListener("click", async () => {
  setPsychologyActiveTab("monthly");
  await loadPsychologyMonthlyAttendances();
});
document.getElementById("btn-social-service-tab-queue")?.addEventListener("click", () => {
  setSocialServiceActiveTab("queue");
});
document.getElementById("btn-social-service-tab-history")?.addEventListener("click", async () => {
  setSocialServiceActiveTab("history");
  await loadSocialServiceAttendances({ filterId: "social-service-history-filter" });
});
document.getElementById("btn-social-service-tab-age")?.addEventListener("click", async () => {
  setSocialServiceActiveTab("age");
  await loadSocialServiceAttendances({ filterId: "social-service-age-filter" });
});
document.getElementById("btn-refresh-social-service-history")?.addEventListener("click", () => loadSocialServiceAttendances({ filterId: "social-service-history-filter" }));
document.getElementById("social-service-history-filter")?.addEventListener("change", () => loadSocialServiceAttendances({ filterId: "social-service-history-filter" }));
document.getElementById("social-service-history-professional-search")?.addEventListener("input", () => {
  renderSocialServiceAttendances(socialServiceAttendanceSourceEntries);
});
document.getElementById("social-service-history-patient-search")?.addEventListener("input", () => {
  renderSocialServiceAttendances(socialServiceAttendanceSourceEntries);
});
document.getElementById("btn-refresh-social-service-age")?.addEventListener("click", () => loadSocialServiceAttendances({ filterId: "social-service-age-filter" }));
document.getElementById("social-service-age-filter")?.addEventListener("change", () => loadSocialServiceAttendances({ filterId: "social-service-age-filter" }));
document.getElementById("btn-close-social-service-patient-history")?.addEventListener("click", () => {
  document.getElementById("modal-social-service-patient-history")?.close();
});
document.getElementById("social-service-history-list")?.addEventListener("click", async event => {
  const deleteButton = event.target.closest(".btn-delete-social-service-attendance");
  if (!deleteButton) return;
  await deleteSocialServiceAttendanceEntry(deleteButton.dataset.id);
});
document.getElementById("btn-refresh-psychology-monthly")?.addEventListener("click", loadPsychologyMonthlyAttendances);
document.getElementById("psychology-monthly-filter")?.addEventListener("change", loadPsychologyMonthlyAttendances);
document.getElementById("btn-save-psychology-manual")?.addEventListener("click", savePsychologyManualRequest);

document.getElementById("btn-patient-new")?.addEventListener("click", openNewPatientRegistry);

document.getElementById("btn-patients-search")?.addEventListener("click", loadPatientsRegistry);

document.getElementById("patients-list")?.addEventListener("click", async event => {
  const openButton = event.target.closest(".btn-patient-open");
  if (openButton) {
    await openPatientRegistry(openButton.dataset.id);
    return;
  }

  const deleteButton = event.target.closest(".btn-patient-delete");
  if (deleteButton) {
    const patientId = deleteButton.dataset.id;
    const patient = registeredPatients.find(item => String(item.id) === String(patientId));
    if (!patient) return;
    currentPatientRecord = patient;
    await deletePatientRegistry();
  }
});

document.getElementById("tbody-leitos")?.addEventListener("click", async event => {
  const button = event.target.closest(".bed-request-chip");
  if (!button) return;
  const bedId = parseInt(button.dataset.bedId, 10);
  const requestKey = String(button.dataset.bedRequest || "").trim();
  if (!bedId || !requestKey) return;
  await updateBedRequestField(bedId, requestKey);
});

document.getElementById("psychology-list")?.addEventListener("click", async event => {
  const button = event.target.closest(".btn-save-psychology-record");
  if (!button) return;
  const card = button.closest("tr");
  await savePsychologyRecord(button.dataset.id, card);
});

document.getElementById("psychology-list")?.addEventListener("change", async event => {
  const select = event.target.closest(".psychology-status-select");
  if (!select) return;
  syncPsychologyStatusDraft(select.closest("tr"));
});

document.getElementById("portaria-list")?.addEventListener("click", async event => {
  const card = event.target.closest(".portaria-card");
  if (!card) return;
  await openPortariaVisitModal(card.dataset.id);
});

document.getElementById("portaria-list")?.addEventListener("keydown", async event => {
  const card = event.target.closest(".portaria-card");
  if (!card) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  await openPortariaVisitModal(card.dataset.id);
});

document.getElementById("btn-save-portaria-registry")?.addEventListener("click", async event => {
  event.preventDefault();
  await savePortariaVisitorRegistry();
});

document.getElementById("portaria-social-list")?.addEventListener("click", async event => {
  const registryButton = event.target.closest(".btn-open-social-patient-registry");
  if (registryButton) {
    await openSocialPatientRegistry(registryButton.dataset.id);
    return;
  }
  const formButton = event.target.closest(".btn-open-social-form");
  if (formButton) {
    openSocialServiceFormModal(formButton.dataset.id);
    return;
  }
  const printFormButton = event.target.closest(".btn-print-social-form");
  if (printFormButton) {
    printSocialServiceForm(printFormButton.dataset.id);
    return;
  }
  const historyButton = event.target.closest(".btn-open-social-history");
  if (historyButton) {
    await openSocialServicePatientHistory(historyButton.dataset.id);
    return;
  }
  const closeButton = event.target.closest(".btn-close-portaria-social");
  if (closeButton) {
    const row = closeButton.closest(".portaria-social-row");
    await closePortariaSocialSupport(closeButton.dataset.id, row);
    return;
  }
  const button = event.target.closest(".btn-save-portaria-social");
  if (!button) return;
  const row = button.closest(".portaria-social-row");
  await savePortariaSocialSupport(button.dataset.id, row);
});
document.getElementById("btn-save-social-service-form")?.addEventListener("click", saveSocialServiceFormModal);
document.getElementById("btn-close-social-service-form")?.addEventListener("click", () => {
  document.getElementById("modal-social-service-form")?.close();
  setSocialServiceFormFeedback("");
});
document.getElementById("btn-print-social-service-form")?.addEventListener("click", () => {
  const patient = portariaActivePatients.find(item => Number(item?.id) === Number(currentSocialServiceFormPatientId)) || null;
  if (!patient) return;
  printSocialServiceForm(patient, collectSocialServiceFormModalData());
});

for (const id of ["portaria-registry-access-code", "portaria-registry-visitor-name", "portaria-registry-sector-reason"]) {
  document.getElementById(id)?.addEventListener("keydown", async event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await savePortariaVisitorRegistry();
  });
}

document.getElementById("portaria-social-list")?.addEventListener("keydown", async event => {
  if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
  const row = event.target.closest(".portaria-social-row");
  if (!row) return;
  event.preventDefault();
  await savePortariaSocialSupport(row.dataset.id, row);
});

document.getElementById("btn-save-travel")?.addEventListener("click", async event => {
  event.preventDefault();
  await saveHospitalTrip();
});

for (const id of ["travel-origin", "travel-destination"]) {
  document.getElementById(id)?.addEventListener("keydown", async event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await saveHospitalTrip();
  });
}

for (const id of [
  "travel-patient-name",
  "travel-patient-cpf",
  "travel-patient-birthdate",
  "travel-patient-phone",
  "travel-patient-cep",
  "travel-patient-address",
  "travel-companion-name",
  "travel-companion-cpf",
  "travel-companion-address"
]) {
  document.getElementById(id)?.addEventListener("keydown", async event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    await saveHospitalTrip();
  });
}

document.getElementById("travel-destination")?.addEventListener("change", async () => {
  await refreshTravelEstimate(true);
});

document.getElementById("travel-destination")?.addEventListener("input", async event => {
  const value = event.target.value.trim();
  if (!value) {
    setTravelFeedback("");
    applyTravelEstimate(null);
    return;
  }
  if (maranhaoTravelCitiesLookup.has(value.toLocaleLowerCase("pt-BR"))) {
    await refreshTravelEstimate(true);
  }
});

for (const id of ["travel-companion-name", "travel-companion-cpf", "travel-companion-address"]) {
  document.getElementById(id)?.addEventListener("input", () => {
    updateTravelProcedureSummary();
  });
}

document.getElementById("travel-patient-phone")?.addEventListener("input", event => {
  event.target.value = formatPhone(event.target.value);
});

document.getElementById("travel-patient-cep")?.addEventListener("input", event => {
  event.target.value = formatCep(event.target.value);
});

document.getElementById("travel-list")?.addEventListener("click", event => {
  const button = event.target.closest(".btn-travel-bpa-report");
  if (!button) return;
  printTravelBpaReport(button.dataset.id);
});

document.getElementById("travel-batch-month")?.addEventListener("change", () => {
  updateTravelBatchSummary();
});

document.getElementById("btn-travel-bpa-batch")?.addEventListener("click", event => {
  event.preventDefault();
  printTravelBpaBatchReport();
});

document.getElementById("nir-list")?.addEventListener("click", async event => {
  const acceptButton = event.target.closest(".btn-nir-accept");
  if (acceptButton) {
    await markNirPatientAccepted(acceptButton.dataset.id);
    return;
  }

  const openButton = event.target.closest(".btn-nir-open");
  if (!openButton) return;
  await openPatientRegistry(openButton.dataset.id);
});

document.getElementById("nir-list")?.addEventListener("change", async event => {
  const channelButton = event.target.closest(".nir-channel-radio");
  if (!channelButton) return;
  await markNirPatientUpdated(channelButton.dataset.id, getSelectedNirChannels(channelButton.dataset.id));
});

document.getElementById("nir-list")?.addEventListener("input", event => {
  const sirelInput = event.target.closest(".nir-sirel-input");
  if (!sirelInput) return;
  sirelInput.value = String(sirelInput.value || "").replace(/\D/g, "").slice(0, 20);
  scheduleNirSirelSave(sirelInput.dataset.id, sirelInput.value);
});

document.getElementById("nir-list")?.addEventListener("change", async event => {
  const sirelInput = event.target.closest(".nir-sirel-input");
  if (!sirelInput) return;
  sirelInput.value = String(sirelInput.value || "").replace(/\D/g, "").slice(0, 20);
  await saveNirSirelValue(sirelInput.dataset.id, sirelInput.value);
});

document.getElementById("nir-accepted-list")?.addEventListener("click", async event => {
  const closeButton = event.target.closest(".btn-nir-close");
  if (closeButton) {
    await finalizeNirPatient(closeButton.dataset.id, "BAIXA");
    return;
  }

  const cancelButton = event.target.closest(".btn-nir-cancel");
  if (cancelButton) {
    await finalizeNirPatient(cancelButton.dataset.id, "CANCELADO");
    return;
  }

  const openButton = event.target.closest(".btn-nir-open");
  if (!openButton) return;
  await openPatientRegistry(openButton.dataset.id);
});

document.getElementById("nir-accepted-list")?.addEventListener("change", async event => {
  const channelButton = event.target.closest(".nir-channel-radio");
  if (!channelButton) return;
  await markNirPatientUpdated(channelButton.dataset.id, getSelectedNirChannels(channelButton.dataset.id));
});

document.getElementById("nir-accepted-list")?.addEventListener("input", event => {
  const sirelInput = event.target.closest(".nir-sirel-input");
  if (!sirelInput) return;
  sirelInput.value = String(sirelInput.value || "").replace(/\D/g, "").slice(0, 20);
  scheduleNirSirelSave(sirelInput.dataset.id, sirelInput.value);
});

document.getElementById("nir-accepted-list")?.addEventListener("change", async event => {
  const sirelInput = event.target.closest(".nir-sirel-input");
  if (!sirelInput) return;
  sirelInput.value = String(sirelInput.value || "").replace(/\D/g, "").slice(0, 20);
  await saveNirSirelValue(sirelInput.dataset.id, sirelInput.value);
});

document.getElementById("nir-previous-reports")?.addEventListener("click", event => {
  const button = event.target.closest(".btn-open-previous-nir-report");
  if (!button) return;
  openPreviousNirReport(button.dataset.reportId);
});

document.getElementById("patients-search")?.addEventListener("keydown", async event => {
  if (event.key === "Enter") {
    event.preventDefault();
    await loadPatientsRegistry();
  }
});

document.getElementById("patient-registry-cpf")?.addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});

document.getElementById("patient-registry-phone")?.addEventListener("input", event => {
  event.target.value = formatPhone(event.target.value);
});

document.getElementById("modal-nome")?.addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
  selectedRegistryPatient = null;
  setPatientLookupFeedback("");
  toggleCreatePatientButton(false);
});

document.getElementById("modal-nome")?.addEventListener("blur", async () => {
  await resolvePatientFromBedCpf({ openRegistryIfMissing: true });
});

document.getElementById("btn-modal-search-patient")?.addEventListener("click", async event => {
  event.preventDefault();
  await resolvePatientFromBedCpf({ openRegistryIfMissing: true });
});

document.getElementById("btn-modal-create-patient")?.addEventListener("click", event => {
  event.preventDefault();
  openPatientRegistryFromBedCpf();
});

document.getElementById("admin-user-cpf")?.addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});

document.getElementById("patient-registry-save")?.addEventListener("click", async event => {
  event.preventDefault();
  await savePatientRegistry();
});

document.getElementById("btn-save-portaria-visit")?.addEventListener("click", async event => {
  event.preventDefault();
  await savePortariaVisit();
});

document.getElementById("btn-save-nir-report")?.addEventListener("click", async event => {
  event.preventDefault();
  await saveNirReport();
});

document.getElementById("btn-print-nir-report")?.addEventListener("click", event => {
  event.preventDefault();
  printNirReport();
});

document.getElementById("patient-registry-delete")?.addEventListener("click", async event => {
  event.preventDefault();
  await deletePatientRegistry();
});

document.getElementById("btn-save-user")?.addEventListener("click", async () => {
  await saveAdminUser();
});

document.getElementById("btn-cancel-user-edit")?.addEventListener("click", () => {
  clearAdminUserForm();
  setAdminUsersFeedback("");
});

document.getElementById("admin-users-list")?.addEventListener("click", event => {
  const editButton = event.target.closest(".btn-admin-user-edit");
  if (!editButton) return;
  const user = adminUsers.find(item => String(item.id) === String(editButton.dataset.id));
  if (!user) return;
  fillAdminUserForm(user);
  setAdminUsersFeedback(`Alterando o usuário ${user.nome || user.username}.`);
});

document.getElementById("btn-voltar-home").addEventListener("click", async () => {
  await refreshWards();
  wardShiftPanelRequested = false;
  setAppEnabled(false);
  showOnly("view-dashboard");
  await loadDashboard();
  closeSidebarOnMobile();
});

document.getElementById("btn-back-to-sectors")?.addEventListener("click", async () => {
  await refreshWards();
  wardShiftPanelRequested = false;
  setAppEnabled(false);
  showOnly("view-home");
  closeSidebarOnMobile();
});

document.getElementById("btn-back-to-sectors-inline")?.addEventListener("click", async () => {
  await refreshWards();
  wardShiftPanelRequested = false;
  setAppEnabled(false);
  showOnly("view-home");
  closeSidebarOnMobile();
});

document.getElementById("btn-start-workshift")?.addEventListener("click", maybeOpenStartWardModal);

document.getElementById("btn-assume-ward-shift")?.addEventListener("click", () => {
  wardShiftPanelRequested = true;
  syncWardShiftEntryState();
  setShiftFeedback("");
});

async function openShiftForSelectedWard(wardId, options = {}) {
  const { openTeamModal = true, feedbackMessage = "Plantão aberto com sucesso." } = options;
  const shiftLength = normalizeShiftLength(document.getElementById("shift-length")?.value);
  const shiftPeriod = normalizeShiftPeriod(document.getElementById("shift-period")?.value, shiftLength);
  if (!wardId) {
    setShiftFeedback("Selecione um setor para abrir o plantão.", true);
    return false;
  }
  try {
    const res = await api("/api/shifts/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wardId, shiftLength, shiftPeriod })
    });
    currentUser = res.user || currentUser;
    currentWardId = wardId;
    wardShiftPanelRequested = true;
    await openSelectedWard(wardId);
    renderCurrentUser();
    setShiftFeedback(feedbackMessage);
    if (openTeamModal) openShiftTeamModal();
    return true;
  } catch (error) {
    setShiftFeedback(error.message || "Nao foi possivel abrir o plantao.", true);
    return false;
  }
}

async function openPsychologyShift() {
  if (currentUser?.activeShift) {
    const activeLabel = currentUser.activeShift.wardNome || "outro setor";
    setPsychologyShiftFeedback(`Ja existe um plantao aberto em ${activeLabel}. Feche o plantao atual para abrir o da Psicologia.`, true);
    return false;
  }

  const shiftLength = normalizeShiftLength(document.getElementById("psychology-shift-length")?.value);
  const shiftPeriod = getPsychologyAutoShiftPeriod(new Date(), shiftLength);

  try {
    const res = await api("/api/shifts/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceType: "PSICOLOGIA",
        shiftLength,
        shiftPeriod
      })
    });
    currentUser = res.user || currentUser;
    renderCurrentUser();
    setPsychologyShiftFeedback("Plantão da Psicologia aberto com sucesso.");
    return true;
  } catch (error) {
    const message = String(error?.message || "").includes("setor válido")
      ? "Nao foi possivel abrir o plantao da Psicologia."
      : (error.message || "Nao foi possivel abrir o plantao da Psicologia.");
    setPsychologyShiftFeedback(message, true);
    return false;
  }
}

async function openSocialServiceShift() {
  if (currentUser?.activeShift) {
    const activeLabel = currentUser.activeShift.wardNome || "outro setor";
    setSocialServiceShiftFeedback(`Ja existe um plantao aberto em ${activeLabel}. Feche o plantao atual para abrir o do Servico Social.`, true);
    return false;
  }

  const shiftLength = normalizeShiftLength(document.getElementById("social-service-shift-length")?.value);
  const shiftPeriod = getPsychologyAutoShiftPeriod(new Date(), shiftLength);

  try {
    const res = await api("/api/shifts/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceType: "SERVICO_SOCIAL",
        shiftLength,
        shiftPeriod
      })
    });
    currentUser = res.user || currentUser;
    try {
      const refreshedQueue = await buildServiceSocialQueueFromWards(wards);
      portariaActivePatients = refreshedQueue;
      renderPortariaSocialList(refreshedQueue);
      await loadSocialServiceAttendances({ silent: true });
    } catch {}
    renderCurrentUser();
    setSocialServiceShiftFeedback("Plantão do Serviço Social aberto com sucesso.");
    return true;
  } catch (error) {
    const message = String(error?.message || "").includes("setor válido")
      ? "Nao foi possivel abrir o plantao do Serviço Social."
      : (error.message || "Nao foi possivel abrir o plantao do Serviço Social.");
    setSocialServiceShiftFeedback(message, true);
    return false;
  }
}

async function closeActiveShift(options = {}) {
  const {
    psychologyMode = false,
    socialServiceMode = false,
    expectedServiceType = "",
    emptyMessage = "Não há plantão aberto para fechar.",
    mismatchMessage = "O plantão aberto neste acesso pertence a outra tela.",
    feedback = setShiftFeedback
  } = options;

  const activeShift = currentUser?.activeShift || null;
  const normalizedExpectedServiceType = String(expectedServiceType || "").trim().toUpperCase();
  const activeServiceType = String(activeShift?.serviceType || "").trim().toUpperCase();

  if (!activeShift) {
    feedback(emptyMessage, true);
    return;
  }

  if (normalizedExpectedServiceType && activeServiceType !== normalizedExpectedServiceType) {
    feedback(mismatchMessage, true);
    return;
  }

  if (!confirm("Fechar o plantão e imprimir a ficha de resumo?")) return;

  if (psychologyMode || normalizedExpectedServiceType === "PSICOLOGIA") {
    try {
      await saveAllPsychologyRecords({ silent: true });
    } catch (error) {
      feedback(error.message || "Nao foi possivel salvar as evolucoes da Psicologia antes de fechar o plantao.", true);
      return;
    }
  }

  const psychologyRows = psychologyMode ? buildPsychologyPrintRows(psychologyActivePatients) : [];
  const socialServiceRows = socialServiceMode ? buildSocialServicePrintRows(portariaActivePatients.filter(hasServiceSocialRequest)) : [];
  const nursingReport = String(document.getElementById("shift-nursing-report")?.value || "").trim();
  try {
    const res = await api("/api/shifts/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nursingReport })
    });
    currentUser = res.user || currentUser;
    if (socialServiceMode) {
      try {
        const refreshedQueue = await buildServiceSocialQueueFromWards(wards);
        portariaActivePatients = refreshedQueue;
        renderPortariaSocialList(refreshedQueue);
        await loadSocialServiceAttendances({ silent: true });
      } catch {}
    }
    lastClosedReport = res.report ? {
      ...res.report,
      printMode: psychologyMode ? "psychology" : (socialServiceMode ? "social_service" : "default"),
      psychologyRows,
      socialServiceRows: (res.report?.socialServiceRows || []).length ? res.report.socialServiceRows : socialServiceRows
    } : null;
    if (!psychologyMode && !socialServiceMode) {
      wardShiftPanelRequested = false;
    }
    renderCurrentUser();
    feedback(
      psychologyMode
        ? "Plantão da Psicologia fechado. Abrindo ficha para impressão."
        : (socialServiceMode
            ? "Plantão do Serviço Social fechado. As observações da fila foram limpas e o histórico ficou salvo."
            : "Plantão fechado e evoluções salvas. Abrindo ficha para impressão.")
    );
    if (lastClosedReport?.printMode === "psychology") {
      printPsychologyShiftReport(lastClosedReport);
    } else if (lastClosedReport?.printMode === "social_service") {
      printSocialServiceShiftReport(lastClosedReport);
    } else {
      printShiftReport(lastClosedReport);
    }
    setAppEnabled(false);
    showOnly("view-home");
    window.setTimeout(maybeOpenStartWardModal, 250);
  } catch (error) {
    feedback(error.message || "Nao foi possivel fechar o plantao.", true);
  }
}

async function saveShiftNursingReport() {
  if (!currentUser?.activeShift) {
    setShiftFeedback("Abra o plantão antes de salvar o relatório de enfermagem.", true);
    return;
  }
  const nursingReport = String(document.getElementById("shift-nursing-report")?.value || "").trim();
  try {
    const res = await api("/api/shifts/nursing-report", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nursingReport })
    });
    currentUser = res.user || currentUser;
    renderCurrentUser();
    setShiftFeedback("Relatório de enfermagem salvo neste plantão.");
  } catch (error) {
    setShiftFeedback(error.message || "Nao foi possivel salvar o relatório de enfermagem.", true);
  }
}

function reprintLastShiftReport(feedback = setShiftFeedback) {
  if (!lastClosedReport) {
    feedback("Ainda não existe ficha encerrada para reimpressão.", true);
    return;
  }
  feedback("Reabrindo a última ficha de plantão.");
  if (lastClosedReport?.printMode === "psychology") {
    printPsychologyShiftReport(lastClosedReport);
  } else if (lastClosedReport?.printMode === "social_service") {
    printSocialServiceShiftReport(lastClosedReport);
  } else {
    printShiftReport(lastClosedReport);
  }
}

document.getElementById("btn-open-shift")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("shift-ward").value, 10);
  await openShiftForSelectedWard(wardId);
});

document.getElementById("btn-open-team-modal")?.addEventListener("click", () => {
  openShiftTeamModal();
});

document.getElementById("btn-save-shift-nursing-report")?.addEventListener("click", async () => {
  await saveShiftNursingReport();
});

document.getElementById("shift-nursing-report")?.addEventListener("input", event => {
  if (!currentUser?.activeShift) return;
  currentUser.activeShift.nursingReport = String(event.target.value || "");
});

document.getElementById("btn-close-shift-team")?.addEventListener("click", () => {
  document.getElementById("modal-shift-team")?.close();
});

document.getElementById("modal-start-service-select")?.addEventListener("change", syncStartupShiftForm);
document.getElementById("modal-start-shift-length")?.addEventListener("change", syncStartupShiftForm);

document.getElementById("btn-confirm-start-ward")?.addEventListener("click", async event => {
  event.preventDefault();
  const modal = document.getElementById("modal-start-ward");
  const button = event.currentTarget;
  const serviceType = document.getElementById("modal-start-service-select")?.value || "ward";
  const shiftLength = normalizeShiftLength(document.getElementById("modal-start-shift-length")?.value);
  let opened = false;
  let failureMessage = "Não foi possível abrir o plantão. Confira os dados e tente novamente.";

  if (serviceType === "ward") {
    const wardId = parseInt(document.getElementById("modal-start-ward-select")?.value, 10);
    if (!wardId) {
      setStartupShiftFeedback("Selecione o setor onde você vai trabalhar.", true);
      return;
    }
    const shiftPeriod = normalizeShiftPeriod(
      document.getElementById("modal-start-shift-period")?.value,
      shiftLength
    );
    const wardField = document.getElementById("shift-ward");
    const wardLength = document.getElementById("shift-length");
    const wardPeriod = document.getElementById("shift-period");
    if (wardField) wardField.value = String(wardId);
    if (wardLength) wardLength.value = shiftLength;
    if (wardPeriod) wardPeriod.value = shiftPeriod;
  } else if (serviceType === "PSICOLOGIA") {
    const lengthField = document.getElementById("psychology-shift-length");
    if (lengthField) lengthField.value = shiftLength;
  } else if (serviceType === "SERVICO_SOCIAL") {
    const lengthField = document.getElementById("social-service-shift-length");
    if (lengthField) lengthField.value = shiftLength;
  }

  button.disabled = true;
  button.textContent = "Abrindo plantão...";
  setStartupShiftFeedback("");
  modal?.close();

  try {
    if (serviceType === "ward") {
      const wardId = parseInt(document.getElementById("modal-start-ward-select")?.value, 10);
      opened = await openShiftForSelectedWard(wardId, {
        feedbackMessage: "Plantão aberto no seu nome com sucesso."
      });
      failureMessage = document.getElementById("shift-feedback")?.textContent || failureMessage;
    } else if (serviceType === "PSICOLOGIA") {
      opened = await openPsychologyShift();
      failureMessage = document.getElementById("psychology-shift-feedback")?.textContent || failureMessage;
      if (opened) await openPsychologyView();
    } else if (serviceType === "SERVICO_SOCIAL") {
      opened = await openSocialServiceShift();
      failureMessage = document.getElementById("social-service-shift-feedback")?.textContent || failureMessage;
      if (opened) await openSocialServiceView();
    }
  } catch (error) {
    failureMessage = error.message || failureMessage;
  } finally {
    button.disabled = false;
    button.textContent = "Abrir plantão e continuar";
  }

  if (!opened) {
    modal?.showModal();
    syncStartupShiftForm();
    setStartupShiftFeedback(failureMessage, true);
  }
});

document.getElementById("shift-length")?.addEventListener("change", syncShiftFormVisibility);
document.getElementById("shift-period")?.addEventListener("change", syncShiftFormVisibility);
document.getElementById("psychology-shift-length")?.addEventListener("change", syncPsychologyShiftFormVisibility);
document.getElementById("social-service-shift-length")?.addEventListener("change", syncSocialServiceShiftFormVisibility);
document.getElementById("btn-open-psychology-shift")?.addEventListener("click", openPsychologyShift);
document.getElementById("btn-open-social-service-shift")?.addEventListener("click", openSocialServiceShift);

document.getElementById("btn-close-shift")?.addEventListener("click", async () => {
  await closeActiveShift({
    psychologyMode: isPsychologyViewVisible(),
    feedback: setShiftFeedback
  });
});

document.getElementById("btn-print-last-shift")?.addEventListener("click", () => {
  reprintLastShiftReport(setShiftFeedback);
});
document.getElementById("btn-print-last-psychology-shift")?.addEventListener("click", () => {
  reprintLastShiftReport(setPsychologyShiftFeedback);
});
document.getElementById("btn-print-last-social-service-shift")?.addEventListener("click", () => {
  reprintLastShiftReport(setSocialServiceShiftFeedback);
});
document.getElementById("btn-print-social-service-sector")?.addEventListener("click", () => {
  printSocialServiceSectorReport(portariaActivePatients.filter(hasServiceSocialRequest));
});
document.getElementById("btn-close-psychology-shift")?.addEventListener("click", async () => {
  await closeActiveShift({
    psychologyMode: true,
    expectedServiceType: "PSICOLOGIA",
    emptyMessage: "Nao ha plantao aberto da Psicologia para fechar.",
    mismatchMessage: "O plantao aberto neste acesso pertence a outro setor ou servico. Feche-o pela tela correspondente antes de encerrar o da Psicologia.",
    feedback: setPsychologyShiftFeedback
  });
});
document.getElementById("btn-close-social-service-shift")?.addEventListener("click", async () => {
  await closeActiveShift({
    psychologyMode: false,
    socialServiceMode: true,
    expectedServiceType: "SERVICO_SOCIAL",
    emptyMessage: "Nao ha plantao aberto do Servico Social para fechar.",
    mismatchMessage: "O plantao aberto neste acesso pertence a outro setor ou servico. Feche-o pela tela correspondente antes de encerrar o do Servico Social.",
    feedback: setSocialServiceShiftFeedback
  });
});

document.getElementById("btn-whatsapp-shift")?.addEventListener("click", openWhatsAppSummary);
document.getElementById("btn-whatsapp-maintenance")?.addEventListener("click", openGeneralMaintenanceSummary);
document.getElementById("btn-whatsapp-open-group")?.addEventListener("click", async event => {
  event.preventDefault();
  if (!pendingWhatsAppMessage) {
    setShiftFeedback("Nenhuma solicitacao foi gerada ainda.", true);
    return;
  }
  await sendWhatsAppMessageNow(pendingWhatsAppMessage, WHATSAPP_MAINTENANCE_LINK);
  document.getElementById("modal-whatsapp-preview")?.close();
});

document.getElementById("btn-criar-ward").addEventListener("click", async () => {
  const nome = document.getElementById("admin-ward-name").value.trim();
  if (!nome) return;
  try {
    await api("/api/wards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome })
    });
    document.getElementById("admin-ward-name").value = "";
    await refreshWards();
    await refreshCurrentUser();
  } catch (e) {
    showUnexpectedError(e);
  }
});

document.getElementById("btn-update-ward")?.addEventListener("click", async () => {
  await updateSelectedWard();
});

document.getElementById("btn-delete-ward")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-edit").value, 10);
  await deleteSelectedWard(wardId);
});

document.getElementById("btn-archive-ward")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-edit").value, 10);
  await toggleArchiveWard(wardId);
});

document.getElementById("btn-close-ward-editor")?.addEventListener("click", () => {
  closeAdminWardEditor();
  setAdminWardFeedback("");
});

document.getElementById("admin-ward-list")?.addEventListener("click", async event => {
  const editButton = event.target.closest(".btn-ward-edit");
  if (editButton) {
    focusAdminWard(editButton.dataset.id);
    setAdminWardFeedback("Setor selecionado para alteração.");
    return;
  }

  const archiveButton = event.target.closest(".btn-ward-archive");
  if (archiveButton) {
    await toggleArchiveWard(parseInt(archiveButton.dataset.id, 10));
    return;
  }

  const deleteButton = event.target.closest(".btn-ward-delete");
  if (deleteButton) {
    await deleteSelectedWard(parseInt(deleteButton.dataset.id, 10));
  }
});

document.getElementById("admin-bed-list")?.addEventListener("click", async event => {
  const editButton = event.target.closest(".btn-admin-bed-edit");
  if (editButton) {
    openAdminBedEditModal(parseInt(editButton.dataset.id, 10));
    return;
  }

  const deleteButton = event.target.closest(".btn-admin-bed-delete");
  if (deleteButton) {
    await deleteAdminBed(parseInt(deleteButton.dataset.id, 10));
  }
});

document.getElementById("btn-save-admin-bed")?.addEventListener("click", async event => {
  event.preventDefault();
  await saveAdminBedEdit();
});

document.getElementById("btn-criar-enf")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-enf").value, 10);
  const input = document.getElementById("admin-enf-name");
  const nome = input.value.trim();
  if (!nome || !wardId) return;
  try {
    await api(`/api/wards/${wardId}/enfermarias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome })
    });
    input.value = "";
    await refreshWards();
    document.getElementById("admin-ward-select-bed").value = String(wardId);
    updateAdminEnfDropdown();
    document.getElementById("admin-enf-select-bed").value = nome;
    document.getElementById("admin-ward-select-del").value = String(wardId);
    updateDeleteEnfDropdown();
    document.getElementById("admin-enf-select-del").value = nome;
    await refreshCurrentUser();
    syncAdminWardEditorFlow();
    setAdminWardFeedback("Enfermaria criada. Agora voce pode cadastrar os leitos.");
  } catch (e) {
    showUnexpectedError(e);
  }
});

document.getElementById("btn-add-beds").addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-bed").value, 10);
  const enfermariaValue = document.getElementById("admin-enf-select-bed").value;
  const enfermaria = String(enfermariaValue || "").trim();
  const start = parseInt(document.getElementById("admin-bed-start").value, 10);
  const end = parseInt(document.getElementById("admin-bed-end").value, 10);
  if (!enfermaria) {
    setAdminWardFeedback("Crie ou selecione uma enfermaria antes de cadastrar os leitos.", true);
    return;
  }
  try {
    await api(`/api/wards/${wardId}/beds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enfermaria, start, end })
    });
    document.getElementById("admin-bed-start").value = "";
    document.getElementById("admin-bed-end").value = "";
    await refreshWards();
    await refreshCurrentUser();
    setAdminWardFeedback("Leitos cadastrados com sucesso.");
  } catch (e) {
    showUnexpectedError(e);
  }
});

document.getElementById("btn-del-beds")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-del").value, 10);
  const enfermariaValue = document.getElementById("admin-enf-select-del").value;
  const enfermaria = String(enfermariaValue || "").trim();
  const start = document.getElementById("del-bed-start").value;
  const end = document.getElementById("del-bed-end").value;
  const labelBase = enfermaria ? `da enfermaria ${enfermaria}` : "sem enfermaria";
  const label = start || end ? `${labelBase} (intervalo ${start || "…"}–${end || "…"})` : `${labelBase} (todos)`;
  if (!confirm(`Excluir leitos ${label}?`)) return;
  try {
    await api(`/api/wards/${wardId}/beds/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enfermaria, start, end })
    });
    document.getElementById("del-bed-start").value = "";
    document.getElementById("del-bed-end").value = "";
    await refreshWards();
    await refreshCurrentUser();
    if (currentWardId === wardId) await load();
  } catch (e) {
    showUnexpectedError(e);
  }
});

document.getElementById("btn-del-enf")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-del").value, 10);
  const enfermaria = document.getElementById("admin-enf-select-del").value;
  if (!enfermaria) {
    alert("Selecione uma enfermaria.");
    return;
  }
  if (!confirm(`Excluir a enfermaria "${enfermaria}" e todos os leitos dela?`)) return;
  try {
    await api(`/api/wards/${wardId}/enfermarias/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enfermaria })
    });
    await refreshWards();
    await refreshCurrentUser();
    if (currentWardId === wardId) await load();
    syncAdminWardEditorFlow();
    setAdminWardFeedback("Enfermaria excluida com sucesso.");
  } catch (e) {
    showUnexpectedError(e);
  }
});

document.getElementById("sidebar-patient-cpf")?.addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});

document.getElementById("btn-sidebar-toggle")?.addEventListener("click", () => {
  toggleSidebarCollapsedState();
});

window.addEventListener("resize", () => {
  syncSidebarCollapsedForViewport();
});

document.getElementById("btn-sidebar-save-patient")?.addEventListener("click", async () => {
  const wardId = getSidebarWardId();
  const bedId = parseInt(document.getElementById("sidebar-patient-bed").value, 10);
  const nome = document.getElementById("sidebar-patient-name").value.trim();
  const cpf = normalizeCpf(document.getElementById("sidebar-patient-cpf").value);
  const birthDate = document.getElementById("sidebar-patient-birthdate").value;
  const admissao = document.getElementById("sidebar-patient-admission").value;

  if (!wardId) {
    setSidebarPatientFeedback("Selecione um setor para cadastrar o paciente.", true);
    return;
  }
  if (!Number.isInteger(bedId)) {
    setSidebarPatientFeedback("Selecione um leito disponível.", true);
    return;
  }
  if (!nome) {
    setSidebarPatientFeedback("Informe o nome do paciente.", true);
    return;
  }
  if (!cpf || cpf.length !== 11) {
    setSidebarPatientFeedback("Informe um CPF válido com 11 dígitos.", true);
    return;
  }
  if (!birthDate) {
    setSidebarPatientFeedback("Informe a data de nascimento.", true);
    return;
  }

  try {
    await api(`/api/wards/${wardId}/beds/${bedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "OCUPADO", nome, cpf, birthDate, admissao })
    });
    clearSidebarPatientForm();
    setSidebarPatientFeedback("Paciente cadastrado com sucesso.");
    if (currentWardId !== wardId) currentWardId = wardId;
    await refreshSidebarPatients();
    await load();
  } catch (error) {
    setSidebarPatientFeedback(error.message || "Não foi possível cadastrar o paciente.", true);
  }
});

initializeSidebarPreference();
checkAuth();
