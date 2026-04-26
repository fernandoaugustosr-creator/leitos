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

const procedureOptions = ["SNE", "SNG", "SANGUE", "ASPIRAÇÃO", "PASSAGEM DE SONDA"];
const NO_ENFERMARIA_VALUE = "__SEM_ENFERMARIA__";

function toBRDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR");
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
  const ids = ["view-login", "view-dashboard", "view-home", "view-admin"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("hidden", id !== viewId);
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

function openPatientModal(bedId) {
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

async function salvarPaciente() {
  if (currentBedId == null) return;
  const status = document.getElementById("modal-status").value;

  if (status !== "OCUPADO") {
    await api(`/api/wards/${currentWardId}/beds/${currentBedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
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
  await load();
  document.getElementById("modal-paciente").close();
}

async function load() {
  if (!currentWardId) return;
  ward = await api(`/api/wards/${currentWardId}`);
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
  if (!isOcupado) clearPatientFields();
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
  renderSidebar();
  renderCurrentUser();
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

function renderSidebar() {
  const ul = document.getElementById("sidebar-wards");
  if (!ul) return;
  ul.innerHTML = "";
  for (const w of wards) {
    const li = document.createElement("li");
    li.className = "nav-item";

    const row = document.createElement("div");
    row.className = "nav-item-row";
    if (w.id === currentWardId) row.classList.add("active");

    const name = document.createElement("div");
    name.className = "nav-item-name";
    name.textContent = w.nome;

    const meta = document.createElement("div");
    meta.className = "nav-item-meta";
    meta.textContent = `${(w.enfermarias || []).length}`;

    row.append(name, meta);
    row.addEventListener("click", async () => {
      currentWardId = w.id;
      setAppEnabled(true);
      showOnly(null);
      await load();
      renderSidebar();
      closeSidebarOnMobile();
    });
    li.appendChild(row);

    const enfermarias = w.enfermarias || [];
    if (enfermarias.length) {
      const sub = document.createElement("ul");
      sub.className = "nav-sub";
      for (const enf of enfermarias) {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = enf;
        a.addEventListener("click", async (e) => {
          e.preventDefault();
          currentWardId = w.id;
          pendingScrollEnf = `enf-${enf.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          setAppEnabled(true);
          showOnly(null);
          await load();
          renderSidebar();
          closeSidebarOnMobile();
        });
        const subLi = document.createElement("li");
        subLi.appendChild(a);
        sub.appendChild(subLi);
      }
      li.appendChild(sub);
    }

    ul.appendChild(li);
  }
}

function closeSidebarOnMobile() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (window.matchMedia("(max-width: 900px)").matches) sidebar.classList.remove("open");
}

async function startApp() {
  document.getElementById("sidebar")?.classList.remove("hidden");
  document.getElementById("sidebar-open")?.classList.remove("hidden");
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
    document.getElementById("sidebar")?.classList.add("hidden");
    document.getElementById("sidebar-open")?.classList.add("hidden");
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

document.getElementById("btn-abrir-setor").addEventListener("click", async () => {
  currentWardId = parseInt(document.getElementById("select-ward").value, 10);
  setAppEnabled(true);
  showOnly(null);
  await load();
  renderSidebar();
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

document.getElementById("sidebar-collapse")?.addEventListener("click", () => {
  document.getElementById("sidebar")?.classList.toggle("hidden");
  document.getElementById("sidebar-open")?.classList.remove("hidden");
});

document.getElementById("sidebar-open")?.addEventListener("click", () => {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.classList.remove("hidden");
  sidebar.classList.add("open");
});

checkAuth();
