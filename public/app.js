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

const procedureOptions = ["SNE", "SNG", "SANGUE", "ASPIRAÇÃO", "PASSAGEM DE SONDA"];
const NO_ENFERMARIA_VALUE = "__SEM_ENFERMARIA__";
const ALL_ENFERMARIA_VALUE = "__TODAS_ENFERMARIAS__";
const WHATSAPP_CENTRAL_AIR_LINK = "https://chat.whatsapp.com/FbxcYoy45yCD1TW6eZwGKd";
const WHATSAPP_MAINTENANCE_LINK = "https://chat.whatsapp.com/FbxcYoy45yCD1TW6eZwGKd";

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

function formatCpf(value) {
  const digits = normalizeCpf(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
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
  const ids = ["modal-nome", "modal-admissao", "modal-diagnostico", "modal-pendencias", "modal-nir", "modal-cil"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = !enabled;
    if (!enabled) el.classList.add("muted");
    else el.classList.remove("muted");
  }
}

function clearPatientFields() {
  document.getElementById("modal-nome").value = "";
  document.getElementById("modal-admissao").value = "";
  document.getElementById("modal-diagnostico").value = "";
  document.getElementById("modal-pendencias").value = "";
  document.getElementById("modal-nir").value = "";
  document.getElementById("modal-cil").value = "";
  setPatientIdentityDisplay("", "");
  selectedRegistryPatient = null;
  setPatientLookupFeedback("");
  toggleCreatePatientButton(false);
}

function showOnly(viewId) {
  const ids = ["view-login", "view-dashboard", "view-home", "view-patients", "view-nir", "view-admin"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("hidden", id !== viewId);
  }
  const navMap = {
    "view-dashboard": "nav-dashboard",
    "view-home": "nav-home",
    "view-patients": "nav-patients",
    "view-nir": "nav-nir",
    "view-admin": "nav-gerenciar"
  };
  for (const id of ["nav-dashboard", "nav-home", "nav-patients", "nav-nir", "nav-gerenciar"]) {
    document.getElementById(id)?.classList.toggle("ghost", navMap[viewId] !== id);
  }
  document.body.classList.toggle("login-only", viewId === "view-login");
}

function setAppEnabled(enabled) {
  document.querySelector(".plantao")?.classList.toggle("hidden", !enabled);
  document.querySelector(".cards")?.classList.toggle("hidden", !enabled);
  document.querySelector(".indicadores")?.classList.toggle("hidden", !enabled);
  document.querySelector(".tabela")?.classList.toggle("hidden", !enabled);
}

async function api(path, options) {
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
    throw new Error(msg);
  }
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

function normalizeShiftLength(value) {
  return String(value || "").trim().toUpperCase() === "24H" ? "24H" : "12H";
}

function normalizeShiftPeriod(value, shiftLength = "12H") {
  if (normalizeShiftLength(shiftLength) === "24H") return "COMPLETO";
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "NOITE" ? "NOITE" : "DIA";
}

function getShiftPeriodLabel(value) {
  if (value === "NOITE") return "Noite";
  if (value === "COMPLETO") return "Completo";
  return "Dia";
}

function getActiveShiftTeam() {
  const activeShift = currentUser?.activeShift || null;
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
  document.getElementById("modal-nir").value = patient.nir || "";
  document.getElementById("modal-cil").value = patient.cil || "";
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
      <span>Aberto por ${currentUser?.nome || currentUser?.username || "-"} em ${toBRDateTime(activeShift.openedAt)}</span>
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
  const shiftDate = document.getElementById("shift-date");
  if (shiftDate) shiftDate.value = activeShift?.shiftDate || getTodayIsoDate();
  document.getElementById("eq-medico").value = team?.medicoPlantao || "";
  document.getElementById("eq-enf-dia").value = team?.enfermeiroDia || "";
  document.getElementById("eq-tec-dia").value = team?.tecnicosDia || "";
  document.getElementById("eq-enf-noite").value = team?.enfermeiroNoite || "";
  document.getElementById("eq-tec-noite").value = team?.tecnicosNoite || "";
  document.getElementById("eq-faltosos").value = team?.faltosos || "";
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
}

function renderHeaderWardTabs() {
  const container = document.getElementById("header-ward-tabs");
  if (!container) return;
  container.innerHTML = "";

  for (const item of wards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hero-tab${item.id === currentWardId ? " active" : ""}`;
    button.dataset.id = String(item.id);
    button.textContent = item.nome || "-";
    container.appendChild(button);
  }
}

function renderPatientCurrentAdmission(admission) {
  const container = document.getElementById("patient-registry-current");
  if (!container) return;
  if (!admission) {
    container.textContent = "Paciente sem internação ativa no momento.";
    return;
  }
  container.innerHTML = `
    <strong>${admission.wardNome || "-"} • Leito ${admission.bedId || "-"}</strong>
    <div>Enfermaria: ${admission.enfermaria || "Sem enfermaria"}</div>
    <div>Admissão: ${admission.admittedAt ? toBRDate(admission.admittedAt) : "-"}</div>
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
  document.getElementById("patient-registry-title").textContent = patient.nome || "Novo paciente";
  document.getElementById("patient-registry-name").value = patient.nome || "";
  document.getElementById("patient-registry-cpf").value = formatCpf(patient.cpf || "");
  document.getElementById("patient-registry-birthdate").value = patient.birthDate || "";
  document.getElementById("patient-registry-cil").value = patient.cil || "";
  setPatientRegulationChannels(patient.regulationChannels || []);
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
  const popup = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
  if (!popup) {
    setNirReportFeedback("Não foi possível abrir a janela de impressão.", true);
    return;
  }

  setNirReportFeedback("Folha do relatório aberta. Na nova aba, clique em 'Imprimir / Salvar PDF'.");

  popup.document.write(`<!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>PDF do Plantão</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #e5edf5; color: #102a43; }
        .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px; align-items: center; padding: 14px 18px; background: #102a43; color: #fff; }
        .toolbar button { padding: 10px 16px; border: 0; border-radius: 8px; background: #16a34a; color: #fff; font-weight: 700; cursor: pointer; }
        .toolbar span { font-size: 14px; }
        .page-wrap { padding: 24px; display: flex; justify-content: center; }
        .sheet { width: 210mm; min-height: 297mm; background: #fff; box-shadow: 0 12px 40px rgba(16, 42, 67, 0.18); padding: 18mm 14mm; }
        h1, h2, h3 { margin: 0 0 12px; }
        .meta { margin-bottom: 20px; font-weight: 700; }
        .section { margin-top: 22px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #8ea3c2; padding: 8px; font-size: 12px; text-align: left; vertical-align: top; }
        th { background: #c4d8f4; }
        .empty { padding: 12px; border: 1px solid #8ea3c2; background: #f8fbff; }
        .print-report { border: 1px solid #8ea3c2; background: #f8fbff; padding: 12px; white-space: pre-wrap; }
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
          <h1>Relatório do Plantão</h1>
          <div class="meta">Data: ${escapeHtml(operationalDate)} | Enfermeiro: ${escapeHtml(currentUser?.nome || currentUser?.username || "-")}</div>
          <div class="section">
            <h2>Pacientes em CIL</h2>
            ${buildNirPrintTable(cilPatients, "Nenhum paciente em CIL neste dia operacional.")}
          </div>
          <div class="section">
            <h2>Pacientes Aceitos</h2>
            ${buildNirPrintTable(nirAcceptedPatients, "Nenhum paciente aceito neste dia operacional.")}
          </div>
          <div class="section">
            <h2>Relatório de Enfermagem</h2>
            <div class="print-report">${escapeHtml(reportText)}</div>
          </div>
        </div>
      </div>
    </body>
  </html>`);
  popup.document.close();
  popup.focus();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildNirPrintTable(items = [], emptyMessage = "Nenhum paciente.") {
  if (!items.length) return `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
  const rows = items.map(patient => {
    const current = patient.currentAdmission || {};
    const via = Array.isArray(patient.regulationChannels) && patient.regulationChannels.length ? patient.regulationChannels.join(" / ") : "-";
    const accepted = patient.regulationAcceptedAt ? toBRDateTime(patient.regulationAcceptedAt) : "-";
    return `
      <tr>
        <td>${escapeHtml(current.wardNome || "-")}</td>
        <td>${escapeHtml(patient.nome || "-")}<br>CPF ${escapeHtml(formatCpf(patient.cpf || "") || "-")}</td>
        <td>${escapeHtml(current.bedId || "-")}</td>
        <td>${escapeHtml(patient.nir || "-")}</td>
        <td>${escapeHtml(patient.cil || "-")}</td>
        <td>${escapeHtml(via)}</td>
        <td>${escapeHtml(accepted)}</td>
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
          <th>NIR</th>
          <th>CIL</th>
          <th>Via</th>
          <th>Aceito em</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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
    const current = patient.currentAdmission;
    const currentWard = current?.wardNome || "-";
    const currentBed = current?.bedId || "-";
    const admittedAt = current?.admittedAt ? toBRDate(current.admittedAt) : "-";
    const regulationDate = patient.updatedAt ? toBRDate(String(patient.updatedAt).slice(0, 10)) : "-";
    const updatedToday = isUpdatedInCurrentOperationalDay(patient.nirLastUpdateAt);
    const updateLabel = updatedToday ? "SIM" : "ATUALIZAR";
    const updateChannels = Array.isArray(patient.nirUpdateChannels) && patient.nirUpdateChannels.length
      ? patient.nirUpdateChannels.join(" / ")
      : "";
    const updateTooltip = patient.nirLastUpdateAt
      ? `Última atualização: ${toBRDateTime(patient.nirLastUpdateAt)}${patient.nirLastUpdateBy ? ` • ${patient.nirLastUpdateBy}` : ""}${updateChannels ? ` • ${updateChannels}` : ""}`
      : "Clique para registrar atualização de CIL ou EMAIL.";
    const specialty = patient.nir || patient.diagnostico || "-";
    const regulationChannels = Array.isArray(patient.regulationChannels) && patient.regulationChannels.length
      ? patient.regulationChannels.join(" / ")
      : "-";
    const acceptedLabel = patient.regulationAcceptedAt ? `Aceito em ${toBRDateTime(patient.regulationAcceptedAt)}` : "Ainda aguardando aceite";
    row.innerHTML = `
      <td>${currentWard}</td>
      <td>
        <strong>${patient.nome || "-"}</strong>
        <span>CPF ${formatCpf(patient.cpf || "") || "-"}</span>
      </td>
      <td>${currentBed}</td>
      <td><strong>${patient.nir || "-"}</strong><span>Via ${regulationChannels}</span></td>
      <td>${admittedAt}</td>
      <td>${specialty}</td>
      <td>${regulationDate}</td>
      <td>${patient.cil || "-"}</td>
      <td class="${updatedToday ? "nir-table-yes" : "nir-table-no"}">
        <button type="button" class="nir-status-button ${updatedToday ? "is-updated" : "is-pending"} btn-nir-status" data-id="${patient.id}" title="${updateTooltip}">${updateLabel}</button>
      </td>
      <td>
        <div class="nir-actions">
          <button type="button" class="ghost btn-nir-open" data-id="${patient.id}">Abrir</button>
          <button type="button" class="ghost btn-nir-accept" data-id="${patient.id}" title="${acceptedLabel}">Aceito</button>
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
    const current = patient.currentAdmission;
    const currentWard = current?.wardNome || "-";
    const currentBed = current?.bedId || "-";
    const admittedAt = current?.admittedAt ? toBRDate(current.admittedAt) : "-";
    const regulationDate = patient.updatedAt ? toBRDate(String(patient.updatedAt).slice(0, 10)) : "-";
    const specialty = patient.nir || patient.diagnostico || "-";
    const acceptedAt = patient.regulationAcceptedAt ? toBRDateTime(patient.regulationAcceptedAt) : "-";
    const regulationChannels = Array.isArray(patient.regulationChannels) && patient.regulationChannels.length
      ? patient.regulationChannels.join(" / ")
      : "-";
    row.innerHTML = `
      <td>${currentWard}</td>
      <td>
        <strong>${patient.nome || "-"}</strong>
        <span>CPF ${formatCpf(patient.cpf || "") || "-"}</span>
      </td>
      <td>${currentBed}</td>
      <td><strong>${patient.nir || "-"}</strong><span>Via ${regulationChannels}</span></td>
      <td>${admittedAt}</td>
      <td>${specialty}</td>
      <td>${regulationDate}</td>
      <td>${patient.cil || "-"}</td>
      <td>${acceptedAt}</td>
      <td>
        <div class="nir-actions">
          <button type="button" class="ghost btn-nir-open" data-id="${patient.id}">Abrir</button>
        </div>
      </td>
    `;
    container.appendChild(row);
  }
}

async function markNirPatientUpdated(patientId) {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  if (!patient) return;

  const updatedCil = window.confirm(`Paciente: ${patient.nome || "-"}\n\nHouve atualização na CIL?`);
  const updatedEmail = window.confirm(`Paciente: ${patient.nome || "-"}\n\nHouve atualização no EMAIL?`);
  const channels = [];
  if (updatedCil) channels.push("CIL");
  if (updatedEmail) channels.push("EMAIL");

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
        nirUpdateChannels: channels
      })
    });
    await loadNirPatientsView();
    setNirFeedback(`Atualização registrada para ${patient.nome || "o paciente"}: ${channels.join(" / ")}.`);
  } catch (error) {
    setNirFeedback(error.message || "Não foi possível registrar a atualização do NIR.", true);
  }
}

async function markNirPatientAccepted(patientId) {
  const patient = nirPatients.find(item => String(item.id) === String(patientId))
    || registeredPatients.find(item => String(item.id) === String(patientId));
  if (!patient) return;
  if (!window.confirm(`Confirmar que o paciente ${patient.nome || "-"} foi aceito?`)) return;

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
        regulationAcceptedAt: new Date().toISOString(),
        nirLastUpdateAt: patient.nirLastUpdateAt || "",
        nirLastUpdateBy: patient.nirLastUpdateBy || "",
        nirUpdateChannels: patient.nirUpdateChannels || []
      })
    });
    await loadNirPatientsView();
    setNirFeedback(`Paciente ${patient.nome || "-"} marcado como aceito.`);
  } catch (error) {
    setNirFeedback(error.message || "Não foi possível marcar o paciente como aceito.", true);
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
          active: true
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
    const regulatedAll = (data.patients || [])
      .filter(patient => {
        const hasRegulation = String(patient.nir || "").trim()
          || String(patient.cil || "").trim()
          || (Array.isArray(patient.regulationChannels) && patient.regulationChannels.length)
          || String(patient.nirLastUpdateAt || "").trim();
        return Boolean(hasRegulation);
      })
      .sort((a, b) =>
        Number(Boolean(b.currentAdmission)) - Number(Boolean(a.currentAdmission))
        || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
      );
    const regulated = regulatedAll.filter(patient => !String(patient.regulationAcceptedAt || "").trim());
    nirAcceptedPatients = regulatedAll.filter(patient => String(patient.regulationAcceptedAt || "").trim());
    renderNirPatients(regulated);
    renderNirAcceptedPatients(nirAcceptedPatients);
    await loadNirReports();
    setNirFeedback(`${regulated.length} paciente(s) listado(s) no NIR.`);
    return regulated;
  } catch (error) {
    try {
      const fallback = await buildPatientsFallbackList();
      const regulatedAll = fallback
        .filter(patient => {
          const hasRegulation = String(patient.nir || "").trim()
            || String(patient.cil || "").trim()
            || (Array.isArray(patient.regulationChannels) && patient.regulationChannels.length)
            || String(patient.nirLastUpdateAt || "").trim();
          return Boolean(hasRegulation);
        })
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
      const regulated = regulatedAll.filter(patient => !String(patient.regulationAcceptedAt || "").trim());
      nirAcceptedPatients = regulatedAll.filter(patient => String(patient.regulationAcceptedAt || "").trim());
      renderNirPatients(regulated);
      renderNirAcceptedPatients(nirAcceptedPatients);
      renderNirPreviousReports([], []);
      renderNirCurrentReport(null);
      setNirReportFeedback("O relatório do NIR depende da API principal ativa.", true);
      setNirFeedback("Lista do NIR carregada pelos leitos atuais enquanto a API completa não responde.");
      return regulated;
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
  document.getElementById("shift-user-name").textContent = userName;
  document.getElementById("shift-user-role").textContent = `Login: ${currentUser?.username || "-"} • Perfil: ${role}`;
  document.getElementById("shift-status-label").textContent = activeShift ? "Aberto" : "Fechado";
  document.getElementById("shift-status-meta").textContent = activeShift
    ? `${activeShift.wardNome} • ${toBRDate(activeShift.shiftDate || getTodayIsoDate())} • ${activeShift.shiftLength || "12H"} • ${getShiftPeriodLabel(activeShift.shiftPeriod)} • início ${toBRDateTime(activeShift.openedAt)}`
    : "Nenhum plantão aberto";
  document.getElementById("plantao-details")?.classList.toggle("hidden", !activeShift);

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

  const openButton = document.getElementById("btn-open-shift");
  const closeButton = document.getElementById("btn-close-shift");
  if (openButton) openButton.disabled = Boolean(activeShift);
  if (closeButton) closeButton.disabled = !activeShift;
  syncShiftFormVisibility();
  renderShiftTeamForm();
  renderShiftTeamSummary();
  renderHeaderTeamPanel();
  renderShiftHistory();
}

async function refreshCurrentUser() {
  const data = await api("/api/me");
  currentUser = data.user || null;
  renderCurrentUser();
  return currentUser;
}

function printShiftReport(report) {
  if (!report) return;
  const devices = (report.summary?.dispositivos || []).map(item => `<li>${item.label}: ${item.value}</li>`).join("") || "<li>Sem dispositivos registrados</li>";
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
      <td>${patient.leito}</td>
      <td>${patient.enfermaria}</td>
      <td>${patient.nome}</td>
      <td>${toBRDate(patient.admissao)}</td>
      <td>${patient.diagnostico || ""}</td>
      <td>${(patient.procedimentos || []).join(", ")}</td>
      <td>${patient.pendencias || ""}</td>
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
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ficha de Plantão</title><style>
    body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
    h1,h2 { margin: 0 0 12px; }
    .report-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #dbe4f0; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-logo { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(135deg, #0f4c81, #16a34a); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; text-align: center; line-height: 1.2; box-shadow: 0 6px 18px rgba(15, 76, 129, 0.18); }
    .brand-copy strong { display: block; font-size: 18px; margin-bottom: 4px; }
    .brand-copy span { display: block; font-size: 12px; color: #4b5563; }
    .report-meta-top { text-align: right; font-size: 12px; color: #374151; }
    .meta { margin-bottom: 20px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .card { border: 1px solid #d7deea; border-radius: 12px; padding: 12px; background: #f8fbff; }
    .card strong { display: block; margin-bottom: 6px; font-size: 13px; }
    .card div { font-size: 22px; font-weight: 800; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d7deea; padding: 8px; font-size: 12px; text-align: left; vertical-align: top; }
    th { background: #eef4fb; }
    ul { margin: 8px 0 0; padding-left: 18px; }
    .section { margin-top: 22px; }
    .section-title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .section-title span { font-size: 12px; color: #4b5563; }
  </style></head><body>
    <div class="report-header">
      <div class="brand">
        <div class="brand-logo">PREF<br>HMA</div>
        <div class="brand-copy">
          <strong>Hospital Municipal</strong>
          <span>Prefeitura Municipal • Relatorio de fechamento de plantao</span>
        </div>
      </div>
      <div class="report-meta-top">
        <div>${toBRDateTime(report.shift?.closedAt)}</div>
        <div>Ficha de Plantao</div>
      </div>
    </div>
    <h1>Ficha de Fechamento de Plantão</h1>
    <div class="meta">Usuário: ${report.shift?.nome || report.shift?.username || "-"} • Setor: ${report.shift?.wardNome || "-"} • Plantão: ${report.shift?.shiftLength || "12H"} / ${getShiftPeriodLabel(report.shift?.shiftPeriod)} • Abertura: ${toBRDateTime(report.shift?.openedAt)} • Fechamento: ${toBRDateTime(report.shift?.closedAt)}</div>
    <div class="grid">
      <div class="card"><strong>Pacientes ativos</strong><div>${report.summary?.pacientesAtivos ?? 0}</div></div>
      <div class="card"><strong>Altas</strong><div>${report.summary?.altas ?? 0}</div></div>
      <div class="card"><strong>Óbitos</strong><div>${report.summary?.obitos ?? 0}</div></div>
      <div class="card"><strong>Alterações</strong><div>${report.summary?.totalAlteracoes ?? 0}</div></div>
      <div class="card"><strong>Pendências ativas</strong><div>${report.summary?.pendenciasAtivas ?? 0}</div></div>
      <div class="card"><strong>Pendências solucionadas</strong><div>${report.summary?.pendenciasSolucionadas ?? 0}</div></div>
    </div>
    <div class="section">
    <div class="section-title"><h2>Equipe do plantao</h2><span>${report.shift?.shiftLength || "12H"} / ${getShiftPeriodLabel(report.shift?.shiftPeriod)}</span></div>
    <table>
      <tbody>${teamRows}</tbody>
    </table>
    </div>
    <div class="section">
    <h2>Dispositivos e procedimentos</h2>
    <ul>${devices}</ul>
    </div>
    <div class="section">
    <h2>Pacientes cadastrados</h2>
    <table>
      <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Admissão</th><th>Diagnóstico</th><th>Dispositivos</th><th>Pendências</th></tr></thead>
      <tbody>${patients || '<tr><td colspan="7">Nenhum paciente ativo no fechamento.</td></tr>'}</tbody>
    </table>
    </div>
    <div class="section">
    <div class="section-title"><h2>Pendências ativas do plantão</h2><span>${report.summary?.pendenciasAtivas ?? 0} registro(s)</span></div>
    <table>
      <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Pendência</th><th>Registrado por</th><th>Data</th></tr></thead>
      <tbody>${activePendings || '<tr><td colspan="6">Nenhuma pendência ativa no fechamento.</td></tr>'}</tbody>
    </table>
    </div>
    <div class="section">
    <div class="section-title"><h2>Pendências solucionadas no plantão</h2><span>${report.summary?.pendenciasSolucionadas ?? 0} registro(s)</span></div>
    <table>
      <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Pendência</th><th>Finalizado por</th><th>Data</th></tr></thead>
      <tbody>${solvedPendings || '<tr><td colspan="6">Nenhuma pendência solucionada neste plantão.</td></tr>'}</tbody>
    </table>
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

  document.getElementById("header-title").textContent = "Dashboard Hospitalar";
  document.getElementById("date").textContent = data.period?.from || data.period?.to
    ? `${data.period.from || "Início"} até ${data.period.to || "Hoje"}`
    : new Date().toLocaleDateString("pt-BR");
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
    enfTd.colSpan = 8;
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
      const tdPend = document.createElement("td");
      tdPend.textContent = b.pendencias || "";
      const tdNir = document.createElement("td");
      tdNir.textContent = b.nir || "";
      tr.append(tdId, tdStatus, tdTempo, tdAdm, tdNome, tdDiag, tdPend, tdNir);
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
  document.getElementById("modal-nir").value = bed.nir || "";
  document.getElementById("modal-cil").value = bed.cil || "";
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
  await updateTransferOptions(bed.id, currentWardId, ALL_ENFERMARIA_VALUE);
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
  const ids = ["modal-transfer-ward", "modal-transfer-enfermaria", "modal-transfer-bed", "modal-transferir"];
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

function fillTransferEnfermariaOptions(targetWard, selectedEnfermaria = ALL_ENFERMARIA_VALUE) {
  const enfermariaSelect = document.getElementById("modal-transfer-enfermaria");
  if (!enfermariaSelect) return;
  enfermariaSelect.innerHTML = "";
  enfermariaSelect.appendChild(new Option("Todas as enfermarias", ALL_ENFERMARIA_VALUE));

  const names = new Set(targetWard?.enfermarias || []);
  if ((targetWard?.beds || []).some(item => !item.enfermaria)) {
    names.add(NO_ENFERMARIA_VALUE);
  }

  for (const name of Array.from(names).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"))) {
    enfermariaSelect.appendChild(new Option(name === NO_ENFERMARIA_VALUE ? "Sem enfermaria" : name, name));
  }

  if (Array.from(enfermariaSelect.options).some(option => option.value === selectedEnfermaria)) {
    enfermariaSelect.value = selectedEnfermaria;
  } else {
    enfermariaSelect.value = ALL_ENFERMARIA_VALUE;
  }
}

function fillTransferBedOptions(targetWard, selectedEnfermaria, sourceBedId) {
  const bedSelect = document.getElementById("modal-transfer-bed");
  const transferButton = document.getElementById("modal-transferir");
  if (!bedSelect || !transferButton) return;

  bedSelect.innerHTML = "";
  bedSelect.appendChild(new Option("Selecione o leito de destino", ""));

  const destinationBeds = (targetWard?.beds || []).filter(item => {
    if (targetWard.id === currentWardId && item.id === sourceBedId) return false;
    if (item.status !== "LIVRE" && item.status !== "EXTRA") return false;
    if (selectedEnfermaria === ALL_ENFERMARIA_VALUE) return true;
    if (selectedEnfermaria === NO_ENFERMARIA_VALUE) return !item.enfermaria;
    return item.enfermaria === selectedEnfermaria;
  });

  for (const item of destinationBeds) {
    const enfermaria = item.enfermaria || "SEM ENFERMARIA";
    bedSelect.appendChild(new Option(`LEITO ${item.id} - ${enfermaria}`, String(item.id)));
  }

  bedSelect.disabled = destinationBeds.length === 0;
  transferButton.disabled = destinationBeds.length === 0;
  bedSelect.title = destinationBeds.length ? "" : "Não há leitos disponíveis para o destino selecionado.";
}

async function updateTransferOptions(selectedBedId, selectedWardId = currentWardId, selectedEnfermaria = ALL_ENFERMARIA_VALUE) {
  fillTransferWardOptions(selectedWardId);
  const sourceBed = ward?.beds?.find(item => item.id === selectedBedId);
  const isTransferAllowed = sourceBed?.status === "OCUPADO" && Boolean(sourceBed?.nome);

  if (!isTransferAllowed) {
    setTransferControlsDisabled(true, "A transferência só está disponível para paciente ocupado.");
    fillTransferEnfermariaOptions({ enfermarias: [], beds: [] }, ALL_ENFERMARIA_VALUE);
    fillTransferBedOptions({ id: currentWardId, beds: [] }, ALL_ENFERMARIA_VALUE, selectedBedId);
    return;
  }

  setTransferControlsDisabled(false, "");
  try {
    const targetWard = await getTransferWardData(Number.parseInt(String(selectedWardId), 10));
    fillTransferEnfermariaOptions(targetWard, selectedEnfermaria);
    const enfermariaValue = document.getElementById("modal-transfer-enfermaria")?.value || ALL_ENFERMARIA_VALUE;
    fillTransferBedOptions(targetWard, enfermariaValue, selectedBedId);
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
  const nir = document.getElementById("modal-nir").value.trim() || patient.nir || "";
  const cil = document.getElementById("modal-cil").value.trim() || patient.cil || "";
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
    nir,
    cil,
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
  await api(`/api/wards/${currentWardId}/beds/${currentBedId}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type })
  });
  transferWardCache.clear();
  await load();
  document.getElementById("modal-paciente").close();
}

async function load() {
  if (!currentWardId) return;
  ward = await api(`/api/wards/${currentWardId}`);
  transferWardCache.set(currentWardId, ward);
  document.getElementById("header-title").textContent = ward.nome;
  document.getElementById("date").textContent = ward.data;
  renderHeaderTeamPanel();
  renderCounts(ward.counts);
  renderIndicadores(ward.indicadores);
  renderBeds(ward.beds);
  await refreshCurrentUser();
  await refreshStaffSuggestions();
  await refreshSidebarPatients();
  document.getElementById("profile-current-ward")?.replaceChildren(document.createTextNode(ward.nome));
  renderHeaderWardTabs();

  if (pendingScrollEnf) {
    const target = document.getElementById(pendingScrollEnf);
    pendingScrollEnf = null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
  await transferirPaciente();
});

document.getElementById("modal-baixa").addEventListener("click", async (e) => {
  e.preventDefault();
  await darBaixa();
});

document.getElementById("modal-alta")?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!confirm("Registrar ALTA e liberar o leito?")) return;
  await registrarOutcome("ALTA");
});

document.getElementById("modal-obito")?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!confirm("Registrar ÓBITO e liberar o leito?")) return;
  await registrarOutcome("OBITO");
});

document.getElementById("modal-status").addEventListener("change", () => {
  const status = document.getElementById("modal-status").value;
  const isOcupado = status === "OCUPADO";
  setPatientFieldsEnabled(isOcupado);
  updateTransferOptions(
    currentBedId,
    parseInt(document.getElementById("modal-transfer-ward").value || String(currentWardId), 10),
    document.getElementById("modal-transfer-enfermaria").value || ALL_ENFERMARIA_VALUE
  );
  if (!isOcupado) clearPatientFields();
});

document.getElementById("modal-transfer-ward")?.addEventListener("change", async () => {
  await updateTransferOptions(
    currentBedId,
    parseInt(document.getElementById("modal-transfer-ward").value || String(currentWardId), 10),
    ALL_ENFERMARIA_VALUE
  );
});

document.getElementById("modal-transfer-enfermaria")?.addEventListener("change", async () => {
  await updateTransferOptions(
    currentBedId,
    parseInt(document.getElementById("modal-transfer-ward").value || String(currentWardId), 10),
    document.getElementById("modal-transfer-enfermaria").value || ALL_ENFERMARIA_VALUE
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
  const [data, adminData] = await Promise.all([
    api("/api/wards"),
    api("/api/wards?includeArchived=true")
  ]);
  wards = data.wards || [];
  allWards = adminData.wards || [];
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
  syncAdminWardEditForm();
  renderAdminWardList();
  renderHeaderWardTabs();
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

async function openSelectedWard(wardId) {
  if (!wardId) return;
  currentWardId = wardId;
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-nir")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
}

function maybeOpenStartWardModal() {
  const modal = document.getElementById("modal-start-ward");
  if (!modal || currentUser?.activeShift || !wards.length) return;
  syncStartupWardModalOptions();
  if (!modal.open) {
    modal.showModal();
  }
}

async function openTopbarWard() {
  const wardId = parseInt(document.getElementById("topbar-ward-select")?.value, 10);
  if (!wardId) return;
  currentWardId = wardId;
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
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
  if (enfermaria) {
    pendingScrollEnf = `enf-${enfermaria.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
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
  const payload = {
    nome: document.getElementById("patient-registry-name").value.trim(),
    cpf: normalizeCpf(document.getElementById("patient-registry-cpf").value),
    birthDate: document.getElementById("patient-registry-birthdate").value,
    cil: document.getElementById("patient-registry-cil").value.trim(),
    regulationChannels: getPatientRegulationChannels()
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
    setPatientsFeedback(isNew ? "Paciente cadastrado com sucesso." : "Cadastro do paciente atualizado com sucesso.");
    await loadPatientsRegistry();
    await loadNirPatientsView();
    if (currentWardId && currentPatientRecord?.currentAdmission?.wardId === currentWardId) {
      await load();
    }
    if (pendingLink?.bedId && normalizeCpf(payload.cpf) === normalizeCpf(pendingLink.cpf)) {
      pendingBedRegistryLink = null;
      await openPatientModal(pendingLink.bedId);
      applyRegistryPatientToBedForm(saved?.patient || currentPatientRecord);
      setPatientLookupFeedback("CPF cadastrado com sucesso. Agora conclua o registro do leito.");
    }
  } catch (error) {
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

async function startApp() {
  setAppEnabled(false);
  showOnly("view-home");
  await refreshCurrentUser();
  await refreshStaffSuggestions();
  await refreshWards();
  setAppEnabled(false);
  maybeOpenStartWardModal();
}

async function checkAuth() {
  try {
    const data = await api("/api/me");
    currentUser = data.user || null;
    await startApp();
  } catch {
    currentUser = null;
    setAppEnabled(false);
    showOnly("view-login");
  }
}

document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
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
    await startApp();
  } catch (e) {
    alert(e.message);
  }
});

async function doLogout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  sessionId = null;
  sessionStorage.removeItem("sid");
  currentWardId = null;
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
  currentWardId = wardId;
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-nir")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
});

document.getElementById("btn-abrir-setor").addEventListener("click", async () => {
  await openSelectedWard(parseInt(document.getElementById("select-ward").value, 10));
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
  setAppEnabled(false);
  showOnly("view-home");
  closeSidebarOnMobile();
});

document.getElementById("nav-patients")?.addEventListener("click", openPatientsView);
document.getElementById("nav-nir")?.addEventListener("click", openNirView);

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

document.getElementById("nir-list")?.addEventListener("click", async event => {
  const statusButton = event.target.closest(".btn-nir-status");
  if (statusButton) {
    await markNirPatientUpdated(statusButton.dataset.id);
    return;
  }

  const acceptButton = event.target.closest(".btn-nir-accept");
  if (acceptButton) {
    await markNirPatientAccepted(acceptButton.dataset.id);
    return;
  }

  const openButton = event.target.closest(".btn-nir-open");
  if (!openButton) return;
  await openPatientRegistry(openButton.dataset.id);
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
  setAppEnabled(false);
  showOnly("view-dashboard");
  await loadDashboard();
  closeSidebarOnMobile();
});

document.getElementById("btn-open-shift")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("shift-ward").value, 10);
  const shiftLength = normalizeShiftLength(document.getElementById("shift-length")?.value);
  const shiftPeriod = normalizeShiftPeriod(document.getElementById("shift-period")?.value, shiftLength);
  if (!wardId) {
    setShiftFeedback("Selecione um setor para abrir o plantão.", true);
    return;
  }
  const res = await api("/api/shifts/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wardId, shiftLength, shiftPeriod })
  });
  currentUser = res.user || currentUser;
  currentWardId = wardId;
  renderCurrentUser();
  setShiftFeedback("Plantão aberto com sucesso.");
});

document.getElementById("btn-confirm-start-ward")?.addEventListener("click", async event => {
  event.preventDefault();
  const wardId = parseInt(document.getElementById("modal-start-ward-select")?.value, 10);
  if (!wardId) return;
  document.getElementById("modal-start-ward")?.close();
  await openSelectedWard(wardId);
});

document.getElementById("shift-length")?.addEventListener("change", syncShiftFormVisibility);
document.getElementById("shift-period")?.addEventListener("change", syncShiftFormVisibility);

document.getElementById("btn-close-shift")?.addEventListener("click", async () => {
  if (!currentUser?.activeShift) {
    setShiftFeedback("Não há plantão aberto para fechar.", true);
    return;
  }
  if (!confirm("Fechar o plantão e imprimir a ficha de resumo?")) return;
  const res = await api("/api/shifts/close", { method: "POST" });
  currentUser = res.user || currentUser;
  lastClosedReport = res.report || null;
  renderCurrentUser();
  setShiftFeedback("Plantão fechado. Abrindo ficha para impressão.");
  printShiftReport(lastClosedReport);
});

document.getElementById("btn-print-last-shift")?.addEventListener("click", () => {
  if (!lastClosedReport) {
    setShiftFeedback("Ainda não existe ficha encerrada para reimpressão.", true);
    return;
  }
  setShiftFeedback("Reabrindo a última ficha de plantão.");
  printShiftReport(lastClosedReport);
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
    alert(e.message);
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
    alert(e.message);
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
    alert(e.message);
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
    alert(e.message);
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
    alert(e.message);
  }
});

document.getElementById("sidebar-patient-cpf")?.addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
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

checkAuth();
