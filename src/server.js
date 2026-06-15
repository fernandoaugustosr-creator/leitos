const express = require("express");
const path = require("path");
const crypto = require("crypto");
const app = express();
const port = process.env.PORT || 3000;
const isServerlessRuntime = Boolean(process.env.VERCEL);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const statuses = ["OCUPADO", "LIVRE", "BLOQUEADO", "RESERVADO", "EXTRA"];
const procedureOptions = ["SNE", "SNG", "SANGUE", "ASPIRAÇÃO", "DRENO DE TORAX"];
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
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
const nirDailyReports = [];
const sessions = new Map();
const storageStatus = {
  provider: "supabase",
  configured: Boolean(supabaseUrl && supabaseKey),
  synced: false,
  lastSyncAt: null,
  lastError: null
};
let storageInitializationPromise = null;

function trackStorageError(error) {
  storageStatus.provider = "supabase";
  storageStatus.synced = false;
  storageStatus.lastError = error.message;
}

async function ensureStorageInitialized() {
  if (!storageInitializationPromise) {
    storageInitializationPromise = initializeStorage().catch(error => {
      trackStorageError(error);
      storageInitializationPromise = null;
      throw error;
    });
  }

  return storageInitializationPromise;
}

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
    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!supabaseKey) missing.push("SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY");
    const error = new Error(`Supabase não configurado: ${missing.join(", ")}`);
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
    nirDailyReports,
    wards
  };
}

function createEmptyTeam() {
  return {
    medicoPlantao: "",
    enfermeiroDia: "",
    tecnicosDia: "",
    enfermeiroNoite: "",
    tecnicosNoite: "",
    faltosos: ""
  };
}

function ensureWardTeam(ward) {
  if (!ward) return createEmptyTeam();
  if (!ward.equipe || typeof ward.equipe !== "object") {
    ward.equipe = createEmptyTeam();
  }
  return ward.equipe;
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
        cil: patient.cil || "",
        regulationChannels: Array.isArray(patient.regulationChannels) ? patient.regulationChannels : [],
        regulationAcceptedAt: patient.regulationAcceptedAt || "",
        nirLastUpdateAt: patient.nirLastUpdateAt || "",
        nirLastUpdateBy: patient.nirLastUpdateBy || "",
        nirUpdateChannels: Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : [],
        createdAt: patient.createdAt || new Date().toISOString(),
        updatedAt: patient.updatedAt || new Date().toISOString(),
        deletedAt: patient.deletedAt || null,
        currentAdmission: patient.currentAdmission || null,
        admissionHistory: Array.isArray(patient.admissionHistory) ? patient.admissionHistory : [],
        visitHistory: Array.isArray(patient.visitHistory) ? patient.visitHistory : []
      });
    }
  }
  nirDailyReports.length = 0;
  if (Array.isArray(payload.nirDailyReports)) {
    for (const report of payload.nirDailyReports) {
      nirDailyReports.push({
        id: report.id || createRecordId(),
        operationalDay: report.operationalDay || "",
        authorUsername: report.authorUsername || "",
        authorName: report.authorName || "",
        content: report.content || "",
        createdAt: report.createdAt || new Date().toISOString(),
        updatedAt: report.updatedAt || new Date().toISOString()
      });
    }
  }
  wards.length = 0;
  for (const ward of payload.wards) {
    ensureWardTeam(ward);
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
    await ensureStorageInitialized();
    await refreshStateFromSupabase();
    next();
  } catch (error) {
    res.status(503).json({ error: "Falha na sincronização com o Supabase", detail: error.message });
  }
});

function isWardArchived(ward) {
  return Boolean(ward?.archivedAt);
}

function wardSummaryForClient(ward) {
  return {
    id: ward.id,
    nome: ward.nome,
    enfermarias: ward.enfermarias || [],
    archived: isWardArchived(ward),
    archivedAt: ward.archivedAt || null,
    bedsCount: Array.isArray(ward.beds) ? ward.beds.length : 0,
    enfermariasCount: Array.isArray(ward.enfermarias) ? ward.enfermarias.length : 0
  };
}

function getWardOr404(req, res, options = {}) {
  const { allowArchived = false } = options;
  const id = parseInt(req.params.wardId, 10);
  const ward = wards.find(w => w.id === id);
  if (!ward) {
    res.status(404).json({ error: "Setor não encontrado" });
    return null;
  }
  if (!allowArchived && isWardArchived(ward)) {
    res.status(404).json({ error: "Setor arquivado" });
    return null;
  }
  return ward;
}

function getWardName(wardId) {
  return wards.find(ward => ward.id === wardId)?.nome || "";
}

function syncWardNameReferences(wardId, nextWardName) {
  for (const patient of patientRegistry) {
    if (patient.currentAdmission && Number(patient.currentAdmission.wardId) === Number(wardId)) {
      patient.currentAdmission.wardNome = nextWardName;
    }

    if (Array.isArray(patient.admissionHistory)) {
      for (const admission of patient.admissionHistory) {
        if (Number(admission.wardId) === Number(wardId)) {
          admission.wardNome = nextWardName;
        }

        if (Array.isArray(admission.transferHistory)) {
          for (const transfer of admission.transferHistory) {
            if (Number(transfer.fromWardId) === Number(wardId)) transfer.fromWardNome = nextWardName;
            if (Number(transfer.toWardId) === Number(wardId)) transfer.toWardNome = nextWardName;
          }
        }
      }
    }
  }

  for (const user of users) {
    if (user.activeShift && Number(user.activeShift.wardId) === Number(wardId)) {
      user.activeShift.wardNome = nextWardName;
    }

    if (Array.isArray(user.shifts)) {
      for (const shift of user.shifts) {
        if (Number(shift.wardId) === Number(wardId)) {
          shift.wardNome = nextWardName;
        }
      }
    }
  }
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
    cil: bed.cil || "",
    regulationChannels: [],
    regulationAcceptedAt: "",
    nirLastUpdateAt: "",
    nirLastUpdateBy: "",
    nirUpdateChannels: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    currentAdmission: null,
    admissionHistory: [],
    visitHistory: []
  };
}

function createEmptyPatientRecord(payload = {}) {
  const now = new Date().toISOString();
  return {
    id: nextPatientId++,
    nome: String(payload.nome || "").trim(),
    cpf: normalizeCpf(payload.cpf),
    birthDate: String(payload.birthDate || "").trim(),
    diagnostico: String(payload.diagnostico || "").trim(),
    nir: String(payload.nir || "").trim(),
    cil: String(payload.cil || "").trim(),
    regulationChannels: Array.isArray(payload.regulationChannels) ? payload.regulationChannels : [],
    regulationAcceptedAt: String(payload.regulationAcceptedAt || "").trim(),
    nirLastUpdateAt: String(payload.nirLastUpdateAt || "").trim(),
    nirLastUpdateBy: String(payload.nirLastUpdateBy || "").trim(),
    nirUpdateChannels: Array.isArray(payload.nirUpdateChannels) ? payload.nirUpdateChannels : [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    currentAdmission: null,
    admissionHistory: [],
    visitHistory: []
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
  patient.cil = bed.cil || "";
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
  patient.cil = targetBed.cil || "";
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
    cil: patient.cil || "",
    regulationChannels: Array.isArray(patient.regulationChannels) ? patient.regulationChannels : [],
    regulationAcceptedAt: patient.regulationAcceptedAt || "",
    nirLastUpdateAt: patient.nirLastUpdateAt || "",
    nirLastUpdateBy: patient.nirLastUpdateBy || "",
    nirUpdateChannels: Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : [],
    createdAt: patient.createdAt || "",
    updatedAt: patient.updatedAt || "",
    active: Boolean(patient.currentAdmission),
    currentAdmission,
    admissionCount: Array.isArray(patient.admissionHistory) ? patient.admissionHistory.length : 0,
    lastAdmission,
    visitHistory: Array.isArray(patient.visitHistory) ? patient.visitHistory : []
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
    recentShifts: (user.shifts || []).slice(0, 20).map(shift => ({
      id: shift.id,
      shiftDate: shift.shiftDate || (shift.openedAt ? String(shift.openedAt).slice(0, 10) : ""),
      wardId: shift.wardId,
      wardNome: shift.wardNome || "",
      shiftLength: shift.shiftLength || "12H",
      shiftPeriod: shift.shiftPeriod || "DIA",
      openedAt: shift.openedAt || null,
      closedAt: shift.closedAt || null,
      team: shift.team || null
    })),
    recentActions: (user.actions || []).slice(0, 20)
  };
}

function sanitizeStaffUser(user) {
  return {
    id: user.id,
    username: user.username,
    nome: user.nome || user.username || "",
    role: user.role
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

  const activePendingMap = new Map();
  const solvedPendencias = [];
  const solvedKeys = new Set();
  const openedAtMs = shift.openedAt ? new Date(shift.openedAt).getTime() : 0;
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const pendingKey = item => `${item.leito}:${item.id || item.texto || ""}`;
  const addActivePending = item => {
    activePendingMap.set(pendingKey(item), { ...item });
  };
  const addSolvedPending = item => {
    const solvedKey = `${pendingKey(item)}:${item.finishedAt || ""}`;
    if (solvedKeys.has(solvedKey)) return;
    solvedKeys.add(solvedKey);
    activePendingMap.delete(pendingKey(item));
    solvedPendencias.push({ ...item });
  };

  for (const bed of beds) {
    for (const pendencia of bed.pendenciasHistorico || []) {
      const baseItem = {
        id: pendencia.id || "",
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
        addActivePending(baseItem);
      }

      if (pendencia.finishedAt) {
        const finishedAtMs = new Date(pendencia.finishedAt).getTime();
        if (finishedAtMs >= openedAtMs && finishedAtMs <= closedAtMs) {
          addSolvedPending(baseItem);
        }
      }
    }
  }

  for (const action of shift.actions || []) {
    const openedItems = Array.isArray(action.meta?.pendenciasRegistradas) ? action.meta.pendenciasRegistradas : [];
    for (const item of openedItems) {
      addActivePending({
        id: item.id || "",
        leito: item.leito,
        enfermaria: item.enfermaria || "",
        paciente: item.paciente || "",
        texto: item.texto || "",
        createdAt: item.createdAt || action.at || "",
        createdBy: item.createdBy || action.username || "",
        finishedAt: null,
        finishedBy: null
      });
    }

    const finalizedItems = Array.isArray(action.meta?.pendenciasFinalizadas) ? action.meta.pendenciasFinalizadas : [];
    for (const item of finalizedItems) {
      addSolvedPending({
        id: item.id || "",
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
    addSolvedPending({
      id: item.id || "",
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

  const activePendencias = Array.from(activePendingMap.values());
  activePendencias.sort((a, b) => String(a.enfermaria).localeCompare(String(b.enfermaria), "pt-BR") || a.leito - b.leito);
  solvedPendencias.sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime());

  return {
    shift: {
      id: shift.id,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      wardId: shift.wardId,
      wardNome: shift.wardNome,
      shiftLength: shift.shiftLength || "12H",
      shiftPeriod: shift.shiftPeriod || "DIA",
      team: shift.team || null,
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
  bed.cil = "";
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
    cil: bed.cil || "",
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

app.get("/api/staff", requireAuth, (req, res) => {
  const orderedUsers = [...users]
    .filter(user => String(user.nome || user.username || "").trim())
    .sort((a, b) =>
      String(a.nome || a.username || "").localeCompare(String(b.nome || b.username || ""), "pt-BR")
    );
  res.json({ users: orderedUsers.map(sanitizeStaffUser) });
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

app.patch("/api/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const user = users.find(item => Number(item.id) === userId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

  const nome = String(req.body?.nome || "").trim();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const birthDate = String(req.body?.birthDate || "").trim();
  const role = String(req.body?.role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (!username) return res.status(400).json({ error: "Usuário é obrigatório" });
  if (!cpf) return res.status(400).json({ error: "CPF é obrigatório" });
  if (cpf.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos" });
  if (!birthDate) return res.status(400).json({ error: "Data de nascimento é obrigatória" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ error: "Data de nascimento inválida" });
  }
  if (users.some(item => item.id !== user.id && item.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Já existe um usuário com esse login" });
  }
  if (users.some(item => item.id !== user.id && normalizeCpf(item.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe um usuário com esse CPF" });
  }

  const oldUsername = user.username;
  user.nome = nome;
  user.username = username;
  user.cpf = cpf;
  user.birthDate = birthDate;
  user.role = role;
  if (password) user.password = password;

  if (req.user.id === user.id && req.session) {
    req.session.username = user.username;
  }

  addUserAction(req.user, "USER_UPDATE", `Alterou o usuário ${user.nome}`, {
    userId: user.id,
    username: user.username,
    previousUsername: oldUsername,
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
      admissionHistory: Array.isArray(patient.admissionHistory) ? patient.admissionHistory : [],
      visitHistory: Array.isArray(patient.visitHistory) ? patient.visitHistory : []
    }
  });
});

app.post("/api/patients", requireAuth, async (req, res) => {
  const nome = String(req.body?.nome || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const birthDate = String(req.body?.birthDate || "").trim();
  const nir = String(req.body?.nir || "").trim();
  const cil = String(req.body?.cil || "").trim();
  const regulationChannels = Array.isArray(req.body?.regulationChannels)
    ? req.body.regulationChannels
      .map(item => String(item || "").trim().toUpperCase())
      .filter(item => item === "EMAIL" || item === "CIL")
    : [];
  const regulationAcceptedAt = String(req.body?.regulationAcceptedAt || "").trim();

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (!cpf || cpf.length !== 11) return res.status(400).json({ error: "CPF deve ter 11 dígitos" });
  if (!birthDate) return res.status(400).json({ error: "Data de nascimento é obrigatória" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ error: "Data de nascimento inválida" });
  }
  if (patientRegistry.some(item => !item.deletedAt && normalizeCpf(item.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe paciente com esse CPF" });
  }

  const patient = createEmptyPatientRecord({ nome, cpf, birthDate, nir, cil, regulationChannels, regulationAcceptedAt });
  patientRegistry.push(patient);

  addUserAction(req.user, "PATIENT_CREATE", `Cadastrou o paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome
  });

  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.post("/api/patients/:patientId/visits", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const visitorName = String(req.body?.visitorName || "").trim();
  const visitDate = String(req.body?.visitDate || "").trim();
  const visitShift = String(req.body?.visitShift || "").trim().toUpperCase();
  const visitTime = String(req.body?.visitTime || "").trim();
  const note = String(req.body?.note || "").trim();

  if (!visitorName) return res.status(400).json({ error: "Informe o nome do visitante" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return res.status(400).json({ error: "Informe a data da visita" });
  if (!["MANHA", "TARDE", "NOITE"].includes(visitShift)) return res.status(400).json({ error: "Selecione o turno da visita" });
  if (!/^\d{2}:\d{2}$/.test(visitTime)) return res.status(400).json({ error: "Informe o horário da visita" });

  const now = new Date().toISOString();
  const visit = {
    id: createRecordId(),
    visitorName,
    visitDate,
    visitShift,
    visitTime,
    note,
    createdAt: now,
    createdBy: req.user.nome || req.user.username || ""
  };

  if (!Array.isArray(patient.visitHistory)) patient.visitHistory = [];
  patient.visitHistory.unshift(visit);
  patient.updatedAt = now;

  addUserAction(req.user, "PATIENT_VISIT_CREATE", `Registrou visita para o paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    visitorName,
    visitDate,
    visitShift,
    visitTime
  });

  await persistState();
  res.json({ ok: true, visit, patient: patientForClient(patient) });
});

app.patch("/api/patients/:patientId", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const nome = String(req.body?.nome || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const birthDate = String(req.body?.birthDate || "").trim();
  const diagnostico = req.body?.diagnostico === undefined
    ? String(patient.diagnostico || "").trim()
    : String(req.body?.diagnostico || "").trim();
  const nir = String(req.body?.nir || "").trim();
  const cil = req.body?.cil === undefined
    ? String(patient.cil || "").trim()
    : String(req.body?.cil || "").trim();
  const regulationChannels = Array.isArray(req.body?.regulationChannels)
    ? req.body.regulationChannels
      .map(item => String(item || "").trim().toUpperCase())
      .filter(item => item === "EMAIL" || item === "CIL")
    : (Array.isArray(patient.regulationChannels) ? patient.regulationChannels : []);
  const nirUpdateChannels = Array.isArray(req.body?.nirUpdateChannels)
    ? req.body.nirUpdateChannels
      .map(item => String(item || "").trim().toUpperCase())
      .filter(item => item === "EMAIL" || item === "CIL")
    : (Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : []);
  const nirLastUpdateAt = req.body?.nirLastUpdateAt === undefined
    ? String(patient.nirLastUpdateAt || "").trim()
    : String(req.body?.nirLastUpdateAt || "").trim();
  const nirLastUpdateBy = req.body?.nirLastUpdateBy === undefined
    ? String(patient.nirLastUpdateBy || "").trim()
    : String(req.body?.nirLastUpdateBy || "").trim();
  const regulationAcceptedAt = req.body?.regulationAcceptedAt === undefined
    ? String(patient.regulationAcceptedAt || "").trim()
    : String(req.body?.regulationAcceptedAt || "").trim();

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
  patient.cil = cil;
  patient.regulationChannels = Array.from(new Set(regulationChannels));
  patient.regulationAcceptedAt = regulationAcceptedAt;
  patient.nirLastUpdateAt = nirLastUpdateAt;
  patient.nirLastUpdateBy = nirLastUpdateBy;
  patient.nirUpdateChannels = Array.from(new Set(nirUpdateChannels));
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
      bed.cil = cil;
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

app.post("/api/patients/:patientId/nir-update", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const channels = Array.isArray(req.body?.channels)
    ? req.body.channels
      .map(item => String(item || "").trim().toUpperCase())
      .filter(item => item === "CIL" || item === "EMAIL")
    : [];

  if (!channels.length) {
    return res.status(400).json({ error: "Informe ao menos uma atualização: CIL ou EMAIL." });
  }

  const now = new Date().toISOString();
  patient.nirLastUpdateAt = now;
  patient.nirLastUpdateBy = req.user.nome || req.user.username || "";
  patient.nirUpdateChannels = Array.from(new Set(channels));
  patient.updatedAt = now;

  addUserAction(req.user, "PATIENT_NIR_UPDATE", `Atualizou o NIR do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    channels: patient.nirUpdateChannels
  });

  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.get("/api/nir/reports", requireAuth, (req, res) => {
  const currentOperationalDay = getOperationalDayKey(new Date());
  const previousOperationalDay = getOperationalDayKey(new Date(Date.now() - (24 * 60 * 60 * 1000)));
  const currentReports = nirDailyReports
    .filter(item => item.operationalDay === currentOperationalDay)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const otherUserReports = currentReports
    .filter(item => item.authorUsername !== req.user.username);
  const previousReports = nirDailyReports
    .filter(item => item.operationalDay === previousOperationalDay)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const currentReport = currentReports.find(item => item.authorUsername === req.user.username) || null;

  res.json({
    operationalDay: currentOperationalDay,
    previousOperationalDay,
    currentReport,
    otherUserReports,
    previousReports
  });
});

app.post("/api/nir/reports", requireAuth, async (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) {
    return res.status(400).json({ error: "Digite o relatório do enfermeiro." });
  }

  const operationalDay = getOperationalDayKey(new Date());
  const now = new Date().toISOString();
  let report = nirDailyReports.find(item => item.operationalDay === operationalDay && item.authorUsername === req.user.username);
  if (!report) {
    report = {
      id: createRecordId(),
      operationalDay,
      authorUsername: req.user.username,
      authorName: req.user.nome || req.user.username || "",
      content,
      createdAt: now,
      updatedAt: now
    };
    nirDailyReports.unshift(report);
  } else {
    report.authorName = req.user.nome || req.user.username || "";
    report.content = content;
    report.updatedAt = now;
  }

  addUserAction(req.user, "NIR_REPORT_SAVE", `Salvou o relatório do NIR do dia ${operationalDay}`, {
    operationalDay
  });

  await persistState();
  const previousOperationalDay = getOperationalDayKey(new Date(Date.now() - (24 * 60 * 60 * 1000)));
  const otherUserReports = nirDailyReports
    .filter(item => item.operationalDay === operationalDay && item.authorUsername !== req.user.username)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const previousReports = nirDailyReports
    .filter(item => item.operationalDay === previousOperationalDay)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  res.json({ ok: true, currentReport: report, otherUserReports, previousReports });
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
  const wardTeam = ensureWardTeam(ward);
  const shiftLength = String(req.body?.shiftLength || "").trim().toUpperCase() === "24H" ? "24H" : "12H";
  let shiftPeriod = String(req.body?.shiftPeriod || "").trim().toUpperCase();
  if (shiftLength === "24H") shiftPeriod = "COMPLETO";
  if (!["DIA", "NOITE", "COMPLETO"].includes(shiftPeriod)) shiftPeriod = "DIA";

  req.user.activeShift = {
    id: nextShiftId++,
    shiftDate: getCurrentIsoDate(),
    openedAt: new Date().toISOString(),
    closedAt: null,
    wardId: ward.id,
    wardNome: ward.nome,
    shiftLength,
    shiftPeriod,
    team: {
      medicoPlantao: wardTeam.medicoPlantao || "",
      enfermeiroDia: wardTeam.enfermeiroDia || "",
      tecnicosDia: wardTeam.tecnicosDia || "",
      enfermeiroNoite: wardTeam.enfermeiroNoite || "",
      tecnicosNoite: wardTeam.tecnicosNoite || "",
      faltosos: wardTeam.faltosos || ""
    },
    actions: [],
    pendenciasFinalizadas: []
  };
  addUserAction(req.user, "SHIFT_OPEN", `Abriu plantão no setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    shiftLength,
    shiftPeriod
  });
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

app.patch("/api/shifts/team", requireAuth, async (req, res) => {
  if (!req.user.activeShift) return res.status(400).json({ error: "Nao ha plantao aberto para este usuario" });
  if (!req.user.activeShift.team) {
    req.user.activeShift.team = {
      medicoPlantao: "",
      enfermeiroDia: "",
      tecnicosDia: "",
      enfermeiroNoite: "",
      tecnicosNoite: "",
      faltosos: ""
    };
  }
  Object.assign(req.user.activeShift.team, req.body || {});
  const ward = wards.find(item => item.id === req.user.activeShift.wardId);
  if (ward) {
    Object.assign(ensureWardTeam(ward), req.user.activeShift.team);
  }
  req.user.activeShift.teamUpdatedAt = new Date().toISOString();
  req.user.activeShift.teamUpdatedBy = req.user.nome || req.user.username;
  addUserAction(req.user, "SHIFT_TEAM_UPDATE", `Atualizou a equipe do plantao no setor ${req.user.activeShift.wardNome}`, {
    wardId: req.user.activeShift.wardId,
    wardNome: req.user.activeShift.wardNome,
    shiftId: req.user.activeShift.id
  });
  await persistState();
  res.json({ ok: true, team: req.user.activeShift.team, user: sanitizeUser(req.user) });
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
  const includeArchived = String(req.query?.includeArchived || "").trim().toLowerCase() === "true";
  const items = includeArchived ? wards : wards.filter(ward => !isWardArchived(ward));
  res.json({ wards: items.map(wardSummaryForClient) });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const period = parseDashboardPeriod(req.query || {});
  const wardId = parseInt(req.query?.wardId, 10);
  const activeWards = wards.filter(ward => !isWardArchived(ward));
  const selectedWard = Number.isInteger(wardId) ? activeWards.find(ward => ward.id === wardId) : null;
  const sourceWards = selectedWard ? [selectedWard] : activeWards;
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
  if (wards.some(item => normalizePersonName(item.nome) === normalizePersonName(nome))) {
    return res.status(400).json({ error: "Já existe um setor com esse nome" });
  }
  const id = nextWardId++;
  const ward = {
    id,
    nome,
    enfermarias: [],
    indicadores: { altas: 0, obitos: 0 },
    equipe: { medicoPlantao: "", enfermeiroDia: "", tecnicosDia: "", enfermeiroNoite: "", tecnicosNoite: "", faltosos: "" },
    beds: [],
    archivedAt: null,
    archivedBy: null
  };
  wards.push(ward);
  addUserAction(req.user, "WARD_CREATE", `Criou o setor ${ward.nome}`, { wardId: ward.id, wardNome: ward.nome });
  await persistState();
  res.json({ ward: wardSummaryForClient(ward) });
});

app.patch("/api/wards/:wardId", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res, { allowArchived: true });
  if (!ward) return;

  const nome = String(req.body?.nome || "").trim();
  if (!nome) return res.status(400).json({ error: "Nome obrigatório" });
  if (wards.some(item => item.id !== ward.id && normalizePersonName(item.nome) === normalizePersonName(nome))) {
    return res.status(400).json({ error: "Já existe um setor com esse nome" });
  }

  const previousName = ward.nome;
  ward.nome = nome;
  syncWardNameReferences(ward.id, ward.nome);

  addUserAction(req.user, "WARD_UPDATE", `Alterou o setor ${previousName} para ${ward.nome}`, {
    wardId: ward.id,
    previousName,
    wardNome: ward.nome
  });

  await persistState();
  res.json({ ward: wardSummaryForClient(ward) });
});

app.post("/api/wards/:wardId/archive", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res, { allowArchived: true });
  if (!ward) return;

  const archived = req.body?.archived !== false;
  const occupiedBeds = (ward.beds || []).filter(isBedOccupiedByPatient);
  const activeShiftUser = users.find(user => user.activeShift && Number(user.activeShift.wardId) === Number(ward.id));

  if (archived) {
    if (occupiedBeds.length) {
      return res.status(400).json({ error: "Não é possível arquivar setor com pacientes internados" });
    }
    if (activeShiftUser) {
      return res.status(400).json({ error: "Não é possível arquivar setor com plantão aberto" });
    }
    ward.archivedAt = new Date().toISOString();
    ward.archivedBy = req.user.nome || req.user.username;
  } else {
    ward.archivedAt = null;
    ward.archivedBy = null;
  }

  addUserAction(
    req.user,
    archived ? "WARD_ARCHIVE" : "WARD_UNARCHIVE",
    `${archived ? "Arquivou" : "Reativou"} o setor ${ward.nome}`,
    { wardId: ward.id, wardNome: ward.nome, archived }
  );

  await persistState();
  res.json({ ward: wardSummaryForClient(ward) });
});

app.delete("/api/wards/:wardId", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res, { allowArchived: true });
  if (!ward) return;

  const occupiedBeds = (ward.beds || []).filter(isBedOccupiedByPatient);
  if (occupiedBeds.length) {
    return res.status(400).json({ error: "Não é possível excluir setor com pacientes internados" });
  }

  const activeShiftUser = users.find(user => user.activeShift && Number(user.activeShift.wardId) === Number(ward.id));
  if (activeShiftUser) {
    return res.status(400).json({ error: "Não é possível excluir setor com plantão aberto" });
  }

  const wardIndex = wards.findIndex(item => item.id === ward.id);
  if (wardIndex === -1) return res.status(404).json({ error: "Setor não encontrado" });

  const removedWard = wards.splice(wardIndex, 1)[0];
  addUserAction(req.user, "WARD_DELETE", `Excluiu o setor ${removedWard.nome}`, {
    wardId: removedWard.id,
    wardNome: removedWard.nome,
    removedBeds: Array.isArray(removedWard.beds) ? removedWard.beds.length : 0,
    removedEnfermarias: Array.isArray(removedWard.enfermarias) ? removedWard.enfermarias.length : 0
  });

  await persistState();
  res.json({ ok: true });
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

app.patch("/api/wards/:wardId/beds/:bedId/meta", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const bedId = parseInt(req.params.bedId, 10);
  const bed = ward.beds.find(item => item.id === bedId);
  if (!bed) return res.status(404).json({ error: "Leito não encontrado" });

  normalizeBedData(bed);
  const nextBedId = parseInt(req.body?.nextBedId, 10);
  const nextEnfermaria = String(req.body?.enfermaria || "").trim();
  if (!Number.isInteger(nextBedId) || nextBedId <= 0) {
    return res.status(400).json({ error: "Número do leito inválido" });
  }
  if (!nextEnfermaria) {
    return res.status(400).json({ error: "Selecione a enfermaria do leito" });
  }
  if (!ward.enfermarias?.includes(nextEnfermaria)) {
    return res.status(400).json({ error: "Enfermaria inválida" });
  }
  if ((bed.status === "OCUPADO" || String(bed.nome || "").trim()) && (nextBedId !== bed.id || nextEnfermaria !== bed.enfermaria)) {
    return res.status(400).json({ error: "Não é possível alterar número ou enfermaria de leito ocupado" });
  }
  const duplicate = ward.beds.find(item => item !== bed && item.id === nextBedId);
  if (duplicate) {
    return res.status(400).json({ error: "Já existe um leito com esse número no setor" });
  }

  const previousId = bed.id;
  const previousEnfermaria = bed.enfermaria || "";
  bed.id = nextBedId;
  bed.enfermaria = nextEnfermaria;
  ward.beds.sort((a, b) => a.id - b.id);

  addUserAction(req.user, "BED_META_UPDATE", `Alterou o leito ${previousId} do setor ${ward.nome}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    previousBedId: previousId,
    currentBedId: bed.id,
    previousEnfermaria,
    currentEnfermaria: bed.enfermaria || ""
  });

  await persistState();
  res.json({ ok: true, bed: bedForClient(bed), counts: computeCounts(ward.beds) });
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
  const note = String(req.body?.note || "").trim();
  const allowedTypes = ["ALTA", "OBITO", "EVASAO", "TRANSFERENCIA_EXTERNA"];
  if (!allowedTypes.includes(type)) return res.status(400).json({ error: "Tipo inválido" });
  if (type === "TRANSFERENCIA_EXTERNA" && !note) {
    return res.status(400).json({ error: "Informe a observação da transferência externa" });
  }
  if (type === "ALTA") ward.indicadores.altas = Math.max(0, (ward.indicadores.altas || 0) + 1);
  if (type === "OBITO") ward.indicadores.obitos = Math.max(0, (ward.indicadores.obitos || 0) + 1);
  const patientName = bed.nome || "";
  const outcomeReasonMap = {
    ALTA: "Desfecho da internação",
    OBITO: "Desfecho da internação",
    EVASAO: "Paciente evadiu da unidade",
    TRANSFERENCIA_EXTERNA: note
  };
  closePatientAdmissionByBedSnapshot(bed, ward, type, req.user.nome || req.user.username, outcomeReasonMap[type] || "Desfecho da internação");
  clearBedPatientData(bed, "LIVRE");
  const actionLabelMap = {
    ALTA: "Registrou alta",
    OBITO: "Registrou óbito",
    EVASAO: "Registrou evasão",
    TRANSFERENCIA_EXTERNA: "Registrou transferência externa"
  };
  addUserAction(req.user, type, `${actionLabelMap[type] || "Registrou desfecho"} no leito ${bed.id}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    bedId: bed.id,
    patient: patientName,
    note
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
  Object.assign(ensureWardTeam(ward), req.body || {});
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

if (require.main === module) {
  ensureStorageInitialized()
    .then(() => {
      const host = process.env.HOST || "0.0.0.0";
      app.listen(port, host, () => {
        console.log(`Server running at http://localhost:${port}`);
      });
    })
    .catch(error => {
      console.error(`Falha ao iniciar com Supabase: ${error.message}`);
      process.exit(1);
    });
} else if (isServerlessRuntime) {
  ensureStorageInitialized().catch(error => {
    console.error(`Falha ao iniciar com Supabase na Vercel: ${error.message}`);
  });
}

module.exports = app;
module.exports.default = app;
