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
let currentWardId = null;
let sessionId = sessionStorage.getItem("sid") || null;
let pendingScrollEnf = null;
let dashboardFilters = { wardId: "", month: "", from: "", to: "" };
let currentUser = null;
let lastClosedReport = null;
let transferWardCache = new Map();
let sidebarPatients = [];
let registeredPatients = [];
let currentPatientRecord = null;
let pendingWhatsAppMessage = "";

const procedureOptions = ["SNE", "SNG", "SANGUE", "ASPIRAÇÃO", "PASSAGEM DE SONDA"];
const NO_ENFERMARIA_VALUE = "__SEM_ENFERMARIA__";
const ALL_ENFERMARIA_VALUE = "__TODAS_ENFERMARIAS__";
const DEFAULT_WHATSAPP_GROUP_LINK = "https://chat.whatsapp.com/GgzUGlmImdX1CAl0vAZ6J9";

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

function toBRDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR");
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

function openWhatsAppPreview(message) {
  pendingWhatsAppMessage = message;
  const textarea = document.getElementById("whatsapp-message-preview");
  if (textarea) textarea.value = message;
  document.getElementById("modal-whatsapp-preview")?.showModal();
}

async function openWhatsAppSummary() {
  if (!DEFAULT_WHATSAPP_GROUP_LINK) {
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
  openWhatsAppPreview(message);
}

function setPatientFieldsEnabled(enabled) {
  const ids = ["modal-nome", "modal-admissao", "modal-diagnostico", "modal-pendencias", "modal-nir"];
  for (const id of ids) {
    const el = document.getElementById(id);
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
}

function showOnly(viewId) {
  const ids = ["view-login", "view-dashboard", "view-home", "view-patients", "view-admin"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("hidden", id !== viewId);
  }
  const navMap = {
    "view-dashboard": "nav-dashboard",
    "view-home": "nav-home",
    "view-patients": "nav-patients",
    "view-admin": "nav-gerenciar"
  };
  for (const id of ["nav-dashboard", "nav-home", "nav-patients", "nav-gerenciar"]) {
    document.getElementById(id)?.classList.toggle("ghost", navMap[viewId] !== id);
  }
}

function setAppEnabled(enabled) {
  document.getElementById("plantao-details")?.classList.toggle("hidden", !enabled);
  document.querySelector(".cards")?.classList.toggle("hidden", !enabled);
  document.querySelector(".indicadores")?.classList.toggle("hidden", !enabled);
  document.querySelector(".tabela")?.classList.toggle("hidden", !enabled);
}

async function api(path, options) {
  const merged = { ...(options || {}) };
  merged.headers = { ...(merged.headers || {}) };
  if (sessionId) merged.headers["X-Session-Id"] = sessionId;
  const res = await fetch(path, merged);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || "Erro";
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
  document.getElementById("input-altas").value = ind.altas;
  document.getElementById("input-obitos").value = ind.obitos;
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
  document.getElementById("patient-registry-title").textContent = patient.nome || "Cadastro do paciente";
  document.getElementById("patient-registry-name").value = patient.nome || "";
  document.getElementById("patient-registry-cpf").value = formatCpf(patient.cpf || "");
  document.getElementById("patient-registry-birthdate").value = patient.birthDate || "";
  document.getElementById("patient-registry-diagnostico").value = patient.diagnostico || "";
  document.getElementById("patient-registry-nir").value = patient.nir || "";
  renderPatientCurrentAdmission(patient.currentAdmission || null);
  renderPatientAdmissionHistory(patient.admissionHistory || []);
  document.getElementById("patient-registry-delete").disabled = Boolean(patient.currentAdmission);
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
  document.getElementById("topbar-user").textContent = userName;
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
    ? `${activeShift.wardNome} • início ${toBRDateTime(activeShift.openedAt)}`
    : "Nenhum plantão aberto";

  const shiftWard = document.getElementById("shift-ward");
  if (shiftWard) {
    if (activeShift) shiftWard.value = String(activeShift.wardId);
    else if (currentWardId) shiftWard.value = String(currentWardId);
    shiftWard.disabled = Boolean(activeShift);
  }

  const openButton = document.getElementById("btn-open-shift");
  const closeButton = document.getElementById("btn-close-shift");
  if (openButton) openButton.disabled = Boolean(activeShift);
  if (closeButton) closeButton.disabled = !activeShift;

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
    .meta { margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; text-align: left; }
    ul { margin: 8px 0 0; padding-left: 18px; }
  </style></head><body>
    <h1>Ficha de Fechamento de Plantão</h1>
    <div class="meta">Usuário: ${report.shift?.nome || report.shift?.username || "-"} • Setor: ${report.shift?.wardNome || "-"} • Abertura: ${toBRDateTime(report.shift?.openedAt)} • Fechamento: ${toBRDateTime(report.shift?.closedAt)}</div>
    <div class="grid">
      <div class="card"><strong>Pacientes ativos</strong><div>${report.summary?.pacientesAtivos ?? 0}</div></div>
      <div class="card"><strong>Altas</strong><div>${report.summary?.altas ?? 0}</div></div>
      <div class="card"><strong>Óbitos</strong><div>${report.summary?.obitos ?? 0}</div></div>
      <div class="card"><strong>Alterações</strong><div>${report.summary?.totalAlteracoes ?? 0}</div></div>
      <div class="card"><strong>Pendências ativas</strong><div>${report.summary?.pendenciasAtivas ?? 0}</div></div>
      <div class="card"><strong>Pendências solucionadas</strong><div>${report.summary?.pendenciasSolucionadas ?? 0}</div></div>
    </div>
    <h2>Dispositivos e procedimentos</h2>
    <ul>${devices}</ul>
    <h2>Pacientes cadastrados</h2>
    <table>
      <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Admissão</th><th>Diagnóstico</th><th>Dispositivos</th><th>Pendências</th></tr></thead>
      <tbody>${patients || '<tr><td colspan="7">Nenhum paciente ativo no fechamento.</td></tr>'}</tbody>
    </table>
    <h2>Pendências ativas do plantão</h2>
    <table>
      <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Pendência</th><th>Registrado por</th><th>Data</th></tr></thead>
      <tbody>${activePendings || '<tr><td colspan="6">Nenhuma pendência ativa no fechamento.</td></tr>'}</tbody>
    </table>
    <h2>Pendências solucionadas no plantão</h2>
    <table>
      <thead><tr><th>Leito</th><th>Enfermaria</th><th>Paciente</th><th>Pendência</th><th>Finalizado por</th><th>Data</th></tr></thead>
      <tbody>${solvedPendings || '<tr><td colspan="6">Nenhuma pendência solucionada neste plantão.</td></tr>'}</tbody>
    </table>
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
  document.getElementById("modal-title").textContent = `Leito ${bed.id}`;
  document.getElementById("modal-leito").value = `LEITO ${bed.id}`;
  document.getElementById("modal-status").value = bed.status;
  document.getElementById("modal-nome").value = bed.nome || "";
  document.getElementById("modal-admissao").value = bed.admissao || "";
  document.getElementById("modal-diagnostico").value = bed.diagnostico || "";
  document.getElementById("modal-pendencias").value = "";
  document.getElementById("modal-nir").value = bed.nir || "";
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

  const nome = document.getElementById("modal-nome").value.trim();
  if (!nome) {
    alert("Informe o nome do paciente.");
    return;
  }
  const admissao = document.getElementById("modal-admissao").value;
  const diagnostico = document.getElementById("modal-diagnostico").value.trim();
  const pendenciasAdd = document.getElementById("modal-pendencias").value.trim();
  const nir = document.getElementById("modal-nir").value.trim();
  const procedimentos = getSelectedProcedures();
  const pendenciasStatus = getPendingStatusPayload();
  const payload = { status: "OCUPADO", nome, admissao, diagnostico, pendenciasAdd, pendenciasStatus, nir, procedimentos };
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
  renderCounts(ward.counts);
  renderIndicadores(ward.indicadores);
  renderBeds(ward.beds);
  document.getElementById("eq-medico").value = ward.equipe.medicoPlantao || "";
  document.getElementById("eq-enf-dia").value = ward.equipe.enfermeiroDia || "";
  document.getElementById("eq-tec-dia").value = ward.equipe.tecnicosDia || "";
  document.getElementById("eq-enf-noite").value = ward.equipe.enfermeiroNoite || "";
  document.getElementById("eq-tec-noite").value = ward.equipe.tecnicosNoite || "";
  document.getElementById("eq-faltosos").value = ward.equipe.faltosos || "";
  await refreshCurrentUser();
  await refreshSidebarPatients();
  document.getElementById("profile-current-ward").textContent = ward.nome;

  if (pendingScrollEnf) {
    const target = document.getElementById(pendingScrollEnf);
    pendingScrollEnf = null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

document.getElementById("salvar-indicadores").addEventListener("click", async () => {
  const altas = parseInt(document.getElementById("input-altas").value || "0", 10);
  const obitos = parseInt(document.getElementById("input-obitos").value || "0", 10);
  const res = await api(`/api/wards/${currentWardId}/indicadores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ altas, obitos })
  });
  renderIndicadores(res.indicadores);
  await refreshCurrentUser();
});

document.getElementById("salvar-equipe").addEventListener("click", async () => {
  const payload = {
    medicoPlantao: document.getElementById("eq-medico").value,
    enfermeiroDia: document.getElementById("eq-enf-dia").value,
    tecnicosDia: document.getElementById("eq-tec-dia").value,
    enfermeiroNoite: document.getElementById("eq-enf-noite").value,
    tecnicosNoite: document.getElementById("eq-tec-noite").value,
    faltosos: document.getElementById("eq-faltosos").value
  };
  await api(`/api/wards/${currentWardId}/equipe`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await refreshCurrentUser();
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
  const data = await api("/api/wards");
  wards = data.wards || [];
  const select = document.getElementById("select-ward");
  const dashboardWard = document.getElementById("dashboard-ward");
  const shiftWard = document.getElementById("shift-ward");
  const adminSelectEnf = document.getElementById("admin-ward-select-enf");
  const adminSelectBed = document.getElementById("admin-ward-select-bed");
  const adminSelectDel = document.getElementById("admin-ward-select-del");
  if (select) select.innerHTML = "";
  if (dashboardWard) {
    dashboardWard.innerHTML = "";
    dashboardWard.appendChild(new Option("Todos os setores", ""));
  }
  if (shiftWard) shiftWard.innerHTML = "";
  if (adminSelectEnf) adminSelectEnf.innerHTML = "";
  if (adminSelectBed) adminSelectBed.innerHTML = "";
  if (adminSelectDel) adminSelectDel.innerHTML = "";
  for (const w of wards) {
    if (select) select.appendChild(new Option(w.nome, w.id));
    if (dashboardWard) dashboardWard.appendChild(new Option(w.nome, w.id));
    if (shiftWard) shiftWard.appendChild(new Option(w.nome, w.id));
    if (adminSelectEnf) adminSelectEnf.appendChild(new Option(w.nome, w.id));
    if (adminSelectBed) adminSelectBed.appendChild(new Option(w.nome, w.id));
    if (adminSelectDel) adminSelectDel.appendChild(new Option(w.nome, w.id));
  }
  if (!currentWardId && wards.length) currentWardId = wards[0].id;
  if (currentWardId) {
    if (select) select.value = String(currentWardId);
    if (shiftWard) shiftWard.value = String(currentWardId);
    if (adminSelectEnf) adminSelectEnf.value = String(currentWardId);
    if (adminSelectBed) adminSelectBed.value = String(currentWardId);
    if (adminSelectDel) adminSelectDel.value = String(currentWardId);
  }
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

function updateAdminEnfDropdown() {
  const bedSelect = document.getElementById("admin-ward-select-bed");
  if (!bedSelect) return;
  const wardId = parseInt(bedSelect.value, 10);
  const w = wards.find(x => x.id === wardId);
  const select = document.getElementById("admin-enf-select-bed");
  if (!select) return;
  select.innerHTML = "";
  select.appendChild(new Option("Sem enfermaria", NO_ENFERMARIA_VALUE));
  if (w && w.enfermarias) {
    for (const enf of w.enfermarias) {
      select.appendChild(new Option(enf, enf));
    }
  }
}

document.getElementById("admin-ward-select-bed")?.addEventListener("change", updateAdminEnfDropdown);

function updateDeleteEnfDropdown() {
  const wardSelect = document.getElementById("admin-ward-select-del");
  if (!wardSelect) return;
  const wardId = parseInt(wardSelect.value, 10);
  const w = wards.find(x => x.id === wardId);
  const select = document.getElementById("admin-enf-select-del");
  if (!select) return;
  select.innerHTML = "";
  select.appendChild(new Option("Sem enfermaria", NO_ENFERMARIA_VALUE));
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

async function openTopbarWard() {
  const wardId = parseInt(document.getElementById("topbar-ward-select")?.value, 10);
  if (!wardId) return;
  currentWardId = wardId;
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
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

async function savePatientRegistry() {
  if (!currentPatientRecord?.id) return;
  const payload = {
    nome: document.getElementById("patient-registry-name").value.trim(),
    cpf: normalizeCpf(document.getElementById("patient-registry-cpf").value),
    birthDate: document.getElementById("patient-registry-birthdate").value,
    diagnostico: document.getElementById("patient-registry-diagnostico").value.trim(),
    nir: document.getElementById("patient-registry-nir").value.trim()
  };

  await api(`/api/patients/${currentPatientRecord.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  setPatientsFeedback("Cadastro do paciente atualizado com sucesso.");
  await loadPatientsRegistry();
  if (currentWardId && currentPatientRecord.currentAdmission?.wardId === currentWardId) {
    await load();
  }
  const refreshed = await api(`/api/patients/${currentPatientRecord.id}`);
  fillPatientRegistryModal(refreshed.patient);
}

async function deletePatientRegistry() {
  if (!currentPatientRecord?.id) return;
  if (!confirm(`Excluir o cadastro de ${currentPatientRecord.nome || "este paciente"}?`)) return;

  await api(`/api/patients/${currentPatientRecord.id}`, {
    method: "DELETE"
  });

  document.getElementById("modal-patient-registry").close();
  currentPatientRecord = null;
  setPatientsFeedback("Cadastro do paciente excluído com sucesso.");
  await loadPatientsRegistry();
}

async function startApp() {
  setAppEnabled(false);
  showOnly("view-dashboard");
  await refreshCurrentUser();
  await refreshWards();
  updateDashboardFilterInputs();
  await loadDashboard();
  setAppEnabled(false);
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

document.getElementById("btn-abrir-setor").addEventListener("click", async () => {
  currentWardId = parseInt(document.getElementById("select-ward").value, 10);
  setAppEnabled(true);
  showOnly(null);
  document.getElementById("nav-home")?.classList.remove("ghost");
  document.getElementById("nav-dashboard")?.classList.add("ghost");
  document.getElementById("nav-patients")?.classList.add("ghost");
  document.getElementById("nav-gerenciar")?.classList.add("ghost");
  await load();
  updateTopbarWardSelectors();
});

document.getElementById("btn-gerenciar").addEventListener("click", async () => {
  await refreshWards();
  setAppEnabled(false);
  showOnly("view-admin");
});

document.getElementById("nav-gerenciar")?.addEventListener("click", async () => {
  await refreshWards();
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

document.getElementById("patients-search")?.addEventListener("keydown", async event => {
  if (event.key === "Enter") {
    event.preventDefault();
    await loadPatientsRegistry();
  }
});

document.getElementById("patient-registry-cpf")?.addEventListener("input", event => {
  event.target.value = formatCpf(event.target.value);
});

document.getElementById("patient-registry-save")?.addEventListener("click", async event => {
  event.preventDefault();
  await savePatientRegistry();
});

document.getElementById("patient-registry-delete")?.addEventListener("click", async event => {
  event.preventDefault();
  await deletePatientRegistry();
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
  if (!wardId) {
    setShiftFeedback("Selecione um setor para abrir o plantão.", true);
    return;
  }
  const res = await api("/api/shifts/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wardId })
  });
  currentUser = res.user || currentUser;
  renderCurrentUser();
  setShiftFeedback("Plantão aberto com sucesso.");
});

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
document.getElementById("btn-whatsapp-open-group")?.addEventListener("click", async event => {
  event.preventDefault();
  if (!pendingWhatsAppMessage) {
    setShiftFeedback("Nenhuma solicitacao foi gerada ainda.", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(pendingWhatsAppMessage);
    setShiftFeedback("Texto copiado. O grupo foi aberto para voce colar e enviar.");
  } catch {
    setShiftFeedback("Grupo aberto. Se necessario, copie o texto manualmente antes de enviar.");
  }

  window.location.href = DEFAULT_WHATSAPP_GROUP_LINK;
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
    await refreshCurrentUser();
  } catch (e) {
    alert(e.message);
  }
});

document.getElementById("btn-add-beds").addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-bed").value, 10);
  const enfermariaValue = document.getElementById("admin-enf-select-bed").value;
  const enfermaria = enfermariaValue === NO_ENFERMARIA_VALUE ? "" : enfermariaValue;
  const start = parseInt(document.getElementById("admin-bed-start").value, 10);
  const end = parseInt(document.getElementById("admin-bed-end").value, 10);
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
  } catch (e) {
    alert(e.message);
  }
});

document.getElementById("btn-del-beds")?.addEventListener("click", async () => {
  const wardId = parseInt(document.getElementById("admin-ward-select-del").value, 10);
  const enfermariaValue = document.getElementById("admin-enf-select-del").value;
  const enfermaria = enfermariaValue === NO_ENFERMARIA_VALUE ? "" : enfermariaValue;
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
