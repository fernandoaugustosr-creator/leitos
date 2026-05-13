const express = require("express");
const path = require("path");
const crypto = require("crypto");
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const statuses = ["OCUPADO", "LIVRE", "BLOQUEADO", "RESERVADO", "EXTRA"];
const procedureOptions = ["SNE", "SNG", "SANGUE", "ASPIRAÇÃO", "PASSAGEM DE SONDA"];
const supabaseUrl = process.env.SUPABASE_URL || "https://bbnndbnotfpjvqonfzac.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabaseTable = process.env.SUPABASE_TABLE || "app_state";
const supabaseStateId = process.env.SUPABASE_STATE_ID || "main";
const supabaseStateColumns = ["payload", "data"];

let nextShiftId = 2;
let nextPatientId = 1;
const users = [{
  id: 1,
  username: "admin",
  password: "admin",
  nome: "Administrador",
  cpf: "",
  birthDate: "",
  role: "admin",
  activeShift: null,
  shifts: [],
  actions: []
}];
const patientRegistry = [];
const sessions = new Map();
const storageStatus = {
  provider: "supabase",
  configured: Boolean(supabaseUrl && supabaseKey),
  synced: false,
  lastSyncAt: null,
  lastError: null
};

function parseCookies(header) {
  const out = {};
  const value = header || "";
  for (const part of value.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function createSession(username) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { username, createdAt: Date.now() });
  return sid;
}

function createRecordId() {
  return crypto.randomBytes(10).toString("hex");
}

function requireAuth(req, res, next) {
  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const cookies = parseCookies(req.headers.cookie);
  const sid = headerSid || cookies.sid;
  if (!sid) return res.status(401).json({ error: "Não autenticado" });
  const session = sessions.get(sid);
  if (!session) return res.status(401).json({ error: "Sessão inválida" });
  const user = users.find(item => item.username === session.username);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  req.session = session;
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Apenas administradores podem acessar esta área" });
  }
  next();
}

let nextWardId = 2;

const wards = [
  {
    id: 1,
    nome: "POSTO 2",
    enfermarias: ["ENF. 230", "ENF. 240"],
    indicadores: { altas: 2, obitos: 0 },
    equipe: {
      medicoPlantao: "DRA JADE",
      enfermeiroDia: "ALEXCIANA",
      tecnicosDia: "FONTINELE, CLASCY E IACI",
      enfermeiroNoite: "ALEXCIANA",
      tecnicosNoite: "FONTINELE, CLASCY E IACI",
      faltosos: ""
    },
    beds: [
      { id: 231, enfermaria: "ENF. 230", status: "OCUPADO", admissao: "2026-03-20", nome: "MARIA JOANA DA SILVA", diagnostico: "FISIO/UMIDIFICAR TRAQUEOSTOMIA", pendencias: "NEURO", nir: "NEURO" },
      { id: 232, enfermaria: "ENF. 230", status: "LIVRE", admissao: "", nome: "", cpf: "", birthDate: "", diagnostico: "", pendencias: "", nir: "" },
      { id: 233, enfermaria: "ENF. 230", status: "OCUPADO", admissao: "2026-04-08", nome: "MARIA RAIMUNDA DOS SANTOS", diagnostico: "PNM", pendencias: "", nir: "" },
      { id: 234, enfermaria: "ENF. 230", status: "LIVRE", admissao: "", nome: "", cpf: "", birthDate: "", diagnostico: "", pendencias: "", nir: "" },
      { id: 235, enfermaria: "ENF. 230", status: "OCUPADO", admissao: "2026-04-01", nome: "MARIA SILVA COSTA", cpf: "", birthDate: "", diagnostico: "", pendencias: "", nir: "" },
      { id: 236, enfermaria: "ENF. 240", status: "BLOQUEADO", admissao: "", nome: "", cpf: "", birthDate: "", diagnostico: "", pendencias: "Manutenção", nir: "" },
      { id: 237, enfermaria: "ENF. 240", status: "RESERVADO", admissao: "", nome: "", cpf: "", birthDate: "", diagnostico: "", pendencias: "Pré-cirurgia", nir: "" },
      { id: 238, enfermaria: "ENF. 240", status: "EXTRA", admissao: "", nome: "", cpf: "", birthDate: "", diagnostico: "", pendencias: "", nir: "" },
      { id: 239, enfermaria: "ENF. 240", status: "OCUPADO", admissao: "2026-04-05", nome: "JOÃO PEREIRA", cpf: "", birthDate: "", diagnostico: "Pneumonia", pendencias: "", nir: "" },
      { id: 240, enfermaria: "ENF. 240", status: "OCUPADO", admissao: "2026-04-07", nome: "ANTONIO SOUZA", cpf: "", birthDate: "", diagnostico: "AVC", pendencias: "Tomografia", nir: "NEURO" }
    ]
  }
];

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseKey);
}

function ensureSupabaseConfigured() {
  if (!hasSupabaseConfig()) {
    const error = new Error("Supabase não configurado");
    storageStatus.provider = "supabase";
    storageStatus.configured = false;
    storageStatus.synced = false;
    storageStatus.lastError = error.message;
    throw error;
  }

  storageStatus.provider = "supabase";
  storageStatus.configured = true;
}

function buildStatePayload() {
  return {
    schemaVersion: 1,
    nextWardId,
    nextShiftId,
    nextPatientId,
    users,
    patientRegistry,
    wards
  };
}

function applyStatePayload(payload) {
  if (!payload || !Array.isArray(payload.wards)) return false;
  if (Array.isArray(payload.users) && payload.users.length) {
    users.length = 0;
    for (const user of payload.users) {
      users.push({
        id: user.id,
        username: user.username,
        password: user.password,
        nome: user.nome || user.username,
        cpf: String(user.cpf || "").replace(/\D/g, ""),
        birthDate: user.birthDate || "",
        role: user.role || "user",
        activeShift: user.activeShift || null,
        shifts: Array.isArray(user.shifts) ? user.shifts : [],
        actions: Array.isArray(user.actions) ? user.actions : []
      });
    }
  }
  patientRegistry.length = 0;
  if (Array.isArray(payload.patientRegistry)) {
    for (const patient of payload.patientRegistry) {
      patientRegistry.push({
        id: patient.id,
        nome: patient.nome || "",
        cpf: normalizeCpf(patient.cpf),
        birthDate: patient.birthDate || "",
        diagnostico: patient.diagnostico || "",
        nir: patient.nir || "",
        createdAt: patient.createdAt || new Date().toISOString(),
        updatedAt: patient.updatedAt || new Date().toISOString(),
        deletedAt: patient.deletedAt || null,
        currentAdmission: patient.currentAdmission || null,
        admissionHistory: Array.isArray(patient.admissionHistory) ? patient.admissionHistory : []
      });
    }
  }
  wards.length = 0;
  for (const ward of payload.wards) {
    wards.push(ward);
  }
  nextWardId = Number.isInteger(payload.nextWardId) ? payload.nextWardId : wards.reduce((max, ward) => Math.max(max, ward.id), 0) + 1;
  nextShiftId = Number.isInteger(payload.nextShiftId) ? payload.nextShiftId : users.reduce((max, user) => Math.max(max, ...(user.shifts || []).map(shift => shift.id || 0)), 0) + 1;
  nextPatientId = Number.isInteger(payload.nextPatientId) ? payload.nextPatientId : patientRegistry.reduce((max, patient) => Math.max(max, Number(patient.id) || 0), 0) + 1;
  if (!patientRegistry.length) {
    rebuildPatientRegistryFromWards();
  }
  return true;
}

function isMissingSupabaseColumn(errorText, column) {
  const text = String(errorText || "");
  return text.includes(`column ${supabaseTable}.${column} does not exist`)
    || text.includes(`Could not find the '${column}' column`)
    || text.includes(`Could not find the "${column}" column`);
}

async function saveStateToSupabase() {
  if (!hasSupabaseConfig()) return false;
  const state = buildStatePayload();
  let lastError = null;

  for (const column of supabaseStateColumns) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${supabaseTable}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([{ id: supabaseStateId, [column]: state }])
    });

    if (response.ok) {
      storageStatus.provider = "supabase";
      storageStatus.synced = true;
      storageStatus.lastSyncAt = new Date().toISOString();
      storageStatus.lastError = null;
      return true;
    }

    const errorText = await response.text();
    lastError = new Error(errorText || "Falha ao salvar no Supabase");
    if (!isMissingSupabaseColumn(errorText, column)) break;
  }

  throw lastError || new Error("Falha ao salvar no Supabase");
}

async function loadStateFromSupabase() {
  if (!hasSupabaseConfig()) return false;
  let lastError = null;

  for (const column of supabaseStateColumns) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${supabaseTable}?id=eq.${encodeURIComponent(supabaseStateId)}&select=${column}`, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      lastError = new Error(errorText || "Falha ao carregar do Supabase");
      if (isMissingSupabaseColumn(errorText, column)) continue;
      throw lastError;
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.[column]) {
      storageStatus.provider = "supabase";
      storageStatus.synced = true;
      storageStatus.lastSyncAt = new Date().toISOString();
      storageStatus.lastError = null;
      return false;
    }

    const applied = applyStatePayload(rows[0][column]);
    storageStatus.provider = "supabase";
    storageStatus.synced = applied;
    storageStatus.lastSyncAt = new Date().toISOString();
    storageStatus.lastError = null;
    return applied;
  }

  throw lastError || new Error("Falha ao carregar do Supabase");
}

async function persistState() {
  ensureSupabaseConfigured();
  try {
    return await saveStateToSupabase();
  } catch (error) {
    storageStatus.provider = "supabase";
    storageStatus.synced = false;
    storageStatus.lastError = error.message;
    throw error;
  }
}

async function initializeStorage() {
  ensureSupabaseConfigured();
  try {
    const loaded = await loadStateFromSupabase();
    if (!loaded) {
      await saveStateToSupabase();
    }
  } catch (error) {
    storageStatus.provider = "supabase";
    storageStatus.synced = false;
    storageStatus.lastError = error.message;
    throw error;
  }
}

async function refreshStateFromSupabase() {
  ensureSupabaseConfigured();
  try {
    const loaded = await loadStateFromSupabase();
    if (!loaded) {
      await saveStateToSupabase();
    }
    return loaded;
  } catch (error) {
    storageStatus.provider = "supabase";
    storageStatus.synced = false;
    storageStatus.lastError = error.message;
    throw error;
  }
}

app.use("/api", async (req, res, next) => {
  try {
    await refreshStateFromSupabase();
    next();
  } catch (error) {
    res.status(503).json({ error: "Falha na sincronização com o Supabase", detail: error.message });
  }
});

function getWardOr404(req, res) {
  const id = parseInt(req.params.wardId, 10);
  const ward = wards.find(w => w.id === id);
  if (!ward) {
    res.status(404).json({ error: "Setor não encontrado" });
    return null;
  }
  return ward;
}

function getWardName(wardId) {
  return wards.find(ward => ward.id === wardId)?.nome || "";
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePersonName(value) {
  return String(value || "").trim().toUpperCase();
}

function getCurrentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isBedOccupiedByPatient(bed) {
  return String(bed?.status || "").toUpperCase() === "OCUPADO" && Boolean(String(bed?.nome || "").trim());
}

function isSamePatientIdentity(a, b) {
  const cpfA = normalizeCpf(a?.cpf);
  const cpfB = normalizeCpf(b?.cpf);
  if (cpfA && cpfB) return cpfA === cpfB;
  return normalizePersonName(a?.nome) === normalizePersonName(b?.nome)
    && String(a?.birthDate || "") === String(b?.birthDate || "");
}

function findPatientByCurrentLocation(wardId, bedId) {
  return patientRegistry.find(patient =>
    !patient.deletedAt
    && patient.currentAdmission
    && Number(patient.currentAdmission.wardId) === Number(wardId)
    && Number(patient.currentAdmission.bedId) === Number(bedId)
  ) || null;
}

function findPatientRegistryEntry(identity = {}) {
  const cpf = normalizeCpf(identity.cpf);
  const nome = normalizePersonName(identity.nome);
  const birthDate = String(identity.birthDate || "");

  if (cpf) {
    return patientRegistry.find(patient => !patient.deletedAt && normalizeCpf(patient.cpf) === cpf) || null;
  }

  if (!nome) return null;

  return patientRegistry.find(patient =>
    !patient.deletedAt
    && normalizePersonName(patient.nome) === nome
    && String(patient.birthDate || "") === birthDate
  ) || null;
}

function createPatientRecordFromBed(bed) {
  const now = new Date().toISOString();
  return {
    id: nextPatientId++,
    nome: bed.nome || "",
    cpf: normalizeCpf(bed.cpf),
    birthDate: bed.birthDate || "",
    diagnostico: bed.diagnostico || "",
    nir: bed.nir || "",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    currentAdmission: null,
    admissionHistory: []
  };
}

function ensurePatientRecordFromBed(bed) {
  let patient = findPatientRegistryEntry(bed);
  if (!patient) {
    patient = createPatientRecordFromBed(bed);
    patientRegistry.push(patient);
  }
  patient.nome = bed.nome || patient.nome || "";
  patient.cpf = normalizeCpf(bed.cpf) || patient.cpf || "";
  patient.birthDate = bed.birthDate || patient.birthDate || "";
  patient.diagnostico = bed.diagnostico || "";
  patient.nir = bed.nir || "";
  patient.deletedAt = null;
  patient.updatedAt = new Date().toISOString();
  return patient;
}

function createAdmissionRecord(ward, bed, actor) {
  return {
    id: createRecordId(),
    wardId: ward.id,
    wardNome: ward.nome || "",
    bedId: bed.id,
    enfermaria: bed.enfermaria || "",
    admittedAt: bed.admissao || getCurrentIsoDate(),
    dischargedAt: null,
    outcome: null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    transferHistory: []
  };
}

function ensurePatientAdmissionRecord(patient, ward, bed, actor) {
  if (!patient.currentAdmission) {
    const admission = createAdmissionRecord(ward, bed, actor);
    patient.currentAdmission = admission;
    if (!Array.isArray(patient.admissionHistory)) patient.admissionHistory = [];
    patient.admissionHistory.unshift(admission);
  } else {
    const admission = patient.currentAdmission;
    if (!Array.isArray(admission.transferHistory)) admission.transferHistory = [];
    admission.wardId = ward.id;
    admission.wardNome = ward.nome || "";
    admission.bedId = bed.id;
    admission.enfermaria = bed.enfermaria || "";
    admission.admittedAt = admission.admittedAt || bed.admissao || getCurrentIsoDate();
    admission.updatedAt = new Date().toISOString();
    admission.updatedBy = actor;
  }
  patient.updatedAt = new Date().toISOString();
  return patient.currentAdmission;
}

function closePatientAdmissionByBedSnapshot(bed, ward, outcome, actor, reason = "") {
  const patient = findPatientByCurrentLocation(ward.id, bed.id) || findPatientRegistryEntry(bed);
  if (!patient || !patient.currentAdmission) return null;
  patient.currentAdmission.dischargedAt = new Date().toISOString();
  patient.currentAdmission.outcome = outcome || "ENCERRADA";
  patient.currentAdmission.updatedAt = new Date().toISOString();
  patient.currentAdmission.updatedBy = actor;
  if (reason) patient.currentAdmission.closeReason = reason;
  patient.currentAdmission = null;
  patient.updatedAt = new Date().toISOString();
  return patient;
}

function syncPatientRegistryWithBed(previousBed, currentBed, ward, actor) {
  const previousOccupied = isBedOccupiedByPatient(previousBed);
  const currentOccupied = isBedOccupiedByPatient(currentBed);

  if (previousOccupied && (!currentOccupied || !isSamePatientIdentity(previousBed, currentBed))) {
    closePatientAdmissionByBedSnapshot(previousBed, ward, currentBed.status || "ENCERRADA", actor, "Atualização do leito");
  }

  if (!currentOccupied) return null;

  const patient = ensurePatientRecordFromBed(currentBed);
  ensurePatientAdmissionRecord(patient, ward, currentBed, actor);
  return patient;
}

function registerPatientTransfer(sourceWard, sourceBed, targetWard, targetBed, actor) {
  const patient = findPatientByCurrentLocation(sourceWard.id, sourceBed.id) || ensurePatientRecordFromBed(targetBed);
  const admission = ensurePatientAdmissionRecord(patient, sourceWard, sourceBed, actor);
  if (!Array.isArray(admission.transferHistory)) admission.transferHistory = [];
  admission.transferHistory.push({
    id: createRecordId(),
    at: new Date().toISOString(),
    fromWardId: sourceWard.id,
    fromWardNome: sourceWard.nome || "",
    fromBedId: sourceBed.id,
    fromEnfermaria: sourceBed.enfermaria || "",
    toWardId: targetWard.id,
    toWardNome: targetWard.nome || "",
    toBedId: targetBed.id,
    toEnfermaria: targetBed.enfermaria || "",
    changedBy: actor
  });
  admission.wardId = targetWard.id;
  admission.wardNome = targetWard.nome || "";
  admission.bedId = targetBed.id;
  admission.enfermaria = targetBed.enfermaria || "";
  admission.updatedAt = new Date().toISOString();
  admission.updatedBy = actor;
  patient.nome = targetBed.nome || patient.nome || "";
  patient.cpf = normalizeCpf(targetBed.cpf) || patient.cpf || "";
  patient.birthDate = targetBed.birthDate || patient.birthDate || "";
  patient.diagnostico = targetBed.diagnostico || "";
  patient.nir = targetBed.nir || "";
  patient.updatedAt = new Date().toISOString();
  return patient;
}

function rebuildPatientRegistryFromWards() {
  patientRegistry.length = 0;
  nextPatientId = 1;
  for (const ward of wards) {
    for (const bed of ward.beds || []) {
      normalizeBedData(bed);
      if (!isBedOccupiedByPatient(bed)) continue;
      const patient = ensurePatientRecordFromBed(bed);
      ensurePatientAdmissionRecord(patient, ward, bed, "Sistema");
    }
  }
}

function findPatientOr404(req, res) {
  const patientId = parseInt(req.params.patientId, 10);
  const patient = patientRegistry.find(item => Number(item.id) === patientId && !item.deletedAt);
  if (!patient) {
    res.status(404).json({ error: "Paciente não encontrado" });
    return null;
  }
  return patient;
}

function patientForClient(patient) {
  const currentAdmission = patient.currentAdmission ? {
    ...patient.currentAdmission,
    active: true
  } : null;
  const lastAdmission = patient.currentAdmission || (Array.isArray(patient.admissionHistory) ? patient.admissionHistory[0] : null) || null;
  return {
    id: patient.id,
    nome: patient.nome || "",
    cpf: patient.cpf || "",
    birthDate: patient.birthDate || "",
    diagnostico: patient.diagnostico || "",
    nir: patient.nir || "",
    createdAt: patient.createdAt || "",
    updatedAt: patient.updatedAt || "",
    active: Boolean(patient.currentAdmission),
    currentAdmission,
    admissionCount: Array.isArray(patient.admissionHistory) ? patient.admissionHistory.length : 0,
    lastAdmission
  };
}

function getNextUserId() {
  return users.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0) + 1;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    nome: user.nome,
    cpf: user.cpf || "",
    birthDate: user.birthDate || "",
    role: user.role,
    activeShift: user.activeShift,
    recentActions: (user.actions || []).slice(0, 20)
  };
}

function addUserAction(user, type, description, meta = {}) {
  const entry = {
    id: createRecordId(),
    at: new Date().toISOString(),
    username: user.username,
    type,
    description,
    meta
  };
  if (!Array.isArray(user.actions)) user.actions = [];
  user.actions.unshift(entry);
  user.actions = user.actions.slice(0, 300);
  if (user.activeShift) {
    if (!Array.isArray(user.activeShift.actions)) user.activeShift.actions = [];
    user.activeShift.actions.push(entry);
  }
  return entry;
}

function addShiftSolvedPendings(user, wardId, items) {
  if (!user?.activeShift || user.activeShift.wardId !== wardId || !Array.isArray(items) || !items.length) return;
  if (!Array.isArray(user.activeShift.pendenciasFinalizadas)) {
    user.activeShift.pendenciasFinalizadas = [];
  }

  for (const item of items) {
    const key = `${item.leito}:${item.id || item.texto}:${item.finishedAt || ""}`;
    const exists = user.activeShift.pendenciasFinalizadas.some(existing =>
      `${existing.leito}:${existing.id || existing.texto}:${existing.finishedAt || ""}` === key
    );
    if (!exists) {
      user.activeShift.pendenciasFinalizadas.push({ ...item });
    }
  }
}

function buildShiftReport(user, shift) {
  const ward = wards.find(item => item.id === shift.wardId);
  const beds = ward ? ward.beds.map(bed => normalizeBedData({ ...bed })) : [];
  const occupiedBeds = beds
    .filter(bed => bed.status === "OCUPADO")
    .sort((a, b) => a.id - b.id)
    .map(bed => ({
      leito: bed.id,
      enfermaria: bed.enfermaria || "",
      nome: bed.nome || "",
      admissao: bed.admissao || "",
      diagnostico: bed.diagnostico || "",
      pendencias: bed.pendencias || "",
      nir: bed.nir || "",
      procedimentos: Array.isArray(bed.procedimentos) ? bed.procedimentos : []
    }));

  const altas = (shift.actions || []).filter(action => action.type === "ALTA").length;
  const obitos = (shift.actions || []).filter(action => action.type === "OBITO").length;
  const dispositivos = {};

  for (const patient of occupiedBeds) {
    for (const procedimento of patient.procedimentos) {
      dispositivos[procedimento] = (dispositivos[procedimento] || 0) + 1;
    }
  }

  for (const action of shift.actions || []) {
    const procedimentos = Array.isArray(action.meta?.procedimentos) ? action.meta.procedimentos : [];
    for (const procedimento of procedimentos) {
      dispositivos[procedimento] = (dispositivos[procedimento] || 0) + 1;
    }
  }

  const activePendencias = [];
  const solvedPendencias = [];
  const solvedKeys = new Set();
  const openedAtMs = shift.openedAt ? new Date(shift.openedAt).getTime() : 0;
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

  for (const bed of beds) {
    for (const pendencia of bed.pendenciasHistorico || []) {
      const baseItem = {
        leito: bed.id,
        enfermaria: bed.enfermaria || "",
        paciente: bed.nome || "",
        texto: pendencia.texto,
        createdAt: pendencia.createdAt,
        createdBy: pendencia.createdBy,
        finishedAt: pendencia.finishedAt,
        finishedBy: pendencia.finishedBy
      };

      if (pendencia.status !== "FINALIZADA") {
        activePendencias.push(baseItem);
      }

      if (pendencia.finishedAt) {
        const finishedAtMs = new Date(pendencia.finishedAt).getTime();
        if (finishedAtMs >= openedAtMs && finishedAtMs <= closedAtMs) {
          const solvedKey = `${bed.id}:${pendencia.id || pendencia.texto}:${pendencia.finishedAt || ""}`;
          if (!solvedKeys.has(solvedKey)) {
            solvedKeys.add(solvedKey);
            solvedPendencias.push(baseItem);
          }
        }
      }
    }
  }

  for (const action of shift.actions || []) {
    const finalizedItems = Array.isArray(action.meta?.pendenciasFinalizadas) ? action.meta.pendenciasFinalizadas : [];
    for (const item of finalizedItems) {
      const solvedKey = `${item.leito}:${item.id || item.texto}:${item.finishedAt || action.at || ""}`;
      if (solvedKeys.has(solvedKey)) continue;
      solvedKeys.add(solvedKey);
      solvedPendencias.push({
        leito: item.leito,
        enfermaria: item.enfermaria || "",
        paciente: item.paciente || "",
        texto: item.texto || "",
        createdAt: item.createdAt || "",
        createdBy: item.createdBy || "",
        finishedAt: item.finishedAt || action.at || "",
        finishedBy: item.finishedBy || action.username || ""
      });
    }
  }

  for (const item of shift.pendenciasFinalizadas || []) {
    const solvedKey = `${item.leito}:${item.id || item.texto}:${item.finishedAt || ""}`;
    if (solvedKeys.has(solvedKey)) continue;
    solvedKeys.add(solvedKey);
    solvedPendencias.push({
      leito: item.leito,
      enfermaria: item.enfermaria || "",
      paciente: item.paciente || "",
      texto: item.texto || "",
      createdAt: item.createdAt || "",
      createdBy: item.createdBy || "",
      finishedAt: item.finishedAt || "",
      finishedBy: item.finishedBy || ""
    });
  }

  activePendencias.sort((a, b) => String(a.enfermaria).localeCompare(String(b.enfermaria), "pt-BR") || a.leito - b.leito);
  solvedPendencias.sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());

  return {
    shift: {
      id: shift.id,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      wardId: shift.wardId,
      wardNome: shift.wardNome,
      username: user.username,
      nome: user.nome
    },
    summary: {
      pacientesAtivos: occupiedBeds.length,
      altas,
      obitos,
      dispositivos: topEntries(dispositivos, 20),
      pendenciasAtivas: activePendencias.length,
      pendenciasSolucionadas: solvedPendencias.length,
      totalAlteracoes: (shift.actions || []).length
    },
    patients: occupiedBeds,
    pending: {
      active: activePendencias,
      solved: solvedPendencias
    },
    actions: (shift.actions || []).slice().reverse()
  };
}

function normalizeBedData(bed) {
  bed.cpf = String(bed.cpf || "").replace(/\D/g, "");
  bed.birthDate = bed.birthDate || "";
  if (!Array.isArray(bed.pendenciasHistorico)) {
    const text = String(bed.pendencias || "").trim();
    bed.pendenciasHistorico = text ? [{
      id: createRecordId(),
      texto: text,
      status: "ATIVA",
      createdAt: new Date().toISOString(),
      createdBy: "Sistema",
      finishedAt: null,
      finishedBy: null
    }] : [];
  }

  if (!Array.isArray(bed.procedimentosHistorico)) {
    const antigos = Array.isArray(bed.procedimentos) ? bed.procedimentos : [];
    bed.procedimentosHistorico = antigos.map(item => ({
      id: createRecordId(),
      tipo: item,
      createdAt: new Date().toISOString(),
      createdBy: "Sistema"
    }));
  }

  bed.pendencias = bed.pendenciasHistorico
    .filter(item => item.status !== "FINALIZADA")
    .map(item => item.texto)
    .join(", ");
  bed.procedimentos = bed.procedimentosHistorico.map(item => item.tipo);
  return bed;
}

function clearBedPatientData(bed, nextStatus = "LIVRE") {
  bed.status = nextStatus;
  bed.admissao = "";
  bed.nome = "";
  bed.cpf = "";
  bed.birthDate = "";
  bed.diagnostico = "";
  bed.pendencias = "";
  bed.nir = "";
  bed.procedimentos = [];
  bed.pendenciasHistorico = [];
  bed.procedimentosHistorico = [];
  return bed;
}

function clonePatientPayload(bed) {
  normalizeBedData(bed);
  return {
    status: "OCUPADO",
    admissao: bed.admissao || "",
    nome: bed.nome || "",
    cpf: bed.cpf || "",
    birthDate: bed.birthDate || "",
    diagnostico: bed.diagnostico || "",
    pendencias: bed.pendencias || "",
    nir: bed.nir || "",
    procedimentos: Array.isArray(bed.procedimentos) ? [...bed.procedimentos] : [],
    pendenciasHistorico: Array.isArray(bed.pendenciasHistorico) ? JSON.parse(JSON.stringify(bed.pendenciasHistorico)) : [],
    procedimentosHistorico: Array.isArray(bed.procedimentosHistorico) ? JSON.parse(JSON.stringify(bed.procedimentosHistorico)) : []
  };
}

function computeCounts(beds) {
  const counts = { OCUPADO: 0, LIVRE: 0, BLOQUEADO: 0, RESERVADO: 0, EXTRA: 0, TOTAL: 0 };
  for (const b of beds) {
    if (counts[b.status] === undefined) counts[b.status] = 0;
    counts[b.status] += 1;
    counts.TOTAL += 1;
  }
  return counts;
}

function computeTempoMedio(admissao) {
  if (!admissao) return 0;
  const start = new Date(`${admissao}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  const diff = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function bedForClient(bed) {
  const normalized = normalizeBedData({ ...bed });
  return {
    ...normalized,
    pendenciasAtivas: normalized.pendenciasHistorico.filter(item => item.status !== "FINALIZADA").length,
    tempoMedio: computeTempoMedio(normalized.admissao)
  };
}

function parseDashboardPeriod(query) {
  const month = String(query.month || "").trim();
  const fromRaw = String(query.from || "").trim();
  const toRaw = String(query.to || "").trim();

  let from = "";
  let to = "";

  if (month) {
    const [year, mon] = month.split("-").map(Number);
    if (year && mon) {
      const lastDay = new Date(year, mon, 0).getDate();
      from = `${year}-${String(mon).padStart(2, "0")}-01`;
      to = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }

  if (fromRaw) from = fromRaw;
  if (toRaw) to = toRaw;
  return { from, to, month };
}

function isInPeriod(dateValue, period) {
  if (!dateValue) return false;
  if (period.from && dateValue < period.from) return false;
  if (period.to && dateValue > period.to) return false;
  return true;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function topEntries(record, limit = 6) {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Usuário ou senha inválidos" });
  const sid = createSession(user.username);
  res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/`);
  res.json({ ok: true, username: user.username, sid, user: sanitizeUser(user) });
});

app.post("/api/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const sid = headerSid || cookies.sid;
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const sid = headerSid || cookies.sid;
  const session = sid ? sessions.get(sid) : null;
  if (!session) return res.status(401).json({ error: "Não autenticado" });
  const user = users.find(item => item.username === session.username);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  res.json({ user: sanitizeUser(user) });
});

app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  const orderedUsers = [...users].sort((a, b) =>
    String(a.nome || a.username || "").localeCompare(String(b.nome || b.username || ""), "pt-BR")
  );
  res.json({ users: orderedUsers.map(sanitizeUser) });
});

app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();
  const nome = String(req.body?.nome || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const birthDate = String(req.body?.birthDate || "").trim();
  const role = String(req.body?.role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (!username) return res.status(400).json({ error: "Usuário é obrigatório" });
  if (!password) return res.status(400).json({ error: "Senha é obrigatória" });
  if (!cpf) return res.status(400).json({ error: "CPF é obrigatório" });
  if (cpf.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos" });
  if (!birthDate) return res.status(400).json({ error: "Data de nascimento é obrigatória" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ error: "Data de nascimento inválida" });
  }
  if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Já existe um usuário com esse login" });
  }
  if (users.some(user => normalizeCpf(user.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe um usuário com esse CPF" });
  }

  const user = {
    id: getNextUserId(),
    username,
    password,
    nome,
    cpf,
    birthDate,
    role,
    activeShift: null,
    shifts: [],
    actions: []
  };
  users.push(user);

  addUserAction(req.user, "USER_CREATE", `Cadastrou o usuário ${nome}`, {
    userId: user.id,
    username: user.username,
    role: user.role
  });

  await persistState();
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.get("/api/patients", requireAuth, (req, res) => {
  const search = normalizePersonName(req.query?.search);
  const activeFilter = String(req.query?.active || "").trim().toLowerCase();
  let items = patientRegistry.filter(patient => !patient.deletedAt);

  if (search) {
    items = items.filter(patient =>
      normalizePersonName(patient.nome).includes(search)
      || normalizeCpf(patient.cpf).includes(search.replace(/\D/g, ""))
    );
  }

  if (activeFilter === "true") items = items.filter(patient => Boolean(patient.currentAdmission));
  if (activeFilter === "false") items = items.filter(patient => !patient.currentAdmission);

  items = items
    .slice()
    .sort((a, b) =>
      Number(Boolean(b.currentAdmission)) - Number(Boolean(a.currentAdmission))
      || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
    );

  res.json({ patients: items.map(patientForClient) });
});

app.get("/api/patients/:patientId", requireAuth, (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  res.json({
    patient: {
      ...patientForClient(patient),
      admissionHistory: Array.isArray(patient.admissionHistory) ? patient.admissionHistory : []
    }
  });
});

app.patch("/api/patients/:patientId", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const nome = String(req.body?.nome || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const birthDate = String(req.body?.birthDate || "").trim();
  const diagnostico = String(req.body?.diagnostico || "").trim();
  const nir = String(req.body?.nir || "").trim();

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (!cpf || cpf.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos" });
  if (!birthDate) return res.status(400).json({ error: "Data de nascimento é obrigatória" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ error: "Data de nascimento inválida" });
  }
  if (patientRegistry.some(item => item.id !== patient.id && !item.deletedAt && normalizeCpf(item.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe outro paciente com esse CPF" });
  }

  patient.nome = nome;
  patient.cpf = cpf;
  patient.birthDate = birthDate;
  patient.diagnostico = diagnostico;
  patient.nir = nir;
  patient.updatedAt = new Date().toISOString();

  if (patient.currentAdmission) {
    const ward = wards.find(item => item.id === patient.currentAdmission.wardId);
    const bed = ward?.beds?.find(item => item.id === patient.currentAdmission.bedId);
    if (bed) {
      bed.nome = nome;
      bed.cpf = cpf;
      bed.birthDate = birthDate;
      bed.diagnostico = diagnostico;
      bed.nir = nir;
      normalizeBedData(bed);
    }
  }

  addUserAction(req.user, "PATIENT_UPDATE", `Atualizou o cadastro do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    active: Boolean(patient.currentAdmission)
  });

  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.delete("/api/patients/:patientId", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  if (patient.currentAdmission) {
    return res.status(400).json({ error: "Não é possível excluir paciente com internação ativa" });
  }

  patient.deletedAt = new Date().toISOString();
  patient.updatedAt = patient.deletedAt;

  addUserAction(req.user, "PATIENT_DELETE", `Excluiu o cadastro do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome
  });

  await persistState();
  res.json({ ok: true });
});

app.post("/api/shifts/open", requireAuth, async (req, res) => {
  if (req.user.activeShift) return res.status(400).json({ error: "Já existe um plantão aberto para este usuário" });
  const wardId = parseInt(req.body?.wardId, 10);
  const ward = wards.find(item => item.id === wardId);
  if (!ward) return res.status(400).json({ error: "Selecione um setor válido para abrir o plantão" });

  req.user.activeShift = {
    id: nextShiftId++,
    openedAt: new Date().toISOString(),
    closedAt: null,
    wardId: ward.id,
    wardNome: ward.nome,
    actions: [],
    pendenciasFinalizadas: []
  };
  addUserAction(req.user, "SHIFT_OPEN", `Abriu plantão no setor ${ward.nome}`, { wardId: ward.id, wardNome: ward.nome });
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

app.post("/api/shifts/close", requireAuth, async (req, res) => {
  if (!req.user.activeShift) return res.status(400).json({ error: "Não há plantão aberto para este usuário" });
  req.user.activeShift.closedAt = new Date().toISOString();
  const closingShift = req.user.activeShift;
  addUserAction(req.user, "SHIFT_CLOSE", `Fechou plantão no setor ${closingShift.wardNome}`, {
    wardId: closingShift.wardId,
    wardNome: closingShift.wardNome
  });
  const report = buildShiftReport(req.user, closingShift);
  if (!Array.isArray(req.user.shifts)) req.user.shifts = [];
  req.user.shifts.unshift(closingShift);
  req.user.shifts = req.user.shifts.slice(0, 100);
  req.user.activeShift = null;
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user), report });
});

app.get("/api/wards", requireAuth, (req, res) => {
  res.json({ wards: wards.map(w => ({ id: w.id, nome: w.nome, enfermarias: w.enfermarias || [] })) });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const period = parseDashboardPeriod(req.query || {});
  const wardId = parseInt(req.query?.wardId, 10);
  const selectedWard = Number.isInteger(wardId) ? wards.find(ward => ward.id === wardId) : null;
  const sourceWards = selectedWard ? [selectedWard] : wards;
  const allBeds = sourceWards.flatMap(ward => ward.beds.map(bed => ({ ...bed, setor: ward.nome, tempoMedio: computeTempoMedio(bed.admissao) })));
  const currentCounts = computeCounts(allBeds);
  const totalBeds = currentCounts.TOTAL || 0;
  const filteredBeds = (period.from || period.to) ? allBeds.filter(bed => isInPeriod(bed.admissao, period)) : allBeds;
  const filteredOccupiedBeds = filteredBeds.filter(bed => bed.status === "OCUPADO");

  const pathologyRecord = {};
  const procedureRecord = {};
  const permanenceBands = { "0-3 dias": 0, "4-7 dias": 0, "8-15 dias": 0, "16+ dias": 0 };

  for (const bed of filteredOccupiedBeds) {
    const diagnostico = String(bed.diagnostico || "").trim() || "Não informado";
    pathologyRecord[diagnostico] = (pathologyRecord[diagnostico] || 0) + 1;

    for (const proc of Array.isArray(bed.procedimentos) ? bed.procedimentos : []) {
      procedureRecord[proc] = (procedureRecord[proc] || 0) + 1;
    }

    if (bed.tempoMedio <= 3) permanenceBands["0-3 dias"] += 1;
    else if (bed.tempoMedio <= 7) permanenceBands["4-7 dias"] += 1;
    else if (bed.tempoMedio <= 15) permanenceBands["8-15 dias"] += 1;
    else permanenceBands["16+ dias"] += 1;
  }

  const setorChart = sourceWards.map(ward => {
    const counts = computeCounts(ward.beds);
    const taxa = counts.TOTAL ? Math.round((counts.OCUPADO / counts.TOTAL) * 1000) / 10 : 0;
    return {
      label: ward.nome,
      ocupados: counts.OCUPADO,
      leitos: counts.TOTAL,
      taxa
    };
  }).sort((a, b) => b.taxa - a.taxa || a.label.localeCompare(b.label, "pt-BR"));

  const altasAcumuladas = sourceWards.reduce((sum, ward) => sum + (ward.indicadores?.altas || 0), 0);
  const obitosAcumulados = sourceWards.reduce((sum, ward) => sum + (ward.indicadores?.obitos || 0), 0);
  const mediaPermanencia = average(filteredOccupiedBeds.map(bed => bed.tempoMedio));
  const taxaOcupacao = totalBeds ? Math.round((currentCounts.OCUPADO / totalBeds) * 1000) / 10 : 0;
  const taxaBloqueio = totalBeds ? Math.round((currentCounts.BLOQUEADO / totalBeds) * 1000) / 10 : 0;
  const taxaRotatividade = totalBeds ? Math.round(((altasAcumuladas + obitosAcumulados) / totalBeds) * 1000) / 10 : 0;
  const taxaEvasao = 0;

  res.json({
    period,
    scope: {
      wardId: selectedWard?.id || null,
      label: selectedWard ? selectedWard.nome : "Todos os setores"
    },
    overview: {
      pacientesInternados: currentCounts.OCUPADO,
      leitosTotais: totalBeds,
      admissoesNoPeriodo: filteredBeds.filter(bed => Boolean(bed.admissao)).length,
      mediaPermanencia,
      taxaOcupacao,
      taxaBloqueio,
      taxaRotatividade,
      taxaEvasao,
      altasAcumuladas,
      obitosAcumulados
    },
    charts: {
      patologias: topEntries(pathologyRecord),
      procedimentos: topEntries(procedureRecord),
      permanencia: topEntries(permanenceBands, 10),
      setores: setorChart
    }
  });
});

app.post("/api/wards", requireAuth, async (req, res) => {
  const nome = String(req.body?.nome || "").trim();
  if (!nome) return res.status(400).json({ error: "Nome obrigatório" });
  const id = nextWardId++;
  const ward = {
    id,
    nome,
    enfermarias: [],
    indicadores: { altas: 0, obitos: 0 },
    equipe: { medicoPlantao: "", enfermeiroDia: "", tecnicosDia: "", enfermeiroNoite: "", tecnicosNoite: "", faltosos: "" },
    beds: []
  };
  wards.push(ward);
  addUserAction(req.user, "WARD_CREATE", `Criou o setor ${ward.nome}`, { wardId: ward.id, wardNome: ward.nome });
  await persistState();
  res.json({ ward: { id: ward.id, nome: ward.nome, enfermarias: ward.enfermarias } });
});

app.post("/api/wards/:wardId/enfermarias", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const nome = String(req.body?.nome || "").trim();
  if (!nome) return res.status(400).json({ error: "Nome da enfermaria é obrigatório" });
  if (!ward.enfermarias) ward.enfermarias = [];
  if (!ward.enfermarias.includes(nome)) {
    ward.enfermarias.push(nome);
  }
  addUserAction(req.user, "ENFERMARIA_CREATE", `Criou a enfermaria ${nome} no setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    enfermaria: nome
  });
  await persistState();
  res.json({ ward: { id: ward.id, nome: ward.nome, enfermarias: ward.enfermarias } });
});

app.post("/api/wards/:wardId/enfermarias/delete", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const enfermaria = String(req.body?.enfermaria || "").trim();
  if (!enfermaria) return res.status(400).json({ error: "Enfermaria obrigatória" });
  ward.enfermarias = (ward.enfermarias || []).filter(e => e !== enfermaria);
  const before = ward.beds.length;
  ward.beds = ward.beds.filter(b => b.enfermaria !== enfermaria);
  const removedBeds = before - ward.beds.length;
  addUserAction(req.user, "ENFERMARIA_DELETE", `Excluiu a enfermaria ${enfermaria} do setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    enfermaria,
    removedBeds
  });
  await persistState();
  res.json({ ok: true, removedBeds });
});

app.post("/api/wards/:wardId/beds", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const enfermaria = String(req.body?.enfermaria || "").trim();
  if (enfermaria && !ward.enfermarias?.includes(enfermaria)) return res.status(400).json({ error: "Enfermaria inválida" });
  const start = parseInt(req.body?.start, 10);
  const end = parseInt(req.body?.end, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) {
    return res.status(400).json({ error: "Intervalo inválido" });
  }
  const existing = new Set(ward.beds.map(b => b.id));
  const added = [];
  for (let id = start; id <= end; id++) {
    if (existing.has(id)) continue;
    ward.beds.push({
      id,
      enfermaria,
      status: "LIVRE",
      admissao: "",
      nome: "",
      cpf: "",
      birthDate: "",
      diagnostico: "",
      pendencias: "",
      nir: "",
      procedimentos: [],
      pendenciasHistorico: [],
      procedimentosHistorico: []
    });
    added.push(id);
  }
  ward.beds.sort((a, b) => a.id - b.id);
  addUserAction(req.user, "BEDS_ADD", `Adicionou leitos ${start}-${end} na enfermaria ${enfermaria}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    enfermaria: enfermaria || "SEM ENFERMARIA",
    leitos: added
  });
  await persistState();
  res.json({ added });
});

app.post("/api/wards/:wardId/beds/delete", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const enfermaria = String(req.body?.enfermaria || "").trim();
  if (enfermaria && !ward.enfermarias?.includes(enfermaria)) return res.status(400).json({ error: "Enfermaria inválida" });
  const start = req.body?.start === undefined || req.body?.start === null || req.body?.start === "" ? null : parseInt(req.body?.start, 10);
  const end = req.body?.end === undefined || req.body?.end === null || req.body?.end === "" ? null : parseInt(req.body?.end, 10);
  if ((start !== null && !Number.isInteger(start)) || (end !== null && !Number.isInteger(end))) {
    return res.status(400).json({ error: "Intervalo inválido" });
  }
  if (start !== null && end !== null && end < start) return res.status(400).json({ error: "Intervalo inválido" });
  const before = ward.beds.length;
  ward.beds = ward.beds.filter(b => {
    if (b.enfermaria !== enfermaria) return true;
    if (start === null && end === null) return false;
    if (start !== null && b.id < start) return true;
    if (end !== null && b.id > end) return true;
    return false;
  });
  const removedBeds = before - ward.beds.length;
  ward.beds.sort((a, b) => a.id - b.id);
  addUserAction(req.user, "BEDS_DELETE", `Excluiu ${removedBeds} leito(s) da enfermaria ${enfermaria}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    enfermaria: enfermaria || "SEM ENFERMARIA",
    start,
    end,
    removedBeds
  });
  await persistState();
  res.json({ ok: true, removedBeds });
});

app.get("/api/wards/:wardId", requireAuth, (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const counts = computeCounts(ward.beds);
  res.json({
    id: ward.id,
    nome: ward.nome,
    data: new Date().toLocaleDateString("pt-BR"),
    counts,
    indicadores: {
      pacientes: counts.OCUPADO,
      leitos: counts.TOTAL,
      altas: ward.indicadores.altas,
      obitos: ward.indicadores.obitos,
      leitos_bloqueados: counts.BLOQUEADO
    },
    equipe: ward.equipe,
    beds: ward.beds.map(bedForClient)
  });
});

app.post("/api/wards/:wardId/beds/:bedId/transfer", requireAuth, async (req, res) => {
  const sourceWard = getWardOr404(req, res);
  if (!sourceWard) return;
  const sourceBedId = parseInt(req.params.bedId, 10);
  const targetWardId = parseInt(req.body?.targetWardId, 10);
  const targetBedId = parseInt(req.body?.targetBedId, 10);
  if (!Number.isInteger(targetWardId)) return res.status(400).json({ error: "Setor de destino inválido" });
  if (!Number.isInteger(targetBedId)) return res.status(400).json({ error: "Leito de destino inválido" });
  if (sourceWard.id === targetWardId && sourceBedId === targetBedId) {
    return res.status(400).json({ error: "Selecione outro leito para a transferência" });
  }

  const targetWard = wards.find(item => item.id === targetWardId);
  if (!targetWard) return res.status(404).json({ error: "Setor de destino não encontrado" });

  const sourceBed = sourceWard.beds.find(b => b.id === sourceBedId);
  const targetBed = targetWard.beds.find(b => b.id === targetBedId);
  if (!sourceBed || !targetBed) return res.status(404).json({ error: "Leito não encontrado" });

  normalizeBedData(sourceBed);
  normalizeBedData(targetBed);

  if (sourceBed.status !== "OCUPADO" || !String(sourceBed.nome || "").trim()) {
    return res.status(400).json({ error: "Somente pacientes ocupando o leito podem ser transferidos" });
  }

  if (targetBed.status !== "LIVRE" && targetBed.status !== "EXTRA") {
    return res.status(400).json({ error: "O leito de destino precisa estar desocupado" });
  }

  const sourceSnapshot = JSON.parse(JSON.stringify(sourceBed));
  const patientSnapshot = clonePatientPayload(sourceBed);
  const patientName = patientSnapshot.nome;
  const fromWardName = sourceWard.nome || "";
  const toWardName = targetWard.nome || "";
  const fromEnfermaria = sourceBed.enfermaria || "SEM ENFERMARIA";
  const toEnfermaria = targetBed.enfermaria || "SEM ENFERMARIA";

  Object.assign(targetBed, patientSnapshot);
  normalizeBedData(targetBed);
  registerPatientTransfer(sourceWard, sourceSnapshot, targetWard, targetBed, req.user.nome || req.user.username);
  clearBedPatientData(sourceBed, "LIVRE");

  addUserAction(req.user, "BED_TRANSFER", `Transferiu ${patientName} do leito ${sourceBed.id} para o leito ${targetBed.id}`, {
    wardId: sourceWard.id,
    wardNome: fromWardName,
    patient: patientName,
    fromBedId: sourceBed.id,
    toBedId: targetBed.id,
    fromWardId: sourceWard.id,
    fromWardNome: fromWardName,
    toWardId: targetWard.id,
    toWardNome: toWardName,
    fromEnfermaria,
    toEnfermaria,
    admissao: patientSnapshot.admissao || "",
    diagnostico: patientSnapshot.diagnostico || "",
    nir: patientSnapshot.nir || "",
    procedimentos: patientSnapshot.procedimentos,
    pendenciasAtivas: patientSnapshot.pendenciasHistorico.filter(item => item.status !== "FINALIZADA").map(item => item.texto)
  });

  await persistState();
  res.json({
    ok: true,
    sourceCounts: computeCounts(sourceWard.beds),
    targetCounts: computeCounts(targetWard.beds),
    sourceBed: bedForClient(sourceBed),
    targetBed: bedForClient(targetBed)
  });
});

app.patch("/api/wards/:wardId/beds/:bedId", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const bedId = parseInt(req.params.bedId, 10);
  const bed = ward.beds.find(b => b.id === bedId);
  if (!bed) return res.status(404).json({ error: "Leito não encontrado" });
  normalizeBedData(bed);
  const previous = JSON.parse(JSON.stringify(bed));
  const payload = req.body || {};
  const pendenciasRegistradas = [];
  const pendenciasFinalizadas = [];
  if (payload.status && !statuses.includes(payload.status)) return res.status(400).json({ error: "Status inválido" });
  if (payload.procedimentos && !Array.isArray(payload.procedimentos)) return res.status(400).json({ error: "Procedimentos inválidos" });
  if (payload.pendenciasStatus && !Array.isArray(payload.pendenciasStatus)) return res.status(400).json({ error: "Pendências inválidas" });
  if (payload.cpf !== undefined) payload.cpf = String(payload.cpf || "").replace(/\D/g, "");

  if (Array.isArray(payload.procedimentos)) {
    const createdBy = req.user.nome || req.user.username;
    const novosProcedimentos = payload.procedimentos.filter(p => procedureOptions.includes(p));
    for (const procedimento of novosProcedimentos) {
      bed.procedimentosHistorico.push({
        id: createRecordId(),
        tipo: procedimento,
        createdAt: new Date().toISOString(),
        createdBy
      });
    }
    delete payload.procedimentos;
  }

  if (typeof payload.pendenciasAdd === "string") {
    const createdBy = req.user.nome || req.user.username;
    const lines = payload.pendenciasAdd.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    for (const line of lines) {
      const entry = {
        id: createRecordId(),
        texto: line,
        status: "ATIVA",
        createdAt: new Date().toISOString(),
        createdBy,
        finishedAt: null,
        finishedBy: null
      };
      bed.pendenciasHistorico.push(entry);
      pendenciasRegistradas.push({
        id: entry.id,
        leito: bed.id,
        enfermaria: bed.enfermaria || "",
        paciente: bed.nome || previous.nome || "",
        texto: entry.texto,
        createdAt: entry.createdAt,
        createdBy: entry.createdBy
      });
    }
    delete payload.pendenciasAdd;
  }

  if (Array.isArray(payload.pendenciasStatus)) {
    const finishedBy = req.user.nome || req.user.username;
    for (const item of payload.pendenciasStatus) {
      const target = bed.pendenciasHistorico.find(entry => entry.id === item.id);
      if (!target) continue;
      const previousStatus = target.status;
      const nextStatus = String(item.status || "").toUpperCase() === "FINALIZADA" ? "FINALIZADA" : "ATIVA";
      target.status = nextStatus;
      if (nextStatus === "FINALIZADA") {
        target.finishedAt = new Date().toISOString();
        target.finishedBy = finishedBy;
        if (previousStatus !== "FINALIZADA") {
          pendenciasFinalizadas.push({
            id: target.id,
            leito: bed.id,
            enfermaria: bed.enfermaria || "",
            paciente: bed.nome || previous.nome || "",
            texto: target.texto,
            createdAt: target.createdAt,
            createdBy: target.createdBy,
            finishedAt: target.finishedAt,
            finishedBy: target.finishedBy
          });
        }
      } else {
        target.finishedAt = null;
        target.finishedBy = null;
      }
    }
    delete payload.pendenciasStatus;
  }

  delete payload.pendencias;
  Object.assign(bed, payload);
  normalizeBedData(bed);
  if (payload.status && payload.status !== "OCUPADO") {
    clearBedPatientData(bed, payload.status);
  }
  syncPatientRegistryWithBed(previous, bed, ward, req.user.nome || req.user.username);
  addUserAction(req.user, "BED_UPDATE", `Atualizou o leito ${bed.id} no setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    bedId: bed.id,
    previousStatus: previous.status,
    currentStatus: bed.status,
    patient: bed.nome || previous.nome || "",
    procedimentos: Array.isArray(bed.procedimentos) ? bed.procedimentos : [],
    pendenciasAtivas: bed.pendenciasHistorico.filter(item => item.status !== "FINALIZADA").map(item => item.texto),
    pendenciasRegistradas,
    pendenciasFinalizadas
  });
  addShiftSolvedPendings(req.user, ward.id, pendenciasFinalizadas);
  await persistState();
  res.json({ bed: bedForClient(bed), counts: computeCounts(ward.beds) });
});

app.post("/api/wards/:wardId/beds/:bedId/outcome", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const bedId = parseInt(req.params.bedId, 10);
  const bed = ward.beds.find(b => b.id === bedId);
  if (!bed) return res.status(404).json({ error: "Leito não encontrado" });
  const type = String(req.body?.type || "").trim().toUpperCase();
  if (type !== "ALTA" && type !== "OBITO") return res.status(400).json({ error: "Tipo inválido" });
  if (type === "ALTA") ward.indicadores.altas = Math.max(0, (ward.indicadores.altas || 0) + 1);
  if (type === "OBITO") ward.indicadores.obitos = Math.max(0, (ward.indicadores.obitos || 0) + 1);
  const patientName = bed.nome || "";
  closePatientAdmissionByBedSnapshot(bed, ward, type, req.user.nome || req.user.username, "Desfecho da internação");
  clearBedPatientData(bed, "LIVRE");
  addUserAction(req.user, type, `${type === "ALTA" ? "Registrou alta" : "Registrou óbito"} no leito ${bed.id}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    bedId: bed.id,
    patient: patientName
  });
  await persistState();
  res.json({ ok: true, indicadores: ward.indicadores, counts: computeCounts(ward.beds), bed: bedForClient(bed) });
});

app.post("/api/wards/:wardId/indicadores", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const { altas, obitos } = req.body || {};
  if (typeof altas === "number") ward.indicadores.altas = Math.max(0, altas);
  if (typeof obitos === "number") ward.indicadores.obitos = Math.max(0, obitos);
  addUserAction(req.user, "INDICADORES_UPDATE", `Atualizou indicadores do setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    altas: ward.indicadores.altas,
    obitos: ward.indicadores.obitos
  });
  await persistState();
  res.json({ indicadores: ward.indicadores, counts: computeCounts(ward.beds) });
});

app.patch("/api/wards/:wardId/equipe", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  Object.assign(ward.equipe, req.body || {});
  addUserAction(req.user, "EQUIPE_UPDATE", `Atualizou equipe do setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome
  });
  await persistState();
  res.json({ equipe: ward.equipe });
});

app.get("/api/storage-status", requireAuth, (req, res) => {
  res.json({
    ...storageStatus,
    url: supabaseUrl,
    table: supabaseTable
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

initializeStorage()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch(error => {
    console.error(`Falha ao iniciar com Supabase: ${error.message}`);
    process.exit(1);
  });
