const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const app = express();
const port = process.env.PORT || 3000;
const isServerlessRuntime = Boolean(process.env.VERCEL);
const isLocalStorageProvider = String(process.env.STORAGE_PROVIDER || "").trim().toLowerCase() === "local"
  && !isServerlessRuntime;

app.use(express.json());
app.use((req, res, next) => {
  const requestPath = String(req.path || "").toLowerCase();
  const shouldDisableCache = requestPath === "/"
    || requestPath.endsWith(".html")
    || requestPath.endsWith(".css")
    || requestPath.endsWith(".js");
  if (shouldDisableCache) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});
app.use(express.static(path.join(__dirname, "..", "public"), {
  etag: false,
  lastModified: false
}));

app.post("/__debug/event", (req, res) => {
  // #region debug-point A:browser-event-collector
  appendDebugEvent({
    hypothesisId: String(req.body?.hypothesisId || "A"),
    location: String(req.body?.location || "browser"),
    msg: String(req.body?.msg || "[DEBUG] Browser event"),
    data: req.body?.data || {}
  });
  // #endregion
  res.json({ ok: true });
});

const statuses = ["OCUPADO", "LIVRE", "BLOQUEADO", "RESERVADO", "EXTRA"];
const procedureOptions = ["SVD", "CVC", "SNE", "INTUBACAO", "SNG", "SANGUE", "ASPIRAÇÃO"];
const censusFieldNames = [
  "pacientes",
  "leitos",
  "altas",
  "obitos",
  "transferencias_externas",
  "transferencias_internas",
  "leitos_bloqueados",
  "admissoes",
  "svd_realizadas",
  "cvc_realizadas",
  "sne_realizadas",
  "sng_realizadas",
  "intubacoes_realizadas",
  "evasoes",
  "reinternacoes"
];
const NURSING_COORDINATOR_CPF = normalizeCpf(process.env.NURSING_COORDINATOR_CPF || "02170025367");
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
const supabaseTable = process.env.SUPABASE_TABLE || "app_state";
const supabaseStateId = process.env.SUPABASE_STATE_ID || "main";
const supabaseStateColumns = ["payload", "data"];
const sessionSecret = String(process.env.SESSION_SECRET || supabaseKey || "controle-de-leitos-session-secret").trim();
const debugOutDir = path.join(__dirname, "..", ".dbg");
const debugSessionId = "browser-runtime-slow";
const debugLogFile = path.join(debugOutDir, `trae-debug-log-${debugSessionId}.ndjson`);
const API_STATE_REFRESH_TTL_MS = 15000;
const HOSPITAL_TRIP_ORIGIN_CITY = "Açailândia";
const HOSPITAL_TRIP_ORIGIN_LABEL = "Hospital Municipal de Açailândia";
const HOSPITAL_TRIP_ORIGIN_COORDS = { lat: -4.9533, lon: -47.5054 };
const ROAD_DISTANCE_FACTOR = 1.22;
const PATIENT_TRAVEL_PROCEDURE = {
  code: "08.03.01.012-5",
  description: "UNIDADE DE REMUNERACAO PARA DESLOCAMENTO DE PACIENTE POR TRANSPORTE TERRESTRE (CADA 50 KM)"
};
const COMPANION_TRAVEL_PROCEDURE = {
  code: "08.03.01.010-9",
  description: "UNIDADE DE REMUNERACAO PARA DESLOCAMENTO DE ACOMPANHANTE POR TRANSPORTE TERRESTRE (CADA 50 KM DE DISTANCIA)"
};
let maranhaoCitiesCache = null;

let nextShiftId = 2;
let nextPatientId = 1;
const visitorRegistryEntries = [];
const psychologyManualRequests = [];
const psychologyAttendanceEntries = [];
const socialServiceManualRequests = [];
const socialServiceManualAttendanceEntries = [];
const hospitalTripEntries = [];
const users = [{
  id: 1,
  username: "admin",
  password: "admin",
  nome: "Administrador",
  cpf: "",
  birthDate: "",
  role: "admin",
  mustChangePassword: false,
  activeShift: null,
  shifts: [],
  actions: []
}];
const patientRegistry = [];
const nirDailyReports = [];
const censusDailyReports = [];
const shiftAuthorizationRequests = [];
const sessions = new Map();
const storageStatus = {
  provider: isLocalStorageProvider ? "local" : "supabase",
  configured: isLocalStorageProvider || Boolean(supabaseUrl && supabaseKey),
  synced: false,
  lastSyncAt: null,
  lastError: null,
  pendingLocalSync: false,
  localSnapshotAt: null
};
const localStateFiles = [
  path.join(__dirname, "..", "data", "app-state.local.pending-backup.json"),
  path.join(__dirname, "..", "data", "app-state.local.json")
];
let storageInitializationPromise = null;
let lastApiStateRefreshAt = 0;
let apiStateRefreshPromise = null;
let latestSupabaseStatePayload = null;

function appendDebugEvent(event = {}) {
  try {
    fs.mkdirSync(debugOutDir, { recursive: true });
    fs.appendFileSync(debugLogFile, `${JSON.stringify({
      sessionId: debugSessionId,
      runId: "pre-fix",
      ts: Date.now(),
      ...event
    })}\n`, "utf8");
  } catch {}
}

function trackStorageError(error) {
  storageStatus.provider = isLocalStorageProvider ? "local" : "supabase";
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
  const issuedAt = Date.now();
  const expiresAt = issuedAt + (1000 * 60 * 60 * 12);
  const payload = Buffer.from(JSON.stringify({ username, issuedAt, expiresAt }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const sid = `${payload}.${signature}`;
  sessions.set(sid, { username, createdAt: issuedAt, expiresAt });
  return sid;
}

function clearSessionsForUsername(username) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return;
  for (const [sid, session] of sessions.entries()) {
    if (String(session?.username || "").trim().toLowerCase() === normalized) {
      sessions.delete(sid);
    }
  }
}

function resolveSession(sid) {
  if (!sid) return null;

  const inMemory = sessions.get(sid);
  if (inMemory?.username) {
    if (inMemory.expiresAt && inMemory.expiresAt < Date.now()) {
      sessions.delete(sid);
      return null;
    }
    return inMemory;
  }

  const [payload, signature] = String(sid).split(".");
  if (!payload || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(Buffer.from(normalizedPayload, "base64").toString("utf8"));
    if (!parsed?.username) return null;
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;
    return {
      username: parsed.username,
      createdAt: parsed.issuedAt || Date.now(),
      expiresAt: parsed.expiresAt || null
    };
  } catch {
    return null;
  }
}

function createRecordId() {
  return crypto.randomBytes(10).toString("hex");
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function toRoundedKm(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 10) / 10);
}

function trimText(value) {
  return String(value || "").trim();
}

function normalizeCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function buildTravelPerson(person) {
  return {
    fullName: trimText(person?.fullName),
    address: trimText(person?.address),
    cpf: normalizeCpf(person?.cpf),
    birthDate: trimText(person?.birthDate),
    phone: normalizePhone(person?.phone),
    cep: normalizeCep(person?.cep)
  };
}

function hasTravelPersonData(person) {
  return Boolean(person?.fullName || person?.address || person?.cpf || person?.birthDate || person?.phone || person?.cep);
}

function calculateProcedureUnits(distanceKm) {
  const totalKm = toPositiveNumber(distanceKm) ?? 0;
  if (totalKm <= 0) return 0;
  return Math.ceil(totalKm / 50);
}

function buildTravelProcedure(procedure, units) {
  return {
    code: procedure.code,
    description: procedure.description,
    units: Number(units) || 0
  };
}

function haversineKm(from, to) {
  const earthRadiusKm = 6371;
  const toRad = degrees => (degrees * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

async function loadMaranhaoCities() {
  if (Array.isArray(maranhaoCitiesCache) && maranhaoCitiesCache.length) {
    return maranhaoCitiesCache;
  }

  const response = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados/21/municipios");
  if (!response.ok) {
    throw new Error("Nao foi possivel carregar as cidades do Maranhao");
  }

  const payload = await response.json();
  maranhaoCitiesCache = Array.isArray(payload)
    ? payload
      .map(item => String(item?.nome || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
    : [];

  return maranhaoCitiesCache;
}

async function geocodeMaranhaoCity(cityName) {
  const query = encodeURIComponent(`${cityName}, Maranhão, Brasil`);
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=1&q=${query}`, {
    headers: {
      "User-Agent": "controle-de-leitos/1.0"
    }
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel calcular a distancia da cidade");
  }

  const payload = await response.json();
  const match = Array.isArray(payload) ? payload[0] : null;
  const lat = Number(match?.lat);
  const lon = Number(match?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Cidade nao localizada para calcular a distancia");
  }

  return { lat, lon };
}

async function estimateHospitalTripDistance(destination) {
  const normalizedDestination = String(destination || "").trim();
  if (!normalizedDestination) {
    throw new Error("Informe a cidade de destino");
  }

  if (normalizedDestination.localeCompare(HOSPITAL_TRIP_ORIGIN_CITY, "pt-BR", { sensitivity: "base" }) === 0) {
    return {
      originCity: HOSPITAL_TRIP_ORIGIN_CITY,
      destination: normalizedDestination,
      oneWayKm: 0,
      roundTripKm: 0
    };
  }

  const destinationCoords = await geocodeMaranhaoCity(normalizedDestination);
  const airDistance = haversineKm(HOSPITAL_TRIP_ORIGIN_COORDS, destinationCoords);
  const oneWayKm = toRoundedKm(airDistance * ROAD_DISTANCE_FACTOR);
  const roundTripKm = toRoundedKm(oneWayKm * 2);

  return {
    originCity: HOSPITAL_TRIP_ORIGIN_CITY,
    destination: normalizedDestination,
    oneWayKm,
    roundTripKm
  };
}

function requireAuth(req, res, next) {
  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const cookies = parseCookies(req.headers.cookie);
  const sid = headerSid || cookies.sid;
  if (!sid) return res.status(401).json({ error: "Não autenticado" });
  const session = resolveSession(sid);
  if (!session) return res.status(401).json({ error: "Sessão inválida" });
  const user = users.find(item => item.username === session.username);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  selectUserActiveShiftFromRequest(user, req);
  req.session = session;
  req.user = user;
  const routePath = String(req.originalUrl || "").split("?")[0];
  if (
    user.mustChangePassword
    && !["/api/me", "/api/logout", "/api/me/password"].includes(routePath)
  ) {
    return res.status(403).json({
      error: "Altere sua senha provisória para continuar.",
      code: "PASSWORD_CHANGE_REQUIRED"
    });
  }
  next();
}

function getUserActiveShifts(user) {
  const shifts = Array.isArray(user?.activeShifts) ? [...user.activeShifts] : [];
  if (user?.activeShift && !shifts.some(shift => String(shift.id) === String(user.activeShift.id))) {
    shifts.push(user.activeShift);
  }
  return shifts.filter(shift => shift && !shift.closedAt);
}

function hasActiveServiceShift(user, serviceType) {
  const expectedServiceType = String(serviceType || "").trim().toUpperCase();
  return getUserActiveShifts(user).some(shift =>
    String(shift.serviceType || "").trim().toUpperCase() === expectedServiceType
  );
}

function selectUserActiveShiftFromRequest(user, req) {
  const requestedId = String(req.headers["x-active-shift-id"] || "").trim();
  if (requestedId === "none") {
    user.activeShift = null;
    return;
  }
  if (requestedId) {
    user.activeShift = getUserActiveShifts(user)
      .find(shift => String(shift.id) === requestedId) || null;
  } else if (user.activeShift?.closedAt) {
    user.activeShift = getUserActiveShifts(user).at(-1) || null;
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Apenas administradores podem acessar esta área" });
  }
  next();
}

function authorizeAdminPassword(req, res) {
  const adminPassword = String(req.body?.adminPassword || "");
  if (!adminPassword) {
    res.status(400).json({ error: "Digite a senha de um administrador para excluir a solicitação." });
    return null;
  }
  const authorizingAdmin = users.find(user =>
    user.role === "admin" && String(user.password || "") === adminPassword
  );
  if (!authorizingAdmin) {
    res.status(403).json({ error: "Senha do administrador inválida." });
    return null;
  }
  return authorizingAdmin;
}

function isNursingCoordinator(user) {
  return user?.role === "coordenador"
    || Boolean(NURSING_COORDINATOR_CPF && normalizeCpf(user?.cpf) === NURSING_COORDINATOR_CPF);
}

function requireNursingCoordinator(req, res, next) {
  if (!isNursingCoordinator(req.user)) {
    return res.status(403).json({ error: "Apenas o coordenador de enfermagem pode analisar estas solicitações." });
  }
  next();
}

function requireActiveShiftForMutation(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const routePath = String(req.originalUrl || "").split("?")[0];
  if (
    ["/api/login", "/api/logout", "/api/shifts/open", "/api/me/password", "/api/users"].includes(routePath)
    || /^\/api\/users\/\d+(?:\/password\/reset)?$/.test(routePath)
    || routePath === "/api/shifts/authorization-requests"
    || /^\/api\/shifts\/authorization-requests\/[^/]+\/decision$/.test(routePath)
    || /^\/api\/shifts\/\d+\/reopen-requests$/.test(routePath)
    || /^\/api\/shifts\/reopen-requests\/[^/]+\/decision$/.test(routePath)
    || /^\/api\/nir\/shift-reports\/[^/]+\/open$/.test(routePath)
  ) return next();

  const headerSid = String(req.headers["x-session-id"] || "").trim();
  const cookies = parseCookies(req.headers.cookie);
  const sid = headerSid || cookies.sid;
  const session = sid ? resolveSession(sid) : null;
  if (!session) return next();

  const user = users.find(item => item.username === session.username);
  if (!user) return next();

  selectUserActiveShiftFromRequest(user, req);
  req.session = session;
  req.user = user;
  if (!user.activeShift) {
    return res.status(403).json({ error: "Assuma um plantão antes de fazer qualquer alteração." });
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
    updatedAt: new Date().toISOString(),
    nextWardId,
    nextShiftId,
    nextPatientId,
    users,
    patientRegistry,
    visitorRegistryEntries,
    psychologyManualRequests,
    psychologyAttendanceEntries,
    socialServiceManualRequests,
    socialServiceManualAttendanceEntries,
    hospitalTripEntries,
    nirDailyReports,
    censusDailyReports,
    shiftAuthorizationRequests,
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

function normalizeSocialRecordStatus(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "Não necessário") return "Pendente";
  if (normalized === "Disponível") return "Concluído";
  return normalized;
}

function buildPatientSocialFormContact(payload = {}) {
  return {
    name: String(payload.name || "").trim(),
    kinship: String(payload.kinship || "").trim(),
    phone: String(payload.phone || "").trim(),
    address: String(payload.address || "").trim()
  };
}

function buildPatientSocialForm(payload = {}) {
  const familyContacts = (Array.isArray(payload.familyContacts) ? payload.familyContacts : [])
    .map(buildPatientSocialFormContact)
    .filter(contact => contact.name || contact.kinship || contact.phone || contact.address)
    .slice(0, 5);

  return {
    admissionDate: String(payload.admissionDate || "").trim(),
    admissionTime: String(payload.admissionTime || "").trim(),
    admissionSector: String(payload.admissionSector || "").trim(),
    bed: String(payload.bed || "").trim(),
    admissionReason: String(payload.admissionReason || "").trim(),
    fullName: String(payload.fullName || "").trim(),
    socialName: String(payload.socialName || "").trim(),
    affiliation: String(payload.affiliation || "").trim(),
    birthDate: String(payload.birthDate || "").trim(),
    ageLabel: String(payload.ageLabel || "").trim(),
    cns: String(payload.cns || "").trim(),
    cpf: String(payload.cpf || "").trim(),
    raceColor: String(payload.raceColor || "").trim(),
    sex: String(payload.sex || "").trim(),
    religion: String(payload.religion || "").trim(),
    birthplace: String(payload.birthplace || "").trim(),
    income: String(payload.income || "").trim(),
    occupation: String(payload.occupation || "").trim(),
    address: String(payload.address || "").trim(),
    hasDisability: String(payload.hasDisability || "").trim(),
    disabilityDescription: String(payload.disabilityDescription || "").trim(),
    familyContacts,
    maritalStatus: String(payload.maritalStatus || "").trim(),
    partnerName: String(payload.partnerName || "").trim(),
    educationLevel: String(payload.educationLevel || "").trim(),
    benefits: (Array.isArray(payload.benefits) ? payload.benefits : [])
      .map(item => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 12),
    benefitsOther: String(payload.benefitsOther || "").trim(),
    previdenciaBond: String(payload.previdenciaBond || "").trim(),
    previdenciaNature: String(payload.previdenciaNature || "").trim(),
    previdenciaSituation: String(payload.previdenciaSituation || "").trim(),
    companionName: String(payload.companionName || "").trim(),
    companionPhone: String(payload.companionPhone || "").trim(),
    companionKinship: String(payload.companionKinship || "").trim(),
    companionAddress: String(payload.companionAddress || "").trim(),
    profileTags: (Array.isArray(payload.profileTags) ? payload.profileTags : [])
      .map(item => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 12),
    funeralPlan: String(payload.funeralPlan || "").trim(),
    familyRelationship: String(payload.familyRelationship || "").trim(),
    familyRelationshipNotes: String(payload.familyRelationshipNotes || "").trim(),
    socialEvolution: String(payload.socialEvolution || "").trim(),
    filledAt: String(payload.filledAt || "").trim(),
    filledBy: String(payload.filledBy || "").trim(),
    updatedAt: String(payload.updatedAt || "").trim(),
    updatedBy: String(payload.updatedBy || "").trim()
  };
}

function hasPatientSocialFormData(payload = {}) {
  const form = buildPatientSocialForm(payload);
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

function buildPatientSocialSupport(payload = {}) {
  return {
    contacts: String(payload.contacts || "").trim(),
    admissionNotes: String(payload.admissionNotes || "").trim(),
    socialRecord: normalizeSocialRecordStatus(payload.socialRecord),
    observation: String(payload.observation || "").trim(),
    socialForm: buildPatientSocialForm(payload.socialForm),
    socialRecordUpdatedAt: String(payload.socialRecordUpdatedAt || "").trim(),
    socialRecordUpdatedBy: String(payload.socialRecordUpdatedBy || "").trim(),
    dischargePending: Boolean(payload.dischargePending),
    dischargeNote: String(payload.dischargeNote || "").trim(),
    dischargeAt: String(payload.dischargeAt || "").trim(),
    dischargeBy: String(payload.dischargeBy || "").trim(),
    updatedAt: String(payload.updatedAt || "").trim(),
    updatedBy: String(payload.updatedBy || "").trim()
  };
}

function socialServiceAttendanceEntryForClient(entry = {}) {
  const normalizedEntryType = String(entry.entryType || "baixa").trim();
  const normalizedEntryLabel = String(entry.entryLabel || "").trim()
    || (normalizedEntryType === "observacao_plantao"
      ? "Observação do plantão"
      : (normalizedEntryType === "atendimento_plantao"
        ? "Atendimento do plantão"
        : (normalizedEntryType === "acompanhamento" ? "Em acompanhamento" : "Baixa do atendimento")));
  return {
    id: entry.id || createRecordId(),
    patientId: Number(entry.patientId) || null,
    patientName: String(entry.patientName || "").trim(),
    patientBirthDate: String(entry.patientBirthDate || "").trim(),
    patientAgeLabel: String(entry.patientAgeLabel || entry.age || "").trim(),
    category: ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(entry.category || "").trim().toUpperCase())
      ? String(entry.category).trim().toUpperCase()
      : "",
    companionName: String(entry.companionName || "").trim(),
    companionBirthDate: String(entry.companionBirthDate || "").trim(),
    companionKinship: String(entry.companionKinship || "").trim(),
    wardId: Number(entry.wardId) || null,
    wardName: String(entry.wardName || "").trim(),
    bedId: Number(entry.bedId) || null,
    contacts: String(entry.contacts || "").trim(),
    admissionDate: String(entry.admissionDate || "").trim(),
    manualRequestId: String(entry.manualRequestId || "").trim(),
    socialRecord: normalizeSocialRecordStatus(entry.socialRecord || "Concluído"),
    observation: String(entry.observation || "").trim(),
    closedAt: String(entry.closedAt || entry.createdAt || "").trim(),
    closedBy: String(entry.closedBy || entry.createdBy || "").trim(),
    shiftId: Number(entry.shiftId) || null,
    shiftDate: String(entry.shiftDate || "").trim(),
    shiftLength: String(entry.shiftLength || "").trim(),
    shiftPeriod: String(entry.shiftPeriod || "").trim(),
    entryType: normalizedEntryType,
    entryLabel: normalizedEntryLabel
  };
}

function buildPatientSocialSupportHistory(items = []) {
  return (Array.isArray(items) ? items : []).map(socialServiceAttendanceEntryForClient);
}

function deleteSocialServiceAttendanceEntryById(entryId = "") {
  const normalizedEntryId = String(entryId || "").trim();
  if (!normalizedEntryId) return false;
  let removed = false;

  for (const patient of patientRegistry) {
    if (!Array.isArray(patient?.socialSupportHistory)) continue;
    const nextHistory = patient.socialSupportHistory.filter(item => String(item?.id || "").trim() !== normalizedEntryId);
    if (nextHistory.length !== patient.socialSupportHistory.length) {
      patient.socialSupportHistory = nextHistory;
      patient.updatedAt = new Date().toISOString();
      removed = true;
    }
  }

  for (const user of users) {
    for (const shift of Array.isArray(user?.shifts) ? user.shifts : []) {
      if (Array.isArray(shift.socialServiceAttendances)) {
        const nextAttendances = shift.socialServiceAttendances.filter(item => String(item?.id || "").trim() !== normalizedEntryId);
        if (nextAttendances.length !== shift.socialServiceAttendances.length) {
          shift.socialServiceAttendances = nextAttendances;
          removed = true;
        }
      }

      if (Array.isArray(shift.socialServiceSnapshot)) {
        const nextSnapshot = shift.socialServiceSnapshot.filter((item, index) => {
          const snapshotId = String(item?.socialHistoryId || `shift-${shift.id || "0"}-${index}`).trim();
          return snapshotId !== normalizedEntryId;
        });
        if (nextSnapshot.length !== shift.socialServiceSnapshot.length) {
          shift.socialServiceSnapshot = nextSnapshot;
          removed = true;
        }
      }
    }
  }

  const nextManualAttendances = socialServiceManualAttendanceEntries.filter(item => String(item?.id || "").trim() !== normalizedEntryId);
  if (nextManualAttendances.length !== socialServiceManualAttendanceEntries.length) {
    socialServiceManualAttendanceEntries.length = 0;
    socialServiceManualAttendanceEntries.push(...nextManualAttendances);
    removed = true;
  }

  return removed;
}

function buildSocialServiceShiftHistoryEntries(shift = {}, owner = {}) {
  const shiftServiceType = String(shift.serviceType || "").trim().toUpperCase();
  if (shiftServiceType !== "SERVICO_SOCIAL") return [];

  const ownerName = String(owner?.nome || shift.ownerName || shift.ownerUsername || "").trim();
  const shiftDate = String(shift.shiftDate || (shift.closedAt ? String(shift.closedAt).slice(0, 10) : "")).trim();
  const items = [];

  for (const rawEntry of Array.isArray(shift.socialServiceAttendances) ? shift.socialServiceAttendances : []) {
    const entry = socialServiceAttendanceEntryForClient({
      ...rawEntry,
      entryType: rawEntry?.entryType || "baixa",
      entryLabel: rawEntry?.entryLabel || "Baixa do atendimento"
    });
    if (entry.entryType !== "baixa") continue;
    items.push(entry);
  }

  const liveFollowUpKeys = new Set();
  for (const patient of patientRegistry) {
    for (const rawEntry of Array.isArray(patient?.socialSupportHistory) ? patient.socialSupportHistory : []) {
      if (rawEntry?.entryType === "acompanhamento" && Number(rawEntry.shiftId) === Number(shift.id)) {
        liveFollowUpKeys.add(`${String(rawEntry.patientName || "").trim()}|${Number(rawEntry.bedId) || ""}`);
      }
    }
  }

  for (const [index, snapshot] of (Array.isArray(shift.socialServiceSnapshot) ? shift.socialServiceSnapshot : []).entries()) {
    if (liveFollowUpKeys.has(`${String(snapshot?.patient || "").trim()}|${Number(snapshot?.bed) || ""}`)) continue;
    if (String(snapshot?.serviceStatus || "").trim().toUpperCase() === "EM ACOMPANHAMENTO") continue;
    const observation = String(snapshot?.observation || "").trim();
    const updatedAt = String(snapshot?.updatedAt || shift.closedAt || "").trim();
    const updatedBy = String(snapshot?.updatedBy || ownerName).trim();
    const category = ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(snapshot?.category || "").trim().toUpperCase())
      ? String(snapshot.category).trim().toUpperCase()
      : "";
    items.push(socialServiceAttendanceEntryForClient({
      id: snapshot?.socialHistoryId || `shift-${shift.id || "0"}-${index}`,
      patientName: snapshot?.patient || "",
      patientBirthDate: snapshot?.patientBirthDate || "",
      patientAgeLabel: snapshot?.age || "",
      category,
      wardName: snapshot?.sector || shift.wardNome || "",
      bedId: Number(snapshot?.bed) || null,
      contacts: snapshot?.contacts || "",
      admissionDate: snapshot?.admission || "",
      socialRecord: snapshot?.socialRecord || "Pendente",
      observation,
      closedAt: updatedAt,
      closedBy: updatedBy,
      shiftId: shift.id || null,
      shiftDate,
      shiftLength: shift.shiftLength || "",
      shiftPeriod: shift.shiftPeriod || "",
      entryType: "atendimento_plantao",
      entryLabel: category === "ACOMPANHANTE"
        ? "Atendimento ao acompanhante"
        : (category === "FAMILIAR"
          ? "Atendimento familiar"
          : (category === "OBITO" ? "Atendimento de óbito" : "Atendimento do plantão"))
    }));
  }

  return items;
}

function buildPatientPsychologySupport(payload = {}) {
  return {
    interventions: String(payload.interventions || "").trim(),
    observation: String(payload.observation || "").trim(),
    dischargePending: Boolean(payload.dischargePending),
    dischargeNote: String(payload.dischargeNote || "").trim(),
    dischargeAt: String(payload.dischargeAt || "").trim(),
    dischargeBy: String(payload.dischargeBy || "").trim(),
    updatedAt: String(payload.updatedAt || "").trim(),
    updatedBy: String(payload.updatedBy || "").trim()
  };
}

function psychologyAttendanceEntryForClient(entry) {
  return {
    id: entry.id || createRecordId(),
    shiftId: Number(entry.shiftId) || null,
    manualRequestId: String(entry.manualRequestId || "").trim(),
    patientId: Number(entry.patientId) || null,
    patientName: String(entry.patientName || "").trim(),
    patientBirthDate: String(entry.patientBirthDate || "").trim(),
    wardId: Number(entry.wardId) || null,
    wardName: String(entry.wardName || "").trim(),
    bedId: Number(entry.bedId) || null,
    status: String(entry.status || "").trim().toUpperCase(),
    interventions: String(entry.interventions || "").trim(),
    observation: String(entry.observation || "").trim(),
    createdAt: String(entry.createdAt || "").trim(),
    createdBy: String(entry.createdBy || "").trim()
  };
}

function getPsychologyAttendanceKey(entry = {}) {
  if (Number(entry.shiftId) && Number(entry.patientId)) {
    return `shift:${Number(entry.shiftId)}:patient:${Number(entry.patientId)}`;
  }
  if (Number(entry.shiftId) && entry.manualRequestId) {
    return `shift:${Number(entry.shiftId)}:manual:${String(entry.manualRequestId)}`;
  }
  return [
    Number(entry.patientId) || "",
    String(entry.createdAt || "").trim(),
    String(entry.createdBy || "").trim(),
    String(entry.status || "").trim().toUpperCase(),
    String(entry.interventions || "").trim(),
    String(entry.observation || "").trim()
  ].join("|");
}

function upsertPsychologyAttendanceEntry(entry, options = {}) {
  const normalized = psychologyAttendanceEntryForClient(entry);
  const key = getPsychologyAttendanceKey(normalized);
  const existingIndex = psychologyAttendanceEntries.findIndex(item =>
    getPsychologyAttendanceKey(item) === key
  );
  if (existingIndex >= 0) {
    const existing = psychologyAttendanceEntries[existingIndex];
    if (options.preserveDischarge && String(existing.status || "").toUpperCase() === "BAIXA") {
      return existing;
    }
    normalized.id = existing.id;
    psychologyAttendanceEntries[existingIndex] = normalized;
  } else {
    psychologyAttendanceEntries.unshift(normalized);
  }
  psychologyAttendanceEntries.splice(3000);
  return normalized;
}

function getUserActiveShiftOfType(user, serviceType) {
  return getUserActiveShifts(user).find(shift =>
    String(shift.serviceType || "").trim().toUpperCase() === serviceType
  ) || null;
}

function sameShiftOwner(shift = {}, name = "") {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!normalizedName) return false;
  return [shift.ownerName, shift.ownerUsername]
    .some(value => String(value || "").trim().toLowerCase() === normalizedName);
}

function getSocialManualClaim(entry, shiftId) {
  return (Array.isArray(entry?.claims) ? entry.claims : [])
    .find(claim => Number(claim?.shiftId) === Number(shiftId)) || null;
}

function getSocialPatientClaim(patient, shiftId) {
  return (Array.isArray(patient?.socialSupportHistory) ? patient.socialSupportHistory : [])
    .find(item => item?.entryType === "acompanhamento"
      && Number(item.shiftId) === Number(shiftId)
      && String(item.admissionDate || "") === String(patient.currentAdmission?.admittedAt || "")) || null;
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
        role: user.role === "user" ? "enfermeiro" : (user.role || "enfermeiro"),
        mustChangePassword: Boolean(user.mustChangePassword),
        activeShift: user.activeShift || null,
        activeShifts: Array.isArray(user.activeShifts)
          ? user.activeShifts
          : (user.activeShift ? [user.activeShift] : []),
        shifts: Array.isArray(user.shifts) ? user.shifts : [],
        actions: Array.isArray(user.actions) ? user.actions : []
      });
    }
  }
  shiftAuthorizationRequests.length = 0;
  if (Array.isArray(payload.shiftAuthorizationRequests)) {
    for (const request of payload.shiftAuthorizationRequests) {
      shiftAuthorizationRequests.push({
        id: String(request.id || createRecordId()),
        status: ["pending", "approved", "rejected", "used"].includes(String(request.status || ""))
          ? String(request.status)
          : "pending",
        requesterUsername: String(request.requesterUsername || ""),
        requesterName: String(request.requesterName || ""),
        wardId: Number(request.wardId),
        wardName: String(request.wardName || ""),
        shiftDate: String(request.shiftDate || ""),
        shiftLength: request.shiftLength === "24H" ? "24H" : "12H",
        shiftPeriod: ["DIA", "NOITE", "COMPLETO"].includes(String(request.shiftPeriod || ""))
          ? String(request.shiftPeriod)
          : "DIA",
        reason: String(request.reason || ""),
        requestedAt: String(request.requestedAt || ""),
        decidedAt: String(request.decidedAt || ""),
        decidedBy: String(request.decidedBy || ""),
        decisionNote: String(request.decisionNote || ""),
        usedAt: String(request.usedAt || ""),
        shiftId: request.shiftId || null
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
        phone: normalizePhone(patient.phone),
        diagnostico: patient.diagnostico || "",
        nir: patient.nir || "",
        cil: patient.cil || "",
        regulationChannels: Array.isArray(patient.regulationChannels) ? patient.regulationChannels : [],
        regulationAcceptedAt: patient.regulationAcceptedAt || "",
        nirLastUpdateAt: patient.nirLastUpdateAt || "",
        nirLastUpdateBy: patient.nirLastUpdateBy || "",
        nirUpdateChannels: Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : [],
        nirWorkflowStatus: patient.nirWorkflowStatus || "",
        nirAcceptedLocation: patient.nirAcceptedLocation || "",
        nirSpecialty: patient.nirSpecialty || "",
        nirActionReason: patient.nirActionReason || "",
        nirStatusUpdatedAt: patient.nirStatusUpdatedAt || "",
        nirStatusUpdatedBy: patient.nirStatusUpdatedBy || "",
        nirDischargePending: Boolean(patient.nirDischargePending),
        nirDischargeNote: patient.nirDischargeNote || "",
        nirDischargeAt: patient.nirDischargeAt || "",
        nirDischargeBy: patient.nirDischargeBy || "",
        nirHistory: Array.isArray(patient.nirHistory) ? patient.nirHistory : [],
        createdAt: patient.createdAt || new Date().toISOString(),
        updatedAt: patient.updatedAt || new Date().toISOString(),
        deletedAt: patient.deletedAt || null,
        currentAdmission: patient.currentAdmission || null,
        admissionHistory: Array.isArray(patient.admissionHistory) ? patient.admissionHistory : [],
        visitHistory: Array.isArray(patient.visitHistory) ? patient.visitHistory : [],
        socialSupportHistory: buildPatientSocialSupportHistory(patient.socialSupportHistory),
        socialSupport: buildPatientSocialSupport(patient.socialSupport),
        psychologySupport: buildPatientPsychologySupport(patient.psychologySupport)
      });
    }
  }
  visitorRegistryEntries.length = 0;
  if (Array.isArray(payload.visitorRegistryEntries)) {
    for (const entry of payload.visitorRegistryEntries) {
      visitorRegistryEntries.push({
        id: entry.id || createRecordId(),
        accessCode: String(entry.accessCode || "").trim(),
        visitorName: String(entry.visitorName || "").trim(),
        sectorOrReason: String(entry.sectorOrReason || "").trim(),
        createdAt: entry.createdAt || new Date().toISOString(),
        createdBy: entry.createdBy || ""
      });
    }
  }
  psychologyManualRequests.length = 0;
  if (Array.isArray(payload.psychologyManualRequests)) {
    for (const entry of payload.psychologyManualRequests) {
      psychologyManualRequests.push({
        id: entry.id || createRecordId(),
        patientName: String(entry.patientName || "").trim(),
        birthDate: String(entry.birthDate || "").trim(),
        sectorOrReason: String(entry.sectorOrReason || "").trim(),
        notes: String(entry.notes || "").trim(),
        contacts: String(entry.contacts || "").trim(),
        socialRecord: normalizeSocialRecordStatus(entry.socialRecord || "Pendente"),
        observation: String(entry.observation || "").trim(),
        interventions: String(entry.interventions || "").trim(),
        status: String(entry.status || "SOLICITADO").trim().toUpperCase(),
        createdAt: entry.createdAt || new Date().toISOString(),
        createdBy: entry.createdBy || "",
        updatedAt: entry.updatedAt || "",
        updatedBy: entry.updatedBy || "",
        closedAt: entry.closedAt || "",
        closedBy: entry.closedBy || ""
      });
    }
  }
  socialServiceManualRequests.length = 0;
  if (Array.isArray(payload.socialServiceManualRequests)) {
    for (const entry of payload.socialServiceManualRequests) {
      socialServiceManualRequests.push({
        id: entry.id || createRecordId(),
        category: ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(entry.category || "").trim().toUpperCase())
          ? String(entry.category).trim().toUpperCase()
          : "AVULSO",
        patientName: String(entry.patientName || "").trim(),
        birthDate: String(entry.birthDate || "").trim(),
        sectorOrReason: String(entry.sectorOrReason || "").trim(),
        notes: String(entry.notes || "").trim(),
        contacts: String(entry.contacts || "").trim(),
        socialRecord: normalizeSocialRecordStatus(entry.socialRecord || "Pendente"),
        socialForm: buildPatientSocialForm(entry.socialForm),
        observation: String(entry.observation || "").trim(),
        status: String(entry.status || "SOLICITADO").trim().toUpperCase(),
        claims: (Array.isArray(entry.claims) ? entry.claims : []).map(claim => ({
          shiftId: Number(claim?.shiftId) || null,
          by: String(claim?.by || "").trim(),
          at: String(claim?.at || "").trim(),
          observation: String(claim?.observation || "").trim(),
          contacts: String(claim?.contacts || "").trim()
        })).filter(claim => claim.shiftId),
        createdAt: entry.createdAt || new Date().toISOString(),
        createdBy: entry.createdBy || "",
        updatedAt: entry.updatedAt || "",
        updatedBy: entry.updatedBy || "",
        closedAt: entry.closedAt || "",
        closedBy: entry.closedBy || ""
      });
    }
  }
  psychologyAttendanceEntries.length = 0;
  if (Array.isArray(payload.psychologyAttendanceEntries)) {
    for (const entry of payload.psychologyAttendanceEntries) {
      psychologyAttendanceEntries.push(psychologyAttendanceEntryForClient(entry));
    }
  }
  socialServiceManualAttendanceEntries.length = 0;
  if (Array.isArray(payload.socialServiceManualAttendanceEntries)) {
    for (const entry of payload.socialServiceManualAttendanceEntries) {
      socialServiceManualAttendanceEntries.push(socialServiceAttendanceEntryForClient(entry));
    }
  }
  hospitalTripEntries.length = 0;
  if (Array.isArray(payload.hospitalTripEntries)) {
    for (const entry of payload.hospitalTripEntries) {
      const patient = buildTravelPerson(entry.patient);
      const companion = buildTravelPerson(entry.companion);
      const estimatedRoundTripKm = toPositiveNumber(entry.estimatedRoundTripKm);
      const patientUnits = entry.patientProcedure?.units ?? calculateProcedureUnits(estimatedRoundTripKm);
      const companionUnits = hasTravelPersonData(companion)
        ? (entry.companionProcedure?.units ?? calculateProcedureUnits(estimatedRoundTripKm))
        : 0;
      hospitalTripEntries.push({
        id: entry.id || createRecordId(),
        origin: String(entry.origin || "").trim(),
        destination: String(entry.destination || "").trim(),
        kmStart: Number(entry.kmStart) || 0,
        kmEnd: Number(entry.kmEnd) || 0,
        estimatedOneWayKm: toPositiveNumber(entry.estimatedOneWayKm),
        estimatedRoundTripKm,
        patient,
        companion,
        patientProcedure: buildTravelProcedure(PATIENT_TRAVEL_PROCEDURE, patientUnits),
        companionProcedure: buildTravelProcedure(COMPANION_TRAVEL_PROCEDURE, companionUnits),
        createdAt: entry.createdAt || new Date().toISOString(),
        createdBy: entry.createdBy || ""
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
  censusDailyReports.length = 0;
  if (Array.isArray(payload.censusDailyReports)) {
    for (const report of payload.censusDailyReports) {
      const values = {};
      for (const field of censusFieldNames) {
        const value = Number(report.values?.[field]);
        values[field] = Number.isInteger(value) && value >= 0 ? value : 0;
      }
      censusDailyReports.push({
        id: report.id || createRecordId(),
        wardId: Number(report.wardId),
        wardName: String(report.wardName || ""),
        periodStartDate: String(report.periodStartDate || ""),
        periodEndDate: String(report.periodEndDate || ""),
        authorUsername: String(report.authorUsername || ""),
        authorName: String(report.authorName || ""),
        shiftId: report.shiftId || null,
        values,
        createdAt: report.createdAt || new Date().toISOString(),
        submittedAt: report.submittedAt || new Date().toISOString(),
        automated: Boolean(report.automated),
        sentAt: String(report.sentAt || ""),
        sentBy: String(report.sentBy || "")
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
  reconcileDuplicateOccupiedBeds();
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

function getStatePayloadTimestamp(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const sourceValue = payload.updatedAt || payload.savedAt || payload.lastSyncAt || "";
  const timestamp = Date.parse(String(sourceValue));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function readLocalStateFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload : parsed;
    if (!payload || !Array.isArray(payload.wards)) return null;
    return payload;
  } catch {
    return null;
  }
}

function findNewestLocalStatePayload() {
  let newest = null;

  for (const filePath of localStateFiles) {
    const candidate = readLocalStateFile(filePath);
    if (!candidate) continue;
    if (!newest || getStatePayloadTimestamp(candidate) > getStatePayloadTimestamp(newest)) {
      newest = candidate;
    }
  }

  return newest;
}

function applyLocalStateAsRecovery() {
  const localPayload = findNewestLocalStatePayload();
  if (!localPayload) return false;

  const localTimestamp = getStatePayloadTimestamp(localPayload);

  const applied = applyStatePayload(localPayload);
  storageStatus.provider = "supabase";
  storageStatus.synced = applied;
  storageStatus.lastSyncAt = new Date().toISOString();
  storageStatus.lastError = null;
  storageStatus.pendingLocalSync = false;
  storageStatus.localSnapshotAt = new Date(localTimestamp).toISOString();
  return applied;
}

function saveStateToLocal() {
  const stateFile = localStateFiles[1];
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(buildStatePayload(), null, 2), "utf8");
  fs.renameSync(tempFile, stateFile);
  storageStatus.provider = "local";
  storageStatus.configured = true;
  storageStatus.synced = true;
  storageStatus.lastSyncAt = new Date().toISOString();
  storageStatus.lastError = null;
  storageStatus.pendingLocalSync = false;
  return true;
}

function loadStateFromLocal() {
  const localPayload = readLocalStateFile(localStateFiles[1]);
  if (!localPayload) {
    throw new Error(`Banco local não encontrado ou inválido: ${localStateFiles[1]}`);
  }
  const applied = applyStatePayload(localPayload);
  storageStatus.provider = "local";
  storageStatus.configured = true;
  storageStatus.synced = applied;
  storageStatus.lastSyncAt = new Date().toISOString();
  storageStatus.lastError = null;
  storageStatus.pendingLocalSync = false;
  storageStatus.localSnapshotAt = new Date(getStatePayloadTimestamp(localPayload)).toISOString();
  return applied;
}

async function loadStateFromSupabase() {
  if (!hasSupabaseConfig()) return false;
  latestSupabaseStatePayload = null;
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

    latestSupabaseStatePayload = rows[0][column];
    const applied = applyStatePayload(latestSupabaseStatePayload);
    storageStatus.provider = "supabase";
    storageStatus.synced = applied;
    storageStatus.lastSyncAt = new Date().toISOString();
    storageStatus.lastError = null;
    return applied;
  }

  throw lastError || new Error("Falha ao carregar do Supabase");
}

async function persistState() {
  refreshAutomaticCensusReports();
  if (isLocalStorageProvider) {
    return saveStateToLocal();
  }

  try {
    ensureSupabaseConfigured();
    const saved = await saveStateToSupabase();
    return saved;
  } catch (error) {
    trackStorageError(error);
    throw error;
  }
}

async function initializeStorage() {
  if (isLocalStorageProvider) {
    return loadStateFromLocal();
  }

  try {
    ensureSupabaseConfigured();
    const loaded = await loadStateFromSupabase();
    if (!loaded && applyLocalStateAsRecovery()) {
      await saveStateToSupabase();
      return true;
    }
    if (!loaded) {
      await saveStateToSupabase();
    }
    return loaded;
  } catch (error) {
    trackStorageError(error);
    throw error;
  }
}

async function refreshStateFromSupabase() {
  try {
    ensureSupabaseConfigured();
    const loaded = await loadStateFromSupabase();
    if (!loaded && applyLocalStateAsRecovery()) {
      await saveStateToSupabase();
      return true;
    }
    if (!loaded) {
      await saveStateToSupabase();
    }
    return loaded;
  } catch (error) {
    trackStorageError(error);
    throw error;
  }
}

async function refreshStateFromSupabaseThrottled() {
  const now = Date.now();
  if ((now - lastApiStateRefreshAt) < API_STATE_REFRESH_TTL_MS) {
    return false;
  }
  if (apiStateRefreshPromise) {
    return apiStateRefreshPromise;
  }

  apiStateRefreshPromise = (async () => {
    try {
      return await refreshStateFromSupabase();
    } finally {
      lastApiStateRefreshAt = Date.now();
      apiStateRefreshPromise = null;
    }
  })();

  return apiStateRefreshPromise;
}

app.use("/api", async (req, res, next) => {
  const startedAt = Date.now();
  // #region debug-point B:api-sync-start
  appendDebugEvent({
    hypothesisId: "B",
    location: "src/server.js:/api-middleware:start",
    msg: "[DEBUG] API middleware start",
    data: { method: req.method, path: req.path }
  });
  // #endregion
  try {
    await ensureStorageInitialized();
    if (!isLocalStorageProvider) {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        await refreshStateFromSupabaseThrottled();
      } else {
        await refreshStateFromSupabase();
      }
    }
    // #region debug-point B:api-sync-success
    appendDebugEvent({
      hypothesisId: "B",
      location: "src/server.js:/api-middleware:success",
      msg: "[DEBUG] API middleware success",
      data: { method: req.method, path: req.path, durationMs: Date.now() - startedAt }
    });
    // #endregion
    next();
  } catch (error) {
    // #region debug-point B:api-sync-error
    appendDebugEvent({
      hypothesisId: "B",
      location: "src/server.js:/api-middleware:error",
      msg: "[DEBUG] API middleware error",
      data: { method: req.method, path: req.path, durationMs: Date.now() - startedAt, error: error.message }
    });
    // #endregion
    res.status(503).json({ error: "Falha na sincronização com o Supabase", detail: error.message });
  }
});

app.use("/api", requireActiveShiftForMutation);

function isWardArchived(ward) {
  return Boolean(ward?.archivedAt);
}

function wardSummaryForClient(ward) {
  const activeShiftOwners = users.flatMap(user =>
    getUserActiveShifts(user)
      .filter(shift => !String(shift.serviceType || "").trim() && Number(shift.wardId) === Number(ward.id))
      .map(shift => ({ user, shift }))
  );
  const activeShiftOwner = activeShiftOwners[0];
  const activeShift = activeShiftOwner?.shift;
  return {
    id: ward.id,
    nome: ward.nome,
    enfermarias: ward.enfermarias || [],
    archived: isWardArchived(ward),
    archivedAt: ward.archivedAt || null,
    bedsCount: Array.isArray(ward.beds) ? ward.beds.length : 0,
    enfermariasCount: Array.isArray(ward.enfermarias) ? ward.enfermarias.length : 0,
    activeShift: activeShift ? {
      ownerName: activeShift.ownerName || activeShiftOwner.user.nome || activeShiftOwner.user.username || "",
      ownerNames: activeShiftOwners.map(({ user: owner, shift }) =>
        shift.ownerName || owner.nome || owner.username || ""
      ).filter(Boolean),
      openedAt: activeShift.openedAt || "",
      shiftDate: activeShift.shiftDate || "",
      shiftLength: activeShift.shiftLength || ""
    } : null
  };
}

function findActiveShiftOwnerForDay(wardId, shiftDate = getCurrentIsoDate(), serviceType = "") {
  const normalizedServiceType = String(serviceType || "").trim().toUpperCase();
  const isStandaloneService = ["NIR", "PSICOLOGIA", "SERVICO_SOCIAL"].includes(normalizedServiceType);
  for (const user of users) {
    const shift = getUserActiveShifts(user).find(activeShift =>
      String(activeShift.serviceType || "").trim().toUpperCase() === normalizedServiceType
      && (isStandaloneService || Number(activeShift.wardId) === Number(wardId))
      && String(activeShift.shiftDate || "") === String(shiftDate || "")
    );
    if (shift) return { ...user, activeShift: shift };
  }
  return null;
}

function getServiceShiftLabel(serviceType = "") {
  const normalized = String(serviceType || "").trim().toUpperCase();
  if (normalized === "NIR") return "NIR";
  if (normalized === "PSICOLOGIA") return "Psicologia";
  if (normalized === "SERVICO_SOCIAL") return "Serviço Social";
  return "";
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
    for (const shift of getUserActiveShifts(user)) {
      if (Number(shift.wardId) === Number(wardId)) shift.wardNome = nextWardName;
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

function isBedOccupiedByPatient(bed) {
  return String(bed?.status || "").toUpperCase() === "OCUPADO" && Boolean(String(bed?.nome || "").trim());
}

function getPatientIdentityKey(identity = {}) {
  const cpf = normalizeCpf(identity?.cpf);
  if (cpf) return `cpf:${cpf}`;
  const nome = normalizePersonName(identity?.nome);
  if (!nome) return "";
  return `name:${nome}|birth:${String(identity?.birthDate || "").trim()}`;
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

function findOtherOccupiedBedByIdentity(identity = {}, excludeWardId = null, excludeBedId = null) {
  const identityKey = getPatientIdentityKey(identity);
  if (!identityKey) return null;
  for (const ward of wards) {
    for (const bed of ward.beds || []) {
      normalizeBedData(bed);
      if (!isBedOccupiedByPatient(bed)) continue;
      if (Number(ward.id) === Number(excludeWardId) && Number(bed.id) === Number(excludeBedId)) continue;
      if (getPatientIdentityKey(bed) !== identityKey) continue;
      return { ward, bed };
    }
  }
  return null;
}

function chooseCanonicalOccupiedBed(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const patient = findPatientRegistryEntry(entries[0]?.bed || {});
  if (patient?.currentAdmission) {
    const matched = entries.find(entry =>
      Number(entry?.ward?.id) === Number(patient.currentAdmission?.wardId)
      && Number(entry?.bed?.id) === Number(patient.currentAdmission?.bedId)
    );
    if (matched) return matched;
  }
  return [...entries].sort((a, b) => {
    const admissionA = Date.parse(String(a?.bed?.admissao || ""));
    const admissionB = Date.parse(String(b?.bed?.admissao || ""));
    return (Number.isFinite(admissionB) ? admissionB : 0) - (Number.isFinite(admissionA) ? admissionA : 0);
  })[0];
}

function reconcileDuplicateOccupiedBeds() {
  const groups = new Map();
  for (const ward of wards) {
    for (const bed of ward.beds || []) {
      normalizeBedData(bed);
      if (!isBedOccupiedByPatient(bed)) continue;
      const identityKey = getPatientIdentityKey(bed);
      if (!identityKey) continue;
      if (!groups.has(identityKey)) groups.set(identityKey, []);
      groups.get(identityKey).push({ ward, bed });
    }
  }

  let changed = false;
  for (const entries of groups.values()) {
    if (entries.length <= 1) continue;
    const canonical = chooseCanonicalOccupiedBed(entries);
    if (!canonical) continue;
    const patient = ensurePatientRecordFromBed(canonical.bed);
    ensurePatientAdmissionRecord(patient, canonical.ward, canonical.bed, "Sistema");
    for (const entry of entries) {
      if (entry === canonical) continue;
      clearBedPatientData(entry.bed, "LIVRE");
      changed = true;
    }
  }
  return changed;
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
    phone: normalizePhone(bed.phone),
    diagnostico: bed.diagnostico || "",
    nir: bed.nir || "",
    cil: bed.cil || "",
    regulationChannels: [],
    regulationAcceptedAt: "",
    nirLastUpdateAt: "",
    nirLastUpdateBy: "",
    nirUpdateChannels: [],
    nirWorkflowStatus: "",
    nirAcceptedLocation: "",
    nirSpecialty: "",
    nirActionReason: "",
    nirStatusUpdatedAt: "",
    nirStatusUpdatedBy: "",
    nirDischargePending: false,
    nirDischargeNote: "",
    nirDischargeAt: "",
    nirDischargeBy: "",
    nirHistory: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    currentAdmission: null,
    admissionHistory: [],
    visitHistory: [],
    socialSupportHistory: [],
    socialSupport: buildPatientSocialSupport(),
    psychologySupport: buildPatientPsychologySupport()
  };
}

function createEmptyPatientRecord(payload = {}) {
  const now = new Date().toISOString();
  return {
    id: nextPatientId++,
    nome: String(payload.nome || "").trim(),
    cpf: normalizeCpf(payload.cpf),
    birthDate: String(payload.birthDate || "").trim(),
    phone: normalizePhone(payload.phone),
    diagnostico: String(payload.diagnostico || "").trim(),
    nir: String(payload.nir || "").trim(),
    cil: String(payload.cil || "").trim(),
    regulationChannels: Array.isArray(payload.regulationChannels) ? payload.regulationChannels : [],
    regulationAcceptedAt: String(payload.regulationAcceptedAt || "").trim(),
    nirLastUpdateAt: String(payload.nirLastUpdateAt || "").trim(),
    nirLastUpdateBy: String(payload.nirLastUpdateBy || "").trim(),
    nirUpdateChannels: Array.isArray(payload.nirUpdateChannels) ? payload.nirUpdateChannels : [],
    nirWorkflowStatus: String(payload.nirWorkflowStatus || "").trim(),
    nirAcceptedLocation: String(payload.nirAcceptedLocation || "").trim(),
    nirSpecialty: String(payload.nirSpecialty || "").trim(),
    nirActionReason: String(payload.nirActionReason || "").trim(),
    nirStatusUpdatedAt: String(payload.nirStatusUpdatedAt || "").trim(),
    nirStatusUpdatedBy: String(payload.nirStatusUpdatedBy || "").trim(),
    nirDischargePending: Boolean(payload.nirDischargePending),
    nirDischargeNote: String(payload.nirDischargeNote || "").trim(),
    nirDischargeAt: String(payload.nirDischargeAt || "").trim(),
    nirDischargeBy: String(payload.nirDischargeBy || "").trim(),
    nirHistory: Array.isArray(payload.nirHistory) ? payload.nirHistory : [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    currentAdmission: null,
    admissionHistory: [],
    visitHistory: [],
    socialSupportHistory: buildPatientSocialSupportHistory(payload.socialSupportHistory),
    socialSupport: buildPatientSocialSupport(payload.socialSupport),
    psychologySupport: buildPatientPsychologySupport(payload.psychologySupport)
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
  patient.phone = normalizePhone(patient.phone);
  patient.diagnostico = bed.diagnostico || "";
  patient.nir = bed.nir || "";
  patient.cil = bed.cil || "";
  patient.deletedAt = null;
  patient.socialSupportHistory = buildPatientSocialSupportHistory(patient.socialSupportHistory);
  patient.socialSupport = buildPatientSocialSupport(patient.socialSupport);
  patient.psychologySupport = buildPatientPsychologySupport(patient.psychologySupport);
  patient.updatedAt = new Date().toISOString();
  return patient;
}

function createAdmissionRecord(ward, bed, actor) {
  const recordedAt = new Date().toISOString();
  return {
    id: createRecordId(),
    wardId: ward.id,
    wardNome: ward.nome || "",
    bedId: bed.id,
    enfermaria: bed.enfermaria || "",
    admittedAt: bed.admissao || getCurrentIsoDate(),
    admissionEventAt: recordedAt,
    dischargedAt: null,
    outcome: null,
    updatedAt: recordedAt,
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
  const dischargeAt = new Date().toISOString();
  patient.currentAdmission.dischargedAt = dischargeAt;
  patient.currentAdmission.outcome = outcome || "ENCERRADA";
  patient.currentAdmission.updatedAt = dischargeAt;
  patient.currentAdmission.updatedBy = actor;
  if (reason) patient.currentAdmission.closeReason = reason;
  const dischargeNote = `${ward?.nome || patient.currentAdmission.wardNome || "Setor"} deu ${String(outcome || "alta").toLowerCase()} em ${new Date(dischargeAt).toLocaleString("pt-BR")}. Finalize o acompanhamento no módulo responsável.`;
  if (String(patient.nirWorkflowStatus || "").trim().toUpperCase() === "EM_ACOMPANHAMENTO" || patient.regulationAcceptedAt) {
    patient.nirDischargePending = true;
    patient.nirDischargeAt = dischargeAt;
    patient.nirDischargeBy = actor;
    patient.nirDischargeNote = dischargeNote;
  }
  if (patient.socialSupport?.updatedAt || patient.socialSupport?.observation || patient.socialSupport?.socialRecord === "Concluído") {
    patient.socialSupport = buildPatientSocialSupport({
      ...patient.socialSupport,
      dischargePending: true,
      dischargeNote,
      dischargeAt,
      dischargeBy: actor
    });
  }
  if (patient.psychologySupport?.updatedAt || patient.psychologySupport?.observation || patient.psychologySupport?.interventions) {
    patient.psychologySupport = buildPatientPsychologySupport({
      ...patient.psychologySupport,
      dischargePending: true,
      dischargeNote,
      dischargeAt,
      dischargeBy: actor
    });
  }
  patient.currentAdmission = null;
  patient.updatedAt = dischargeAt;
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
  let currentAdmission = patient.currentAdmission ? {
    ...patient.currentAdmission,
    active: true
  } : null;
  if (currentAdmission) {
    const ward = wards.find(item => Number(item.id) === Number(currentAdmission.wardId));
    const bed = ward?.beds?.find(item => Number(item.id) === Number(currentAdmission.bedId));
    if (bed) {
      normalizeBedData(bed);
      currentAdmission = {
        ...currentAdmission,
        nirRequest: buildBedRequestState(bed.nirRequest),
        serviceSocialRequest: buildBedRequestState(bed.serviceSocialRequest),
        psychologyRequest: buildBedRequestState(bed.psychologyRequest)
      };
    } else {
      currentAdmission = {
        ...currentAdmission,
        nirRequest: buildBedRequestState(currentAdmission.nirRequest),
        serviceSocialRequest: buildBedRequestState(currentAdmission.serviceSocialRequest),
        psychologyRequest: buildBedRequestState(currentAdmission.psychologyRequest)
      };
    }
  }
  const lastAdmission = patient.currentAdmission || (Array.isArray(patient.admissionHistory) ? patient.admissionHistory[0] : null) || null;
  return {
    id: patient.id,
    nome: patient.nome || "",
    cpf: patient.cpf || "",
    birthDate: patient.birthDate || "",
    phone: patient.phone || "",
    diagnostico: patient.diagnostico || "",
    nir: patient.nir || "",
    cil: patient.cil || "",
    regulationChannels: Array.isArray(patient.regulationChannels) ? patient.regulationChannels : [],
    regulationAcceptedAt: patient.regulationAcceptedAt || "",
    nirLastUpdateAt: patient.nirLastUpdateAt || "",
    nirLastUpdateBy: patient.nirLastUpdateBy || "",
    nirUpdateChannels: Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : [],
    nirWorkflowStatus: patient.nirWorkflowStatus || "",
    nirAcceptedLocation: patient.nirAcceptedLocation || "",
    nirSpecialty: patient.nirSpecialty || "",
    nirActionReason: patient.nirActionReason || "",
    nirStatusUpdatedAt: patient.nirStatusUpdatedAt || "",
    nirStatusUpdatedBy: patient.nirStatusUpdatedBy || "",
    nirDischargePending: Boolean(patient.nirDischargePending),
    nirDischargeNote: patient.nirDischargeNote || "",
    nirDischargeAt: patient.nirDischargeAt || "",
    nirDischargeBy: patient.nirDischargeBy || "",
    nirHistory: Array.isArray(patient.nirHistory) ? patient.nirHistory : [],
    createdAt: patient.createdAt || "",
    updatedAt: patient.updatedAt || "",
    active: Boolean(patient.currentAdmission),
    currentAdmission,
    admissionCount: Array.isArray(patient.admissionHistory) ? patient.admissionHistory.length : 0,
    lastAdmission,
    visitHistory: Array.isArray(patient.visitHistory) ? patient.visitHistory : [],
    socialSupportHistory: buildPatientSocialSupportHistory(patient.socialSupportHistory),
    socialSupport: buildPatientSocialSupport(patient.socialSupport),
    psychologySupport: buildPatientPsychologySupport(patient.psychologySupport)
  };
}

function visitorRegistryEntryForClient(entry) {
  return {
    id: entry.id,
    category: ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(entry.category || "").trim().toUpperCase())
      ? String(entry.category).trim().toUpperCase()
      : "",
    accessCode: String(entry.accessCode || "").trim(),
    visitorName: String(entry.visitorName || "").trim(),
    sectorOrReason: String(entry.sectorOrReason || "").trim(),
    createdAt: entry.createdAt || "",
    createdBy: entry.createdBy || ""
  };
}

function psychologyManualRequestForClient(entry) {
  return {
    id: entry.id,
    patientName: String(entry.patientName || "").trim(),
    birthDate: String(entry.birthDate || "").trim(),
    sectorOrReason: String(entry.sectorOrReason || "").trim(),
    notes: String(entry.notes || "").trim(),
    contacts: String(entry.contacts || "").trim(),
    socialRecord: normalizeSocialRecordStatus(entry.socialRecord || "Pendente"),
    observation: String(entry.observation || "").trim(),
    interventions: String(entry.interventions || "").trim(),
    status: String(entry.status || "SOLICITADO").trim().toUpperCase(),
    createdAt: entry.createdAt || "",
    createdBy: entry.createdBy || "",
    updatedAt: entry.updatedAt || "",
    updatedBy: entry.updatedBy || "",
    closedAt: entry.closedAt || "",
    closedBy: entry.closedBy || ""
  };
}

function socialServiceManualRequestForClient(entry) {
  return {
    id: entry.id,
    category: ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(entry.category || "").trim().toUpperCase())
      ? String(entry.category).trim().toUpperCase()
      : "AVULSO",
    patientName: String(entry.patientName || "").trim(),
    birthDate: String(entry.birthDate || "").trim(),
    sectorOrReason: String(entry.sectorOrReason || "").trim(),
    notes: String(entry.notes || "").trim(),
    contacts: String(entry.contacts || "").trim(),
    socialRecord: normalizeSocialRecordStatus(entry.socialRecord || "Pendente"),
    socialForm: buildPatientSocialForm(entry.socialForm),
    observation: String(entry.observation || "").trim(),
    status: String(entry.status || "SOLICITADO").trim().toUpperCase(),
    createdAt: entry.createdAt || "",
    createdBy: entry.createdBy || "",
    updatedAt: entry.updatedAt || "",
    updatedBy: entry.updatedBy || "",
    closedAt: entry.closedAt || "",
    closedBy: entry.closedBy || ""
  };
}

function hospitalTripEntryForClient(entry) {
  const kmStart = Number(entry.kmStart) || 0;
  const kmEnd = Number(entry.kmEnd) || 0;
  const estimatedRoundTripKm = toPositiveNumber(entry.estimatedRoundTripKm);
  const distance = kmEnd > kmStart ? Math.max(0, kmEnd - kmStart) : (estimatedRoundTripKm ?? 0);
  const patient = buildTravelPerson(entry.patient);
  const companion = buildTravelPerson(entry.companion);
  return {
    id: entry.id,
    origin: String(entry.origin || "").trim(),
    destination: String(entry.destination || "").trim(),
    kmStart,
    kmEnd,
    distance,
    estimatedOneWayKm: toPositiveNumber(entry.estimatedOneWayKm) ?? null,
    estimatedRoundTripKm,
    patient,
    companion,
    patientProcedure: buildTravelProcedure(PATIENT_TRAVEL_PROCEDURE, entry.patientProcedure?.units ?? calculateProcedureUnits(distance)),
    companionProcedure: buildTravelProcedure(
      COMPANION_TRAVEL_PROCEDURE,
      hasTravelPersonData(companion) ? (entry.companionProcedure?.units ?? calculateProcedureUnits(distance)) : 0
    ),
    createdAt: entry.createdAt || "",
    createdBy: entry.createdBy || ""
  };
}

function getNextUserId() {
  return users.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0) + 1;
}

function sanitizeShiftHistoryEntry(shift, owner) {
  return {
    id: shift.id,
    shiftDate: shift.shiftDate || (shift.openedAt ? String(shift.openedAt).slice(0, 10) : ""),
    serviceType: shift.serviceType || "",
    wardId: shift.wardId,
    wardNome: shift.wardNome || "",
    ownerUsername: owner.username || "",
    ownerName: owner.nome || owner.username || "",
    shiftLength: shift.shiftLength || "12H",
    shiftPeriod: shift.shiftPeriod || "DIA",
    openedAt: shift.openedAt || null,
    closedAt: shift.closedAt || null,
    team: shift.team || null,
    teamUpdatedAt: shift.teamUpdatedAt || "",
    teamUpdatedBy: shift.teamUpdatedBy || "",
    reopenRequests: (Array.isArray(shift.reopenRequests) ? shift.reopenRequests : []).map(request => ({
      id: request.id,
      reason: request.reason || "",
      status: request.status || "pending",
      requestedAt: request.requestedAt || "",
      decidedAt: request.decidedAt || "",
      decidedBy: request.decidedBy || "",
      decisionNote: request.decisionNote || ""
    }))
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    nome: user.nome,
    cpf: user.cpf || "",
    birthDate: user.birthDate || "",
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    activeShift: user.activeShift || null,
    activeShifts: getUserActiveShifts(user),
    canApproveShiftAuthorizations: isNursingCoordinator(user),
    shiftAuthorizationRequests: shiftAuthorizationRequests
      .filter(request => request.requesterUsername === user.username)
      .slice(-20)
      .map(request => ({
        id: request.id,
        wardId: request.wardId,
        wardName: request.wardName,
        shiftDate: request.shiftDate,
        status: request.status,
        reason: request.reason,
        requestedAt: request.requestedAt,
        decidedAt: request.decidedAt,
        decidedBy: request.decidedBy,
        decisionNote: request.decisionNote
      })),
    recentShifts: (user.shifts || []).slice(0, 100).map(shift => sanitizeShiftHistoryEntry(shift, user)),
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
    authorName: user.nome || user.username,
    type,
    description,
    meta,
    shiftId: user.activeShift?.id || null
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

function buildBedRequestState(value = {}) {
  const requestedAt = String(value.requestedAt || "").trim();
  const viewedAt = String(value.viewedAt || "").trim();
  const startedAt = String(value.startedAt || viewedAt || "").trim();
  const startedBy = String(value.startedBy || value.viewedBy || "").trim();
  const closedAt = String(value.closedAt || "").trim();
  const closedBy = String(value.closedBy || "").trim();
  const observation = String(value.observation || "").trim();
  let status = String(value.status || "").trim().toUpperCase();
  if (!["SOLICITADO", "EM_ACOMPANHAMENTO", "BAIXA"].includes(status)) {
    if (closedAt) status = "BAIXA";
    else if (startedAt) status = "EM_ACOMPANHAMENTO";
    else if (Boolean(value.requested || requestedAt || viewedAt)) status = "SOLICITADO";
    else status = "";
  }
  const requested = status === "SOLICITADO" || status === "EM_ACOMPANHAMENTO";
  return {
    requested,
    requestedAt,
    requestedBy: String(value.requestedBy || "").trim(),
    viewedAt,
    viewedBy: String(value.viewedBy || "").trim(),
    startedAt,
    startedBy,
    closedAt,
    closedBy,
    observation,
    status
  };
}

function buildStartedBedRequestState(value = {}, actor = "", now = new Date().toISOString()) {
  const current = buildBedRequestState(value);
  if (current.status === "BAIXA") {
    return current;
  }
  return buildBedRequestState({
    ...current,
    requested: true,
    requestedAt: current.requestedAt || now,
    requestedBy: current.requestedBy || actor,
    viewedAt: current.viewedAt || now,
    viewedBy: current.viewedBy || actor,
    startedAt: current.startedAt || now,
    startedBy: current.startedBy || actor,
    closedAt: "",
    closedBy: "",
    status: "EM_ACOMPANHAMENTO"
  });
}

function hasActiveServiceSocialRequest(value = {}) {
  const request = buildBedRequestState(value);
  if (request.status === "BAIXA") return false;
  if (request.status === "SOLICITADO" || request.status === "EM_ACOMPANHAMENTO") return true;
  if (request.closedAt) return false;
  return Boolean(request.requested || request.requestedAt || request.viewedAt || request.startedAt);
}

function buildSocialServiceSnapshotRows() {
  const patientsByLocation = new Map(
    patientRegistry
      .filter(patient => !patient?.deletedAt && patient?.currentAdmission)
      .map(patient => [`${patient.currentAdmission.wardId}:${patient.currentAdmission.bedId}`, patient])
  );
  const rows = [];

  for (const ward of wards) {
    for (const rawBed of ward.beds || []) {
      const bed = normalizeBedData({ ...rawBed });
      if (!String(bed.nome || "").trim()) continue;
      const serviceSocialRequest = buildBedRequestState(bed.serviceSocialRequest);
      if (!hasActiveServiceSocialRequest(serviceSocialRequest)) continue;
      if (serviceSocialRequest.status !== "EM_ACOMPANHAMENTO") continue;
      const patient = patientsByLocation.get(`${ward.id}:${bed.id}`) || findPatientRegistryEntry(bed) || null;
      const socialSupport = buildPatientSocialSupport(patient?.socialSupport);
      const isInProgress = serviceSocialRequest.status === "EM_ACOMPANHAMENTO";
      rows.push({
        socialHistoryId: createRecordId(),
        patientId: patient?.id || null,
        bed: String(bed.id || "-"),
        sector: ward.nome || "",
        patient: patient?.nome || bed.nome || "",
        patientBirthDate: patient?.birthDate || bed.birthDate || "",
        age: getPatientAgeLabel(patient?.birthDate || bed.birthDate || "") || "-",
        contacts: String(socialSupport.contacts || patient?.phone || "").trim(),
        admission: bed.admissao || "",
        serviceStatus: isInProgress ? "Em acompanhamento" : "Solicitado",
        serviceStatusMeta: isInProgress
          ? (serviceSocialRequest.startedBy || serviceSocialRequest.viewedBy
            ? `Em acompanhamento por ${serviceSocialRequest.startedBy || serviceSocialRequest.viewedBy}`
            : "")
          : (serviceSocialRequest.requestedBy ? `Solicitado por ${serviceSocialRequest.requestedBy}` : ""),
        socialRecord: socialSupport.socialRecord || "Pendente",
        socialRecordMeta: socialSupport.socialRecord === "Concluído" && socialSupport.socialRecordUpdatedAt
          ? `Concluído por ${socialSupport.socialRecordUpdatedBy || "-"} em ${new Date(socialSupport.socialRecordUpdatedAt).toLocaleString("pt-BR") || "-"}`
          : "",
        observation: socialSupport.observation || "",
        updatedAt: socialSupport.updatedAt || "",
        updatedBy: socialSupport.updatedBy || ""
      });
    }
  }

  return rows;
}

function buildSocialServiceShiftRows(shift = {}) {
  const shiftId = Number(shift.id) || null;
  const openedAtMs = shift.openedAt ? new Date(shift.openedAt).getTime() : 0;
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const rows = [];

  for (const item of Array.isArray(shift.socialServiceAttendances) ? shift.socialServiceAttendances : []) {
    const attendance = socialServiceAttendanceEntryForClient(item);
    rows.push({
      bed: String(attendance.bedId || "-"),
      sector: attendance.wardName || "-",
      patient: attendance.patientName || "-",
      age: getPatientAgeLabel(attendance.patientBirthDate) || "-",
      contacts: attendance.contacts || "",
      admission: attendance.admissionDate || "",
      serviceStatus: attendance.entryType === "baixa" ? "Baixa" : "Em acompanhamento",
      socialRecord: attendance.socialRecord || "Concluído",
      socialRecordMeta: attendance.closedAt
        ? `${attendance.entryType === "baixa" ? "Baixa" : "Atendimento"} por ${attendance.closedBy || "-"} em ${new Date(attendance.closedAt).toLocaleString("pt-BR") || "-"}`
        : "",
      observation: attendance.observation || "",
      updatedAt: attendance.closedAt || "",
      updatedBy: attendance.closedBy || ""
    });
  }

  const activeRows = Array.isArray(shift.socialServiceSnapshot) ? shift.socialServiceSnapshot : [];
  for (const item of activeRows) {
    rows.push({
      bed: String(item.bed || "-"),
      sector: String(item.sector || "-"),
      category: String(item.category || "").trim(),
      patient: String(item.patient || "-"),
      age: String(item.age || "-"),
      contacts: String(item.contacts || "").trim(),
      admission: String(item.admission || "").trim(),
      serviceStatus: String(item.serviceStatus || "Em acompanhamento").trim(),
      serviceStatusMeta: String(item.serviceStatusMeta || "").trim(),
      socialRecord: normalizeSocialRecordStatus(item.socialRecord || "Pendente"),
      socialRecordMeta: String(item.socialRecordMeta || "").trim(),
      observation: String(item.observation || "").trim(),
      updatedAt: String(item.updatedAt || "").trim(),
      updatedBy: String(item.updatedBy || "").trim()
    });
  }

  return rows
    .filter(item => String(item.patient || "").trim())
    .sort((a, b) =>
      String(a.sector || "").localeCompare(String(b.sector || ""), "pt-BR")
      || Number(a.bed || 0) - Number(b.bed || 0)
      || String(a.patient || "").localeCompare(String(b.patient || ""), "pt-BR")
    );
}

function getSocialServiceAttendancesForShift(shift = {}) {
  const shiftId = Number(shift.id) || null;
  const openedAtMs = shift.openedAt ? new Date(shift.openedAt).getTime() : 0;
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const items = [];

  for (const patient of patientRegistry) {
    for (const rawEntry of buildPatientSocialSupportHistory(patient?.socialSupportHistory)) {
      const entry = socialServiceAttendanceEntryForClient(rawEntry);
      if (entry.entryType !== "baixa") continue;
      const closedAtMsEntry = entry.closedAt ? new Date(entry.closedAt).getTime() : 0;
      const sameShift = shiftId && entry.shiftId && Number(entry.shiftId) === shiftId;
      const withinPeriod = !entry.shiftId
        && closedAtMsEntry >= openedAtMs
        && closedAtMsEntry <= closedAtMs
        && sameShiftOwner(shift, entry.closedBy);
      if (!sameShift && !withinPeriod) continue;
      items.push(entry);
    }
  }

  return items.sort((a, b) =>
    String(b.closedAt || "").localeCompare(String(a.closedAt || ""), "pt-BR")
    || String(a.patientName || "").localeCompare(String(b.patientName || ""), "pt-BR")
  );
}

function clearActiveSocialServiceShiftDrafts() {
  const openSocialShifts = users.reduce((total, user) => total + getUserActiveShifts(user)
    .filter(shift => String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL").length, 0);
  // Com outro profissional em plantão, as observações dele não podem ser apagadas.
  if (openSocialShifts > 1) return;
  const now = new Date().toISOString();
  for (const patient of patientRegistry) {
    if (!patient?.currentAdmission) continue;
    const ward = wards.find(item => Number(item.id) === Number(patient.currentAdmission.wardId));
    const bed = ward?.beds?.find(item => Number(item.id) === Number(patient.currentAdmission.bedId));
    const request = buildBedRequestState(bed?.serviceSocialRequest || patient.currentAdmission.serviceSocialRequest);
    if (!hasActiveServiceSocialRequest(request)) continue;
    const current = buildPatientSocialSupport(patient.socialSupport);
    patient.socialSupport = buildPatientSocialSupport({
      ...current,
      observation: "",
      updatedAt: "",
      updatedBy: ""
    });
    patient.updatedAt = now;
  }
}

function addShiftSolvedPendings(user, wardId, items) {
  const activeShift = getUserActiveShifts(user).find(shift => Number(shift.wardId) === Number(wardId));
  if (!activeShift || !Array.isArray(items) || !items.length) return;
  if (!Array.isArray(activeShift.pendenciasFinalizadas)) {
    activeShift.pendenciasFinalizadas = [];
  }

  for (const item of items) {
    const key = `${item.leito}:${item.id || item.texto}:${item.finishedAt || ""}`;
    const exists = activeShift.pendenciasFinalizadas.some(existing =>
      `${existing.leito}:${existing.id || existing.texto}:${existing.finishedAt || ""}` === key
    );
    if (!exists) {
      activeShift.pendenciasFinalizadas.push({ ...item });
    }
  }
}

function getShiftProcedureSummary(ward, shift) {
  const counts = {};
  const procedures = new Map();
  const workPeriods = Array.isArray(shift.workPeriods) && shift.workPeriods.length
    ? shift.workPeriods
    : [{ openedAt: shift.openedAt || "", closedAt: shift.closedAt || "" }];
  const openedAtMs = shift.openedAt ? new Date(shift.openedAt).getTime() : Number.NaN;
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const isWithinShiftWindow = value => {
    const timeMs = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(timeMs) && workPeriods.some(period => {
      const periodStart = period.openedAt ? new Date(period.openedAt).getTime() : openedAtMs;
      const periodEnd = period.closedAt ? new Date(period.closedAt).getTime() : closedAtMs;
      return Number.isFinite(periodStart) && Number.isFinite(periodEnd)
        && timeMs >= periodStart && timeMs <= periodEnd;
    });
  };
  const addProcedure = (procedure, bedId = "") => {
    if (!procedure || (procedure.wardId && Number(procedure.wardId) !== Number(shift.wardId))) return;
    if (String(procedure.createdBy || "").trim() === "Sistema") return;
    const belongsToShift = procedure.shiftId
      ? String(procedure.shiftId) === String(shift.id)
      : isWithinShiftWindow(procedure.createdAt || procedure.at);
    if (!belongsToShift) return;
    const type = String(procedure.tipo || procedure.procedure || "").trim();
    if (!type) return;
    const key = String(procedure.id || `${bedId}:${procedure.createdAt || procedure.at}:${type}`);
    procedures.set(key, type);
  };

  for (const procedure of ward?.procedimentosCenso || []) {
    addProcedure(procedure, procedure.bedId);
  }
  for (const bed of ward?.beds || []) {
    for (const procedure of bed.procedimentosHistorico || []) {
      addProcedure(procedure, bed.id);
    }
  }
  for (const procedure of procedures.values()) {
    counts[procedure] = (counts[procedure] || 0) + 1;
  }
  return topEntries(counts, 20);
}

function buildShiftReport(user, shift) {
  const ward = wards.find(item => item.id === shift.wardId);
  const beds = ward ? ward.beds.map(bed => normalizeBedData({ ...bed })) : [];
  const openedAtMs = shift.openedAt ? new Date(shift.openedAt).getTime() : 0;
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const workPeriods = Array.isArray(shift.workPeriods) && shift.workPeriods.length
    ? shift.workPeriods
    : [{ openedAt: shift.openedAt || "", closedAt: shift.closedAt || "" }];
  const isWithinShiftWindow = value => {
    const timeMs = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(timeMs) && workPeriods.some(period => {
      const periodStart = period.openedAt ? new Date(period.openedAt).getTime() : openedAtMs;
      const periodEnd = period.closedAt ? new Date(period.closedAt).getTime() : closedAtMs;
      return Number.isFinite(periodStart) && Number.isFinite(periodEnd) && timeMs >= periodStart && timeMs <= periodEnd;
    });
  };
  const shiftActions = (Array.isArray(shift.actions) ? shift.actions : [])
    .filter(action => isWithinShiftWindow(action?.at));
  const patientsAtOpen = Array.isArray(shift.patientsAtOpen) ? shift.patientsAtOpen : [];
  const buildAdmissionSegments = admission => {
    if (!admission) return [];
    const transfers = Array.isArray(admission.transferHistory)
      ? admission.transferHistory.slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      : [];
    const segments = [];
    let currentSegment = {
      wardId: admission.wardId,
      wardNome: admission.wardNome || "",
      bedId: admission.bedId,
      enfermaria: admission.enfermaria || "",
      startedAt: admission.admissionEventAt
        || (String(admission.admittedAt || "").includes("T") ? admission.admittedAt : ""),
      endedAt: admission.dischargedAt || ""
    };

    for (const transfer of transfers) {
      const transferAt = String(transfer.at || "").trim();
      segments.push({
        ...currentSegment,
        endedAt: transferAt || currentSegment.endedAt || ""
      });
      currentSegment = {
        wardId: transfer.toWardId,
        wardNome: transfer.toWardNome || "",
        bedId: transfer.toBedId,
        enfermaria: transfer.toEnfermaria || "",
        startedAt: transferAt || currentSegment.startedAt || "",
        endedAt: admission.dischargedAt || ""
      };
    }

    segments.push(currentSegment);
    return segments;
  };
  const getRequestStatusLabel = value => {
    const request = buildBedRequestState(value);
    if (request.status === "EM_ACOMPANHAMENTO") return "Em acompanhamento";
    if (request.status === "SOLICITADO" && request.viewedAt) return "Visualizada";
    if (request.status === "SOLICITADO") return "Solicitado";
    if (request.status === "BAIXA") return "Baixa";
    return "Inativo";
  };
  const resolveReportValue = (primary, secondary) => {
    if (Array.isArray(primary)) return primary.length ? primary : (Array.isArray(secondary) ? secondary : []);
    if (primary === false) return false;
    return primary !== undefined && primary !== null && primary !== "" ? primary : secondary;
  };
  const getShiftPatientKey = (patient = {}, fallback = {}) => {
    const patientId = Number(patient?.id || fallback?.id);
    if (patientId) return `patient:${patientId}`;
    const cpf = normalizeCpf(patient?.cpf || fallback?.cpf);
    if (cpf) return `cpf:${cpf}`;
    const nome = normalizePersonName(patient?.nome || fallback?.nome || fallback?.patientName);
    if (!nome) return "";
    return `name:${nome}|birth:${String(patient?.birthDate || fallback?.birthDate || "").trim()}|bed:${String(fallback?.bedId || "").trim()}`;
  };
  const mergeShiftPatientRecord = (current = {}, incoming = {}) => ({
    id: resolveReportValue(current.id, incoming.id) || null,
    leito: resolveReportValue(current.leito, incoming.leito) || "",
    enfermaria: resolveReportValue(current.enfermaria, incoming.enfermaria) || "",
    nome: resolveReportValue(current.nome, incoming.nome) || "",
    cpf: resolveReportValue(current.cpf, incoming.cpf) || "",
    birthDate: resolveReportValue(current.birthDate, incoming.birthDate) || "",
    idade: resolveReportValue(current.idade, incoming.idade) || "",
    telefone: resolveReportValue(current.telefone, incoming.telefone) || "",
    admissao: resolveReportValue(current.admissao, incoming.admissao) || "",
    alta: resolveReportValue(current.alta, incoming.alta) || "",
    diagnostico: resolveReportValue(current.diagnostico, incoming.diagnostico) || "",
    nir: resolveReportValue(current.nir, incoming.nir) || "",
    cil: resolveReportValue(current.cil, incoming.cil) || "",
    nirStatus: resolveReportValue(current.nirStatus, incoming.nirStatus) || "Inativo",
    socialStatus: resolveReportValue(current.socialStatus, incoming.socialStatus) || "Inativo",
    psychologyStatus: resolveReportValue(current.psychologyStatus, incoming.psychologyStatus) || "Inativo",
    pendencias: resolveReportValue(current.pendencias, incoming.pendencias) || "",
    procedimentos: Array.from(new Set([
      ...(Array.isArray(current.procedimentos) ? current.procedimentos : []),
      ...(Array.isArray(incoming.procedimentos) ? incoming.procedimentos : [])
    ].filter(Boolean))),
    ativoNoFechamento: Boolean(current.ativoNoFechamento || incoming.ativoNoFechamento)
  });
  const getPatientNirStatus = patient => patient?.regulationAcceptedAt
    ? "Aceito"
    : (patient?.nirLastUpdateAt || patient?.nir || patient?.cil || (Array.isArray(patient?.regulationChannels) && patient.regulationChannels.length)
      ? "Ativo"
      : "Inativo");
  const resolveActionLocation = meta => {
    const shiftWardId = Number(shift.wardId);
    const shiftWardName = normalizePersonName(shift.wardNome);
    if (Number(meta?.wardId) === shiftWardId || normalizePersonName(meta?.wardNome) === shiftWardName) {
      return {
        bedId: meta?.bedId || "",
        enfermaria: meta?.enfermaria || meta?.wardNome || ""
      };
    }
    if (Number(meta?.toWardId) === shiftWardId || normalizePersonName(meta?.toWardNome) === shiftWardName) {
      return {
        bedId: meta?.toBedId || "",
        enfermaria: meta?.toEnfermaria || meta?.toWardNome || ""
      };
    }
    if (Number(meta?.fromWardId) === shiftWardId || normalizePersonName(meta?.fromWardNome) === shiftWardName) {
      return {
        bedId: meta?.fromBedId || "",
        enfermaria: meta?.fromEnfermaria || meta?.fromWardNome || ""
      };
    }
    return {
      bedId: meta?.bedId || meta?.toBedId || meta?.fromBedId || "",
      enfermaria: meta?.enfermaria || meta?.toEnfermaria || meta?.fromEnfermaria || meta?.wardNome || meta?.toWardNome || meta?.fromWardNome || ""
    };
  };
  const actionBelongsToShiftWard = action => {
    const meta = action?.meta || {};
    const shiftWardId = Number(shift.wardId);
    const shiftWardName = normalizePersonName(shift.wardNome);
    if ([meta.wardId, meta.toWardId, meta.fromWardId].some(value => Number(value) === shiftWardId)) {
      return true;
    }
    if ([
      meta.wardNome,
      meta.toWardNome,
      meta.fromWardNome
    ].some(value => normalizePersonName(value) === shiftWardName)) {
      return true;
    }
    const patient = findPatientFromAction(meta);
    return Boolean(patient && shiftPatientsMap.has(getShiftPatientKey(patient)));
  };
  const findPatientFromAction = meta => {
    const patientId = Number(meta?.patientId);
    if (patientId) {
      return patientRegistry.find(patient => !patient?.deletedAt && Number(patient.id) === patientId) || null;
    }
    const patientName = normalizePersonName(meta?.patientName || meta?.patient || meta?.visitedPersonName);
    if (!patientName) return null;
    return patientRegistry.find(patient => !patient?.deletedAt && normalizePersonName(patient.nome) === patientName) || null;
  };
  const getMergedPatientAdmissions = patient => {
    const admissions = Array.isArray(patient?.admissionHistory) ? patient.admissionHistory.slice() : [];
    if (patient?.currentAdmission) {
      const currentAdmissionId = String(patient.currentAdmission?.id || "").trim();
      const currentAdmissionIndex = currentAdmissionId
        ? admissions.findIndex(admission => String(admission?.id || "").trim() === currentAdmissionId)
        : -1;
      if (currentAdmissionIndex >= 0) {
        admissions[currentAdmissionIndex] = {
          ...admissions[currentAdmissionIndex],
          ...patient.currentAdmission
        };
      } else {
        const hasCurrentAdmission = admissions.some(admission =>
          Number(admission?.wardId) === Number(patient.currentAdmission?.wardId)
          && Number(admission?.bedId) === Number(patient.currentAdmission?.bedId)
          && String(admission?.admittedAt || "").trim() === String(patient.currentAdmission?.admittedAt || "").trim()
        );
        if (!hasCurrentAdmission) admissions.push(patient.currentAdmission);
      }
    }
    return admissions;
  };
  const buildMovementEntry = ({
    kind = "",
    patient = null,
    patientName = "",
    bedId = "",
    enfermaria = "",
    at = "",
    detail = "",
    source = "",
    destination = ""
  } = {}) => ({
    kind,
    patientId: patient?.id || null,
    patientName: patient?.nome || patientName || "",
    bedId: bedId || patient?.currentAdmission?.bedId || "",
    enfermaria: enfermaria || patient?.currentAdmission?.enfermaria || "",
    at,
    detail,
    source,
    destination
  });
  const shiftPatientsMap = new Map();

  for (const snapshot of patientsAtOpen) {
    const patient = patientRegistry.find(item =>
      !item?.deletedAt && Number(item.id) === Number(snapshot.patientId)
    );
    const currentAdmission = patient?.currentAdmission;
    const currentBed = beds.find(bed =>
      (
        (Number(bed.id) === Number(currentAdmission?.bedId)
          && Number(currentAdmission?.wardId) === Number(shift.wardId))
        || (Number(bed.id) === Number(snapshot.bedId)
          && getPatientIdentityKey(bed) === getPatientIdentityKey(snapshot))
      )
      && isBedOccupiedByPatient(bed)
      && getPatientIdentityKey(bed) === getPatientIdentityKey(snapshot)
    );
    const socialSupport = buildPatientSocialSupport(patient?.socialSupport);
    const socialFormDone = hasPatientSocialFormData(socialSupport.socialForm);
    const entry = {
      id: snapshot.patientId,
      leito: snapshot.bedId || "",
      enfermaria: snapshot.enfermaria || "",
      nome: snapshot.nome || "",
      cpf: snapshot.cpf || "",
      birthDate: snapshot.birthDate || "",
      idade: getPatientAgeLabel(snapshot.birthDate || "") || "",
      telefone: snapshot.telefone || "",
      admissao: snapshot.admissao || "",
      alta: "",
      diagnostico: snapshot.diagnostico || "",
      nir: snapshot.nir || "",
      cil: snapshot.cil || "",
      nirStatus: patient ? getPatientNirStatus(patient) : "Inativo",
      socialStatus: socialFormDone
        ? "Concluído"
        : getRequestStatusLabel(snapshot.serviceSocialRequest),
      psychologyStatus: getRequestStatusLabel(snapshot.psychologyRequest),
      pendencias: snapshot.pendencias || "",
      procedimentos: Array.isArray(snapshot.procedimentos) ? snapshot.procedimentos : [],
      ativoNoFechamento: Boolean(currentBed)
    };
    const patientKey = getShiftPatientKey(patient, {
      id: entry.id,
      cpf: entry.cpf,
      nome: entry.nome,
      birthDate: entry.birthDate,
      bedId: entry.leito
    });
    if (patientKey) shiftPatientsMap.set(patientKey, entry);
  }

  for (const patient of patientRegistry) {
    if (patient?.deletedAt) continue;
    const admissions = getMergedPatientAdmissions(patient);
    for (const admission of admissions) {
      const segments = buildAdmissionSegments(admission).filter(segment => {
        if (Number(segment.wardId) !== Number(shift.wardId)) return false;
        const wasAtOpen = patientsAtOpen.some(snapshot =>
          Number(snapshot.patientId) === Number(patient.id)
          && Number(snapshot.bedId) === Number(segment.bedId)
          && String(snapshot.enfermaria || "") === String(segment.enfermaria || "")
        );
        return wasAtOpen || isWithinShiftWindow(segment.startedAt) || isWithinShiftWindow(segment.endedAt);
      });
      if (!segments.length) continue;

      const latestSegment = segments[segments.length - 1];
      const currentBed = beds.find(bed =>
        Number(bed.id) === Number(latestSegment.bedId) && String(bed.enfermaria || "") === String(latestSegment.enfermaria || "")
      ) || null;
      const socialSupport = buildPatientSocialSupport(patient.socialSupport);
      const socialFormDone = hasPatientSocialFormData(socialSupport.socialForm);
      const activeAdmission = patient.currentAdmission && Number(patient.currentAdmission.wardId) === Number(shift.wardId)
        ? patient.currentAdmission
        : null;
      const entry = {
        id: patient.id || null,
        leito: latestSegment.bedId || "",
        enfermaria: latestSegment.enfermaria || latestSegment.wardNome || "",
        nome: patient.nome || "",
        cpf: patient.cpf || "",
        birthDate: patient.birthDate || "",
        idade: getPatientAgeLabel(patient.birthDate || "") || "",
        telefone: patient.phone || "",
        admissao: admission.admittedAt || latestSegment.startedAt || "",
        alta: admission.dischargedAt || "",
        diagnostico: patient.diagnostico || "",
        nir: patient.nir || "",
        cil: patient.cil || "",
        nirStatus: getPatientNirStatus(patient),
        socialStatus: socialFormDone
          ? "Concluído"
          : getRequestStatusLabel(activeAdmission?.serviceSocialRequest || currentBed?.serviceSocialRequest),
        psychologyStatus: getRequestStatusLabel(activeAdmission?.psychologyRequest || currentBed?.psychologyRequest),
        pendencias: currentBed?.pendencias || "",
        procedimentos: Array.isArray(currentBed?.procedimentos) ? currentBed.procedimentos : [],
        ativoNoFechamento: Boolean(activeAdmission)
      };
      const patientKey = getShiftPatientKey(patient, { bedId: latestSegment.bedId });
      if (!patientKey) continue;
      shiftPatientsMap.set(patientKey, mergeShiftPatientRecord(shiftPatientsMap.get(patientKey), entry));
    }
  }

  for (const action of shiftActions) {
    if (!actionBelongsToShiftWard(action)) continue;
    const meta = action.meta || {};
    const patientName = String(meta.patientName || meta.patient || meta.visitedPersonName || "").trim();
    const matchedPatient = findPatientFromAction(meta);
    if (!matchedPatient && !patientName) continue;

    const location = resolveActionLocation(meta);
    const currentBed = beds.find(bed =>
      Number(bed.id) === Number(location.bedId)
      && (!String(location.enfermaria || "").trim() || String(bed.enfermaria || "") === String(location.enfermaria || ""))
    ) || null;
    const activeAdmission = matchedPatient?.currentAdmission && Number(matchedPatient.currentAdmission.wardId) === Number(shift.wardId)
      ? matchedPatient.currentAdmission
      : null;
    const socialSupport = buildPatientSocialSupport(matchedPatient?.socialSupport);
    const socialFormDone = hasPatientSocialFormData(socialSupport.socialForm);
    const fallbackBirthDate = String(meta.patientBirthDate || meta.birthDate || "").trim();
    const entry = {
      id: matchedPatient?.id || Number(meta.patientId) || null,
      leito: location.bedId || activeAdmission?.bedId || "",
      enfermaria: location.enfermaria || activeAdmission?.enfermaria || currentBed?.enfermaria || "",
      nome: matchedPatient?.nome || patientName,
      cpf: matchedPatient?.cpf || normalizeCpf(meta.patientCpf || meta.cpf),
      birthDate: matchedPatient?.birthDate || fallbackBirthDate,
      idade: getPatientAgeLabel(matchedPatient?.birthDate || fallbackBirthDate) || "",
      telefone: matchedPatient?.phone || normalizePhone(meta.patientPhone || meta.phone),
      admissao: activeAdmission?.admittedAt || String(meta.admittedAt || meta.admissionDate || "").trim(),
      alta: activeAdmission?.dischargedAt || String(meta.dischargedAt || "").trim(),
      diagnostico: matchedPatient?.diagnostico || String(meta.diagnostico || "").trim(),
      nir: matchedPatient?.nir || String(meta.nir || "").trim(),
      cil: matchedPatient?.cil || String(meta.cil || "").trim(),
      nirStatus: matchedPatient ? getPatientNirStatus(matchedPatient) : "Inativo",
      socialStatus: socialFormDone
        ? "Concluído"
        : getRequestStatusLabel(activeAdmission?.serviceSocialRequest || currentBed?.serviceSocialRequest || meta.serviceSocialRequest),
      psychologyStatus: getRequestStatusLabel(activeAdmission?.psychologyRequest || currentBed?.psychologyRequest || meta.psychologyRequest),
      pendencias: currentBed?.pendencias || "",
      procedimentos: Array.from(new Set([
        ...(Array.isArray(currentBed?.procedimentos) ? currentBed.procedimentos : []),
        ...(Array.isArray(meta.procedimentos) ? meta.procedimentos : [])
      ].filter(Boolean))),
      ativoNoFechamento: Boolean(activeAdmission)
    };
    const patientKey = getShiftPatientKey(matchedPatient, {
      id: entry.id,
      cpf: entry.cpf,
      nome: entry.nome,
      birthDate: entry.birthDate,
      bedId: entry.leito
    });
    if (!patientKey) continue;
    shiftPatientsMap.set(patientKey, mergeShiftPatientRecord(shiftPatientsMap.get(patientKey), entry));
  }
  const shiftWardActions = shiftActions.filter(action => actionBelongsToShiftWard(action));
  const reportActions = shiftActions;
  const shiftPatients = Array.from(shiftPatientsMap.values())
    .filter(patient => beds.some(bed =>
      isBedOccupiedByPatient(bed)
      && getPatientIdentityKey(bed) === getPatientIdentityKey(patient)
    ))
    .map(patient => ({ ...patient, ativoNoFechamento: true }))
    .sort((a, b) =>
      String(a.enfermaria || "").localeCompare(String(b.enfermaria || ""), "pt-BR")
      || Number(a.leito || 0) - Number(b.leito || 0)
      || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR")
    );
  const movementSummary = {
    admissions: [],
    internalTransfers: [],
    externalTransfers: [],
    altas: [],
    obitos: [],
    evasoes: []
  };

  for (const patient of patientRegistry) {
    if (patient?.deletedAt) continue;
    const admissions = getMergedPatientAdmissions(patient);
    for (const admission of admissions) {
      if (Number(admission?.wardId) === Number(shift.wardId) && isWithinShiftWindow(admission?.admissionEventAt)) {
        movementSummary.admissions.push(buildMovementEntry({
          kind: "ADMISSAO",
          patient,
          bedId: admission?.bedId || "",
          enfermaria: admission?.enfermaria || "",
          at: admission?.admissionEventAt || "",
          detail: admission?.closeReason || patient?.diagnostico || ""
        }));
      }

      for (const transfer of Array.isArray(admission?.transferHistory) ? admission.transferHistory : []) {
        if (!isWithinShiftWindow(transfer?.at)) continue;
        if (Number(transfer?.fromWardId) !== Number(shift.wardId) && Number(transfer?.toWardId) !== Number(shift.wardId)) continue;
        const isLeavingShiftWard = Number(transfer?.fromWardId) === Number(shift.wardId);
        movementSummary.internalTransfers.push(buildMovementEntry({
          kind: "TRANSFERENCIA_INTERNA",
          patient,
          bedId: isLeavingShiftWard ? transfer?.fromBedId : transfer?.toBedId,
          enfermaria: isLeavingShiftWard ? transfer?.fromEnfermaria : transfer?.toEnfermaria,
          at: transfer?.at || "",
          source: `${transfer?.fromWardNome || "-"} / Leito ${transfer?.fromBedId || "-"}`,
          destination: `${transfer?.toWardNome || "-"} / Leito ${transfer?.toBedId || "-"}`,
          detail: isLeavingShiftWard
            ? `Saiu para ${transfer?.toWardNome || "-"}`
            : `Recebido de ${transfer?.fromWardNome || "-"}`
        }));
      }
    }
  }

  for (const action of shiftWardActions) {
    const patient = findPatientFromAction(action.meta || {});
    const patientName = String(action.meta?.patientName || action.meta?.patient || "").trim();
    const bedId = action.meta?.bedId || action.meta?.fromBedId || action.meta?.toBedId || "";
    const enfermaria = action.meta?.enfermaria || action.meta?.fromEnfermaria || action.meta?.toEnfermaria || "";
    if (action.type === "ALTA") {
      movementSummary.altas.push(buildMovementEntry({
        kind: "ALTA",
        patient,
        patientName,
        bedId,
        enfermaria,
        at: action.at,
        detail: String(action.meta?.note || "").trim()
      }));
    } else if (action.type === "OBITO") {
      movementSummary.obitos.push(buildMovementEntry({
        kind: "OBITO",
        patient,
        patientName,
        bedId,
        enfermaria,
        at: action.at,
        detail: String(action.meta?.note || "").trim()
      }));
    } else if (action.type === "TRANSFERENCIA_EXTERNA") {
      movementSummary.externalTransfers.push(buildMovementEntry({
        kind: "TRANSFERENCIA_EXTERNA",
        patient,
        patientName,
        bedId,
        enfermaria,
        at: action.at,
        detail: String(action.meta?.note || "").trim()
      }));
    } else if (action.type === "EVASAO") {
      movementSummary.evasoes.push(buildMovementEntry({
        kind: "EVASAO",
        patient,
        patientName,
        bedId,
        enfermaria,
        at: action.at,
        detail: String(action.meta?.note || "").trim()
      }));
    }
  }

  for (const key of Object.keys(movementSummary)) {
    movementSummary[key].sort((a, b) =>
      new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime()
      || String(a.patientName || "").localeCompare(String(b.patientName || ""), "pt-BR")
    );
  }

  const altas = movementSummary.altas.length;
  const obitos = movementSummary.obitos.length;
  const dispositivos = getShiftProcedureSummary(ward, shift);

  const activePendingMap = new Map();
  const solvedPendencias = [];
  const solvedKeys = new Set();
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

      if (
        pendencia.status !== "FINALIZADA"
        && isWithinShiftWindow(pendencia.createdAt)
      ) {
        addActivePending(baseItem);
      }

      if (pendencia.finishedAt) {
        if (isWithinShiftWindow(pendencia.finishedAt)) {
          addSolvedPending(baseItem);
        }
      }
    }
  }

  for (const action of shiftWardActions) {
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
      workPeriods: workPeriods.map(period => ({
        openedAt: period.openedAt || "",
        closedAt: period.closedAt || ""
      })),
      shiftDate: shift.shiftDate || "",
      wardId: shift.wardId,
      wardNome: shift.wardNome,
      serviceType: shift.serviceType || "",
      shiftLength: shift.shiftLength || "12H",
      shiftPeriod: shift.shiftPeriod || "DIA",
      team: shift.team || null,
      username: shift.ownerUsername || user.username,
      nome: shift.ownerName || user.nome,
      nursingReport: String(shift.nursingReport || "").trim(),
      nursingReportUpdatedAt: String(shift.nursingReportUpdatedAt || "").trim(),
      nursingReportUpdatedBy: String(shift.nursingReportUpdatedBy || "").trim(),
      socialServiceReport: shift.socialServiceReport && typeof shift.socialServiceReport === "object"
        ? { ...shift.socialServiceReport }
        : { companions: "", families: "", deaths: "", pending: "" },
      socialServiceReportUpdatedAt: String(shift.socialServiceReportUpdatedAt || "").trim(),
      socialServiceReportUpdatedBy: String(shift.socialServiceReportUpdatedBy || "").trim(),
      teamUpdatedAt: shift.teamUpdatedAt || "",
      teamUpdatedBy: shift.teamUpdatedBy || ""
    },
    summary: {
      pacientesNoPeriodo: shiftPatients.length,
      pacientesAtivos: shiftPatients.length,
      altas,
      obitos,
      admissoes: movementSummary.admissions.length,
      transferenciasInternas: movementSummary.internalTransfers.length,
      transferenciasExternas: movementSummary.externalTransfers.length,
      evasoes: movementSummary.evasoes.length,
      dispositivos,
      pendenciasAtivas: activePendencias.length,
      pendenciasSolucionadas: solvedPendencias.length,
      totalAlteracoes: reportActions.length
    },
    patients: shiftPatients,
    movements: movementSummary,
    pending: {
      active: activePendencias,
      solved: solvedPendencias
    },
    socialServiceRows: String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
      ? buildSocialServiceShiftRows(shift)
      : [],
    socialServiceActivePatients: String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
      ? (Array.isArray(shift.socialServiceSnapshot) ? shift.socialServiceSnapshot.filter(item => String(item.bed || "") !== "Avulso") : [])
      : [],
    socialServiceManualAttendances: String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
      ? (Array.isArray(shift.socialServiceManualAttendances)
        ? shift.socialServiceManualAttendances.map(item => ({ ...item }))
        : (Array.isArray(shift.socialServiceSnapshot)
          ? shift.socialServiceSnapshot
            .filter(item => String(item.bed || "") === "Avulso" && ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(item.category || "").trim().toUpperCase()))
            .map(item => ({
              category: String(item.category || "").trim().toUpperCase(),
              patient: String(item.patient || "").trim(),
              location: String(item.sector || "").trim(),
              observation: String(item.observation || "").trim(),
              contacts: String(item.contacts || "").trim(),
              status: String(item.serviceStatus || "").trim()
            }))
          : []))
      : [],
    socialServiceFormUpdates: String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
      ? (Array.isArray(shift.socialServiceFormUpdates) ? shift.socialServiceFormUpdates.map(item => ({ ...item })) : [])
      : [],
    actions: reportActions.slice().reverse().map(action => ({
      id: action.id,
      at: action.at,
      type: action.type,
      description: action.description,
      username: action.username || "",
      authorName: action.authorName || action.username || "",
      meta: action.meta || {}
    }))
  };
}

function normalizeBedData(bed) {
  bed.cpf = String(bed.cpf || "").replace(/\D/g, "");
  bed.birthDate = bed.birthDate || "";
  bed.nirRequest = buildBedRequestState(bed.nirRequest);
  bed.serviceSocialRequest = buildBedRequestState(bed.serviceSocialRequest);
  bed.psychologyRequest = buildBedRequestState(bed.psychologyRequest);
  const hasPatientOccupyingBed = String(bed.status || "").toUpperCase() === "OCUPADO" && Boolean(String(bed.nome || "").trim());
  if (!hasPatientOccupyingBed) {
    bed.nir = "";
    bed.cil = "";
    bed.nirRequest = buildBedRequestState();
    bed.serviceSocialRequest = buildBedRequestState();
    bed.psychologyRequest = buildBedRequestState();
  }
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
  bed.nirRequest = buildBedRequestState();
  bed.serviceSocialRequest = buildBedRequestState();
  bed.psychologyRequest = buildBedRequestState();
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
    procedimentosHistorico: Array.isArray(bed.procedimentosHistorico) ? JSON.parse(JSON.stringify(bed.procedimentosHistorico)) : [],
    nirRequest: buildBedRequestState(bed.nirRequest),
    serviceSocialRequest: buildBedRequestState(bed.serviceSocialRequest),
    psychologyRequest: buildBedRequestState(bed.psychologyRequest)
  };
}

function attachCensusEntryToShift(ward, entry, bedId = null) {
  const shifts = users.flatMap(user => [
    ...getUserActiveShifts(user),
    ...(Array.isArray(user.shifts) ? user.shifts : [])
  ]).filter(shift => Number(shift.wardId) === Number(ward.id));
  const existingShift = shifts.find(shift => Number(shift.id) === Number(entry.shiftId));
  const createdAt = Date.parse(String(entry.createdAt || ""));
  const matchingShift = existingShift || shifts.find(shift => {
    const openedAt = Date.parse(String(shift.openedAt || ""));
    const closedAt = shift.closedAt ? Date.parse(String(shift.closedAt)) : Date.now();
    return Number.isFinite(createdAt)
      && Number.isFinite(openedAt)
      && Number.isFinite(closedAt)
      && createdAt >= openedAt
      && createdAt <= closedAt;
  });
  if (!matchingShift) return null;
  return {
    ...entry,
    wardId: ward.id,
    bedId: entry.bedId || bedId,
    shiftId: matchingShift.id,
    shiftOwnerName: matchingShift.ownerName || "",
    shiftOwnerUsername: matchingShift.ownerUsername || ""
  };
}

function getWardCensusProcedures(ward) {
  const proceduresById = new Map();
  for (const procedure of Array.isArray(ward.procedimentosCenso) ? ward.procedimentosCenso : []) {
    if (procedure?.id && (!procedure.wardId || Number(procedure.wardId) === Number(ward.id))) {
      const shiftProcedure = attachCensusEntryToShift(ward, procedure, procedure.bedId);
      if (shiftProcedure) proceduresById.set(procedure.id, shiftProcedure);
    }
  }
  for (const bed of ward.beds || []) {
    for (const procedure of Array.isArray(bed.procedimentosHistorico) ? bed.procedimentosHistorico : []) {
      if (procedure?.id && (!procedure.wardId || Number(procedure.wardId) === Number(ward.id)) && !proceduresById.has(procedure.id)) {
        const shiftProcedure = attachCensusEntryToShift(ward, procedure, bed.id);
        if (shiftProcedure) proceduresById.set(procedure.id, shiftProcedure);
      }
    }
  }
  return Array.from(proceduresById.values());
}

function getWardCensusOutcomes(ward) {
  const outcomesById = new Map();
  const addOutcome = outcome => {
    const shiftOutcome = attachCensusEntryToShift(ward, outcome, outcome.bedId);
    if (shiftOutcome) outcomesById.set(shiftOutcome.id, shiftOutcome);
  };

  for (const outcome of Array.isArray(ward.desfechosCenso) ? ward.desfechosCenso : []) {
    addOutcome(outcome);
  }

  for (const user of users) {
    const shifts = [
      ...getUserActiveShifts(user),
      ...(Array.isArray(user.shifts) ? user.shifts : [])
    ];
    for (const shift of shifts) {
      if (Number(shift.wardId) !== Number(ward.id)) continue;
      for (const action of Array.isArray(shift.actions) ? shift.actions : []) {
        const type = String(action.type || "").trim().toUpperCase();
        if (!["ALTA", "OBITO", "EVASAO", "TRANSFERENCIA_EXTERNA"].includes(type) || !action.id || !action.at) continue;
        addOutcome({
          id: action.id,
          tipo: type,
          createdAt: action.at,
          wardId: ward.id,
          bedId: action.meta?.bedId || null,
          shiftId: shift.id,
          recordedByUsername: action.username || user.username,
          recordedByName: action.authorName || user.nome || user.username
        });
      }
    }
  }

  return Array.from(outcomesById.values());
}

function getActiveWardCensusShift(wardId) {
  for (const user of users) {
    const shift = getUserActiveShifts(user)
      .find(activeShift => Number(activeShift.wardId) === Number(wardId) && !activeShift.serviceType);
    if (shift) return shift;
  }
  return null;
}

function getCensusPeriodBounds(date = new Date()) {
  const start = new Date(date);
  if (start.getHours() < 7) start.setDate(start.getDate() - 1);
  start.setHours(7, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function getAllUserActions() {
  const actionsById = new Map();
  for (const user of users) {
    const shifts = [
      ...getUserActiveShifts(user),
      ...(Array.isArray(user.shifts) ? user.shifts : [])
    ];
    for (const action of [
      ...(Array.isArray(user.actions) ? user.actions : []),
      ...shifts.flatMap(shift => Array.isArray(shift.actions) ? shift.actions : [])
    ]) {
      if (action?.id) actionsById.set(action.id, action);
    }
  }
  return Array.from(actionsById.values());
}

function getCensusValuesForPeriod(ward, periodStartDate, periodEndDate, context = null) {
  const periodStart = new Date(`${periodStartDate}T07:00:00`);
  const periodEnd = new Date(`${periodEndDate}T07:00:00`);
  const now = new Date();
  const asOf = periodEnd <= now ? new Date(periodEnd.getTime() - 1) : now;
  const censusContext = context || {
    admissions: getDashboardAdmissions(wards),
    bedActionHistory: getDashboardBedActionHistory(),
    actions: getAllUserActions()
  };
  const activePatients = new Map();

  for (const admission of censusContext.admissions) {
    const segment = dashboardSegmentAt(admission, asOf);
    if (!segment || Number(segment.wardId) !== Number(ward.id)) continue;
    const patientKey = admission.patientId || admission.id;
    const previous = activePatients.get(patientKey);
    if (!previous || String(admission.admittedAt || "") > String(previous.admittedAt || "")) {
      activePatients.set(patientKey, admission);
    }
  }

  const events = censusContext.actions.filter(action => {
    const eventAt = parseDashboardDate(action.at);
    return eventAt && eventAt >= periodStart && eventAt < periodEnd;
  });
  const wardEvents = events.filter(action => Number(action.meta?.wardId) === Number(ward.id));
  const transferActions = events.filter(action => String(action.type || "").toUpperCase() === "BED_TRANSFER");
  const censusOutcomes = (Array.isArray(ward.desfechosCenso) ? ward.desfechosCenso : [])
    .filter(outcome => {
      const eventAt = parseDashboardDate(outcome.createdAt);
      return eventAt && eventAt >= periodStart && eventAt < periodEnd;
    });
  const outcomeCounts = { ALTA: 0, OBITO: 0, TRANSFERENCIA_EXTERNA: 0, EVASAO: 0 };
  const outcomeIds = new Set();
  for (const outcome of censusOutcomes) {
    const type = String(outcome.tipo || "").toUpperCase();
    if (!Object.hasOwn(outcomeCounts, type)) continue;
    outcomeCounts[type] += 1;
    if (outcome.id) outcomeIds.add(outcome.id);
  }
  for (const action of wardEvents) {
    const type = String(action.type || "").toUpperCase();
    if (!Object.hasOwn(outcomeCounts, type) || (action.id && outcomeIds.has(action.id))) continue;
    const actionAt = parseDashboardDate(action.at);
    const matchingLegacyOutcome = censusOutcomes.find(outcome => {
      if (outcome.id && outcomeIds.has(`matched:${outcome.id}`)) return false;
      if (String(outcome.tipo || "").toUpperCase() !== type) return false;
      if (Number(outcome.bedId) !== Number(action.meta?.bedId)) return false;
      const outcomeAt = parseDashboardDate(outcome.createdAt);
      return actionAt && outcomeAt && Math.abs(actionAt.getTime() - outcomeAt.getTime()) <= 60000;
    });
    if (matchingLegacyOutcome) {
      outcomeIds.add(`matched:${matchingLegacyOutcome.id}`);
      continue;
    }
    outcomeCounts[type] += 1;
  }

  const transferenciasInternas = transferActions.filter(action =>
    Number(action.meta?.fromWardId) === Number(ward.id)
    && Number(action.meta?.fromWardId) !== Number(action.meta?.toWardId)
  ).length;
  const procedureFields = {
    SVD: "svd_realizadas",
    CVC: "cvc_realizadas",
    SNE: "sne_realizadas",
    INTUBACAO: "intubacoes_realizadas"
  };
  const procedureCounts = Object.fromEntries(Object.values(procedureFields).map(field => [field, 0]));
  for (const procedure of getWardCensusProcedures(ward)) {
    const createdAt = parseDashboardDate(procedure.createdAt);
    const procedureType = String(procedure.tipo || "").trim().toUpperCase();
    const field = procedureFields[procedureType];
    if (field && createdAt && createdAt >= periodStart && createdAt < periodEnd) {
      procedureCounts[field] += 1;
    }
  }
  const blockedBeds = ward.beds.filter(bed =>
    getDashboardBedStatusAt(ward, bed, asOf, censusContext.bedActionHistory) === "BLOQUEADO"
  ).length;

  return {
    pacientes: activePatients.size,
    leitos: Array.isArray(ward.beds) ? ward.beds.length : 0,
    altas: outcomeCounts.ALTA,
    obitos: outcomeCounts.OBITO,
    transferencias_externas: outcomeCounts.TRANSFERENCIA_EXTERNA,
    transferencias_internas: transferenciasInternas,
    leitos_bloqueados: blockedBeds,
    ...procedureCounts,
    evasoes: outcomeCounts.EVASAO
  };
}

function refreshAutomaticCensusReports(now = new Date()) {
  const periodsByWard = new Map();
  for (const user of users) {
    const shifts = [
      ...getUserActiveShifts(user),
      ...(Array.isArray(user.shifts) ? user.shifts : [])
    ];
    for (const shift of shifts) {
      const wardId = Number(shift?.wardId);
      if (!Number.isInteger(wardId) || shift.serviceType) continue;
      const isActiveShift = !shift.closedAt;
      const openedAt = parseDashboardDate(shift.openedAt)
        || parseDashboardDate(shift.shiftDate ? `${shift.shiftDate}T07:00:00` : "");
      const closedAt = parseDashboardDate(shift.closedAt) || (isActiveShift ? now : null);
      if (!openedAt || !closedAt || closedAt < openedAt) continue;
      const lastIncludedAt = closedAt > openedAt
        ? new Date(closedAt.getTime() - 1)
        : closedAt;
      const period = getCensusPeriodBounds(openedAt);
      while (period.start <= lastIncludedAt) {
        const startDate = getOperationalDayKey(period.start);
        if (!periodsByWard.has(wardId)) periodsByWard.set(wardId, new Set());
        periodsByWard.get(wardId).add(startDate);
        period.start.setDate(period.start.getDate() + 1);
      }
    }
  }

  if (!periodsByWard.size) return false;
  const context = {
    admissions: getDashboardAdmissions(wards),
    bedActionHistory: getDashboardBedActionHistory(),
    actions: getAllUserActions()
  };
  const updatedAt = now.toISOString();
  let changed = false;
  for (const [wardId, periodDates] of periodsByWard) {
    const targetWard = wards.find(item => Number(item.id) === wardId);
    if (!targetWard) continue;
    for (const periodStartDate of periodDates) {
      const periodStart = new Date(`${periodStartDate}T12:00:00`);
      periodStart.setDate(periodStart.getDate() + 1);
      const periodEndDate = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, "0")}-${String(periodStart.getDate()).padStart(2, "0")}`;
      const values = getCensusValuesForPeriod(targetWard, periodStartDate, periodEndDate, context);
      const fullValues = Object.fromEntries(censusFieldNames.map(field => [field, 0]));
      Object.assign(fullValues, values);
      let report = censusDailyReports.find(item =>
        Number(item.wardId) === wardId && item.periodStartDate === periodStartDate
      );
      if (!report) {
        report = {
          id: createRecordId(),
          wardId,
          periodStartDate,
          createdAt: updatedAt
        };
        censusDailyReports.unshift(report);
      }

      const valuesChanged = JSON.stringify(report.values || {}) !== JSON.stringify(fullValues);
      const metadataChanged = report.wardName !== targetWard.nome
        || report.periodEndDate !== periodEndDate
        || report.authorName !== "Atualizado automaticamente"
        || !report.automated;
      if (!valuesChanged && !metadataChanged) continue;
      changed = true;
      report.wardName = targetWard.nome;
      report.periodEndDate = periodEndDate;
      report.authorUsername = "system";
      report.authorName = "Atualizado automaticamente";
      report.shiftId = null;
      report.values = fullValues;
      report.submittedAt = updatedAt;
      report.automated = true;
    }
  }
  return changed;
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

function parseDashboardDate(value, endOfDay = false) {
  const raw = String(value || "").trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDashboardAdmissionSegments(admission) {
  const transfers = (Array.isArray(admission?.transferHistory) ? admission.transferHistory : [])
    .filter(transfer => parseDashboardDate(transfer?.at))
    .sort((a, b) => parseDashboardDate(a.at) - parseDashboardDate(b.at));
  let wardId = transfers.length ? transfers[0].fromWardId : admission?.wardId;
  let wardNome = transfers.length ? transfers[0].fromWardNome : admission?.wardNome;
  let bedId = transfers.length ? transfers[0].fromBedId : admission?.bedId;
  let startAt = admission?.admittedAt || admission?.admissionEventAt || "";
  const segments = [];

  for (const transfer of transfers) {
    segments.push({
      wardId: Number(wardId) || null,
      wardNome: wardNome || "",
      bedId: Number(bedId) || null,
      startAt,
      endAt: transfer.at
    });
    wardId = transfer.toWardId;
    wardNome = transfer.toWardNome;
    bedId = transfer.toBedId;
    startAt = transfer.at;
  }

  segments.push({
    wardId: Number(wardId) || null,
    wardNome: wardNome || "",
    bedId: Number(bedId) || null,
    startAt,
    endAt: admission?.dischargedAt || ""
  });
  return segments;
}

function getDashboardAdmissions(sourceWards) {
  const admissionsByKey = new Map();

  for (const patient of patientRegistry) {
    if (!patient || patient.deletedAt) continue;
    const entries = [
      ...(Array.isArray(patient.admissionHistory) ? patient.admissionHistory : []),
      ...(patient.currentAdmission ? [patient.currentAdmission] : [])
    ];
    for (const admission of entries) {
      if (!admission) continue;
      const key = String(admission.id || [
        patient.id,
        admission.admittedAt || admission.admissionEventAt || "",
        admission.wardId || "",
        admission.bedId || ""
      ].join("|"));
      const existing = admissionsByKey.get(key);
      admissionsByKey.set(key, {
        ...existing,
        ...admission,
        id: key,
        patientId: patient.id,
        patientName: patient.nome || "",
        diagnosis: patient.diagnostico || ""
      });
    }
  }

  for (const ward of sourceWards) {
    for (const bed of ward.beds || []) {
      if (!isBedOccupiedByPatient(bed)) continue;
      const patient = findPatientByCurrentLocation(ward.id, bed.id) || findPatientRegistryEntry(bed);
      const activeAdmission = patient?.currentAdmission;
      if (activeAdmission
        && Number(activeAdmission.wardId) === Number(ward.id)
        && Number(activeAdmission.bedId) === Number(bed.id)
        && !activeAdmission.dischargedAt) {
        continue;
      }

      const key = `bed:${patient?.id || getPatientIdentityKey(bed)}:${ward.id}:${bed.id}:${bed.admissao || ""}`;
      admissionsByKey.set(key, {
        id: key,
        patientId: patient?.id || null,
        patientName: bed.nome || patient?.nome || "",
        diagnosis: bed.diagnostico || patient?.diagnostico || "",
        wardId: ward.id,
        wardNome: ward.nome || "",
        bedId: bed.id,
        admittedAt: bed.admissao || "",
        dischargedAt: null,
        outcome: null,
        transferHistory: []
      });
    }
  }

  return Array.from(admissionsByKey.values()).map(admission => ({
    ...admission,
    segments: getDashboardAdmissionSegments(admission)
  }));
}

function dashboardSegmentAt(admission, instant) {
  return admission.segments.find(segment => {
    const start = parseDashboardDate(segment.startAt);
    const end = parseDashboardDate(segment.endAt);
    return (!start || start <= instant) && (!end || instant < end);
  }) || null;
}

function dashboardSegmentOverlapsPeriod(segment, periodStart, periodEnd) {
  const start = parseDashboardDate(segment.startAt);
  const end = parseDashboardDate(segment.endAt);
  return (!periodStart || !end || end > periodStart)
    && (!periodEnd || !start || start <= periodEnd);
}

function dashboardEventInPeriod(value, periodStart, periodEnd) {
  const eventAt = parseDashboardDate(value);
  return Boolean(eventAt && (!periodStart || eventAt >= periodStart) && (!periodEnd || eventAt <= periodEnd));
}

function getDashboardBedActionHistory() {
  const actionsById = new Map();
  for (const user of users) {
    const shifts = [
      ...getUserActiveShifts(user),
      ...(Array.isArray(user.shifts) ? user.shifts : [])
    ];
    for (const action of [
      ...(Array.isArray(user.actions) ? user.actions : []),
      ...shifts.flatMap(shift => Array.isArray(shift.actions) ? shift.actions : [])
    ]) {
      if (action?.id) actionsById.set(action.id, action);
    }
  }

  const histories = new Map();
  const addAction = (wardId, bedId, action) => {
    if (!Number(wardId) || !Number(bedId)) return;
    const key = `${wardId}:${bedId}`;
    if (!histories.has(key)) histories.set(key, []);
    histories.get(key).push(action);
  };

  for (const action of actionsById.values()) {
    const meta = action.meta || {};
    const type = String(action.type || "").trim().toUpperCase();
    if (type === "BED_UPDATE") {
      addAction(meta.wardId, meta.bedId, action);
    } else if (type === "BED_TRANSFER") {
      addAction(meta.fromWardId, meta.fromBedId, action);
      addAction(meta.toWardId, meta.toBedId, action);
    } else if (["ALTA", "OBITO", "EVASAO", "TRANSFERENCIA_EXTERNA"].includes(type)) {
      addAction(meta.wardId, meta.bedId, action);
    }
  }

  for (const actions of histories.values()) {
    actions.sort((a, b) => parseDashboardDate(b.at) - parseDashboardDate(a.at));
  }
  return histories;
}

function getDashboardBedStatusAt(ward, bed, instant, actionHistory) {
  let status = String(bed.status || "LIVRE").toUpperCase();
  const key = `${ward.id}:${bed.id}`;
  const futureActions = (actionHistory.get(key) || []).filter(action => {
    const at = parseDashboardDate(action.at);
    return at && at > instant;
  });

  for (const action of futureActions) {
    const meta = action.meta || {};
    const type = String(action.type || "").trim().toUpperCase();
    if (type === "BED_UPDATE") {
      if (meta.previousStatus) status = String(meta.previousStatus).toUpperCase();
      continue;
    }

    if (type === "BED_TRANSFER") {
      if (Number(meta.fromWardId) === Number(ward.id) && Number(meta.fromBedId) === Number(bed.id)) {
        status = String(meta.fromPreviousStatus || "OCUPADO").toUpperCase();
      } else if (Number(meta.toWardId) === Number(ward.id) && Number(meta.toBedId) === Number(bed.id)) {
        status = String(meta.toPreviousStatus || "LIVRE").toUpperCase();
      }
      continue;
    }

    if (["ALTA", "OBITO", "EVASAO", "TRANSFERENCIA_EXTERNA"].includes(type)
      && Number(meta.wardId) === Number(ward.id)
      && Number(meta.bedId) === Number(bed.id)) {
      status = "OCUPADO";
    }
  }
  return status;
}

function dashboardAdmissionOutcome(admission) {
  const outcome = String(admission?.outcome || "").trim().toUpperCase();
  if (outcome === "ALTA" || outcome === "OBITO" || outcome === "EVASAO" || outcome === "TRANSFERENCIA_EXTERNA") {
    return outcome;
  }
  return "";
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

/*app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Usuário ou senha inválidos" });
  clearSessionsForUsername(user.username);
  const sid = createSession(user.username);
  res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  res.json({ ok: true, username: user.username, sid, user: sanitizeUser(user) });
});*/

app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        error: "Informe usuário e senha"
      });
    }

    if (!Array.isArray(users)) {
      console.error("LOGIN: lista de usuários indisponível");
      return res.status(503).json({
        error: "Serviço de autenticação indisponível"
      });
    }

    const user = users.find(
      u => u.username === username &&
           u.password === password
    );

    if (!user) {
      return res.status(401).json({
        error: "Usuário ou senha inválidos"
      });
    }

    clearSessionsForUsername(user.username);

    const sid = createSession(user.username);

    res.cookie("sid", sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 43200000
    });

    return res.json({
      ok: true,
      username: user.username,
      sid,
      user: sanitizeUser(user)
    });

  } catch (error) {
    console.error("ERRO NA API DE LOGIN:", error);

    return res.status(500).json({
      error: "Erro interno ao realizar login"
    });
  }
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
  const session = sid ? resolveSession(sid) : null;
  if (!session) return res.status(401).json({ error: "Não autenticado" });
  const user = users.find(item => item.username === session.username);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  res.json({ user: sanitizeUser(user) });
});

app.post("/api/me/password", requireAuth, async (req, res) => {
  const password = String(req.body?.password || "");
  if (password.length < 6) {
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
  }
  if (password === "123456" || password === req.user.password) {
    return res.status(400).json({ error: "Escolha uma senha diferente da senha provisória e da senha atual." });
  }

  req.user.password = password;
  req.user.mustChangePassword = false;
  addUserAction(req.user, "PASSWORD_CHANGE", "Alterou a própria senha");
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user) });
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
  const nome = String(req.body?.nome || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const role = String(req.body?.role || "").trim().toLowerCase();
  const allowedRoles = ["enfermeiro", "coordenador", "psicologo", "servico_social", "admin"];

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (!username) return res.status(400).json({ error: "Usuário é obrigatório" });
  if (cpf.length !== 11) return res.status(400).json({ error: "Informe um CPF com 11 dígitos." });
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: "Selecione uma função válida." });
  if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Já existe um usuário com esse login" });
  }
  if (users.some(user => normalizeCpf(user.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe um profissional com esse CPF." });
  }

  const user = {
    id: getNextUserId(),
    username,
    password: "123456",
    nome,
    cpf,
    birthDate: "",
    role,
    mustChangePassword: true,
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
  const cpf = normalizeCpf(req.body?.cpf);
  const role = String(req.body?.role || "").trim().toLowerCase();
  const allowedRoles = ["enfermeiro", "coordenador", "psicologo", "servico_social", "admin"];

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  if (!username) return res.status(400).json({ error: "Usuário é obrigatório" });
  if (cpf.length !== 11) return res.status(400).json({ error: "Informe um CPF com 11 dígitos." });
  if (!allowedRoles.includes(role)) return res.status(400).json({ error: "Selecione uma função válida." });
  if (users.some(item => item.id !== user.id && item.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Já existe um usuário com esse login" });
  }
  if (users.some(item => item.id !== user.id && normalizeCpf(item.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe um profissional com esse CPF." });
  }

  const oldUsername = user.username;
  user.nome = nome;
  user.username = username;
  user.cpf = cpf;
  user.role = role;

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

app.post("/api/users/:userId/password/reset", requireAuth, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const user = users.find(item => Number(item.id) === userId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

  user.password = "123456";
  user.mustChangePassword = true;
  clearSessionsForUsername(user.username);
  addUserAction(req.user, "PASSWORD_RESET", `Redefiniu a senha de ${user.nome || user.username}`, {
    userId: user.id,
    username: user.username
  });
  await persistState();
  res.json({ ok: true });
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

app.get("/api/portaria/visitors", requireAuth, (req, res) => {
  const items = visitorRegistryEntries
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  res.json({ visitors: items.map(visitorRegistryEntryForClient) });
});

app.get("/api/psychology/requests/manual", requireAuth, (req, res) => {
  const items = psychologyManualRequests
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  res.json({ requests: items.map(psychologyManualRequestForClient) });
});

app.patch("/api/psychology/requests/manual/:requestId", requireAuth, async (req, res) => {
  const requestId = String(req.params?.requestId || "").trim();
  const entry = psychologyManualRequests.find(item => String(item.id || "").trim() === requestId);
  if (!entry) {
    return res.status(404).json({ error: "Solicitacao avulsa da Psicologia nao encontrada." });
  }

  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const nextStatus = String(req.body?.status || entry.status || "EM_ACOMPANHAMENTO").trim().toUpperCase();
  const finalStatus = nextStatus === "BAIXA" ? "BAIXA" : "EM_ACOMPANHAMENTO";
  if (finalStatus === "BAIXA" && String(entry.status || "").trim().toUpperCase() === "BAIXA") {
    return res.json({ ok: true, alreadyClosed: true, request: psychologyManualRequestForClient(entry) });
  }

  entry.interventions = String(req.body?.interventions || "").trim();
  entry.observation = String(req.body?.observation || "").trim();
  entry.notes = req.body?.notes === undefined ? String(entry.notes || "").trim() : String(req.body?.notes || "").trim();
  entry.status = finalStatus;
  entry.updatedAt = now;
  entry.updatedBy = actor;
  entry.closedAt = finalStatus === "BAIXA" ? now : "";
  entry.closedBy = finalStatus === "BAIXA" ? actor : "";

  const manualPsychologyShift = getUserActiveShiftOfType(req.user, "PSICOLOGIA");
  if (finalStatus !== "BAIXA" && manualPsychologyShift) {
    const manualClaimKey = getPsychologyAttendanceKey({ shiftId: manualPsychologyShift.id, manualRequestId: entry.id });
    const existingManualClaim = psychologyAttendanceEntries.find(item => getPsychologyAttendanceKey(item) === manualClaimKey);
    if (req.body?.attended === true || existingManualClaim) {
      upsertPsychologyAttendanceEntry({
        id: createRecordId(),
        shiftId: manualPsychologyShift.id,
        manualRequestId: entry.id,
        patientName: entry.patientName || "",
        patientBirthDate: entry.birthDate || "",
        wardName: entry.sectorOrReason || "",
        status: "EM_ACOMPANHAMENTO",
        interventions: entry.interventions,
        observation: entry.observation || entry.notes || "",
        createdAt: existingManualClaim?.createdAt || now,
        createdBy: existingManualClaim?.createdBy || actor
      }, { preserveDischarge: true });
    }
  }

  if (finalStatus === "BAIXA") {
    upsertPsychologyAttendanceEntry({
      id: createRecordId(),
      shiftId: manualPsychologyShift?.id || null,
      manualRequestId: entry.id,
      patientId: null,
      patientName: entry.patientName || "",
      patientBirthDate: entry.birthDate || "",
      wardId: null,
      wardName: entry.sectorOrReason || "",
      bedId: null,
      status: finalStatus,
      interventions: entry.interventions,
      observation: entry.observation || entry.notes || "",
      createdAt: now,
      createdBy: actor
    });
  }

  addUserAction(req.user, "PSYCHOLOGY_MANUAL_REQUEST_UPDATE", `Atualizou solicitacao avulsa da Psicologia para ${entry.patientName}`, {
    requestId: entry.id,
    patientName: entry.patientName,
    status: entry.status
  });

  await persistState();
  res.json({ ok: true, request: psychologyManualRequestForClient(entry) });
});

app.delete("/api/psychology/requests/manual/:requestId", requireAuth, async (req, res) => {
  const authorizingAdmin = authorizeAdminPassword(req, res);
  if (!authorizingAdmin) return;
  const requestId = String(req.params?.requestId || "").trim();
  const index = psychologyManualRequests.findIndex(item =>
    String(item.id || "").trim() === requestId
    && String(item.status || "").trim().toUpperCase() !== "BAIXA"
  );
  if (index < 0) {
    return res.status(404).json({ error: "Solicitação avulsa ativa da Psicologia não encontrada." });
  }
  const [entry] = psychologyManualRequests.splice(index, 1);
  addUserAction(req.user, "PSYCHOLOGY_MANUAL_REQUEST_DELETE", `Excluiu solicitação avulsa da Psicologia de ${entry.patientName}`, {
    requestId: entry.id,
    patientName: entry.patientName,
    authorizedBy: authorizingAdmin.nome || authorizingAdmin.username || "Administrador"
  });
  await persistState();
  res.json({ ok: true });
});

app.get("/api/attendance-claims/mine", requireAuth, (req, res) => {
  const psychologyShift = getUserActiveShiftOfType(req.user, "PSICOLOGIA");
  const socialShift = getUserActiveShiftOfType(req.user, "SERVICO_SOCIAL");
  const psychologyEntries = psychologyShift
    ? psychologyAttendanceEntries.filter(entry =>
      Number(entry.shiftId) === Number(psychologyShift.id)
      && String(entry.status || "").toUpperCase() === "EM_ACOMPANHAMENTO")
    : [];
  res.json({
    psychologyPatientIds: psychologyEntries.filter(entry => Number(entry.patientId)).map(entry => Number(entry.patientId)),
    psychologyManualIds: psychologyEntries.filter(entry => entry.manualRequestId).map(entry => String(entry.manualRequestId)),
    socialPatientIds: socialShift
      ? patientRegistry
        .filter(patient => !patient.deletedAt && patient.currentAdmission && getSocialPatientClaim(patient, socialShift.id))
        .map(patient => Number(patient.id))
      : [],
    socialManualIds: socialShift
      ? socialServiceManualRequests
        .filter(entry => getSocialManualClaim(entry, socialShift.id))
        .map(entry => String(entry.id))
      : []
  });
});

app.get("/api/psychology/attendances", requireAuth, (req, res) => {
  const month = String(req.query?.month || "").trim();
  const showAll = month.toLowerCase() === "all";
  const includeActive = String(req.query?.includeActive || "").trim().toLowerCase() === "true";
  if (month && !showAll && !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Mês inválido" });
  }

  const selectedMonth = showAll ? "all" : (month || new Date().toISOString().slice(0, 7));
  const itemsMap = new Map();
  const openPsychologyShiftIds = new Set(users.flatMap(user =>
    getUserActiveShifts(user)
      .filter(shift => String(shift.serviceType || "").trim().toUpperCase() === "PSICOLOGIA")
      .map(shift => Number(shift.id))
  ));

  for (const entry of psychologyAttendanceEntries) {
    const normalized = psychologyAttendanceEntryForClient(entry);
    if (!includeActive && (
      normalized.status === "EM_ACOMPANHAMENTO"
      && normalized.shiftId
      && openPsychologyShiftIds.has(normalized.shiftId)
    )) continue;
    if (!showAll && String(normalized.createdAt || "").slice(0, 7) !== selectedMonth) continue;
    const registeredPatient = patientRegistry.find(patient => Number(patient.id) === Number(normalized.patientId));
    itemsMap.set(getPsychologyAttendanceKey(normalized), {
      ...normalized,
      patientBirthDate: String(registeredPatient?.birthDate || "")
    });
  }

  const items = Array.from(itemsMap.values())
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""), "pt-BR")
      || String(a.createdBy || "").localeCompare(String(b.createdBy || ""), "pt-BR")
      || String(a.patientName || "").localeCompare(String(b.patientName || ""), "pt-BR")
    );

  res.json({
    month: selectedMonth,
    attendances: items
  });
});

app.delete("/api/psychology/attendances/:entryId", requireAuth, async (req, res) => {
  const entryId = String(req.params?.entryId || "").trim();
  const adminPassword = String(req.body?.adminPassword || "");
  if (!entryId) return res.status(400).json({ error: "Registro inválido." });
  if (!adminPassword) return res.status(400).json({ error: "Digite a senha de um administrador para apagar." });

  const authorizingAdmin = users.find(user =>
    user.role === "admin" && String(user.password || "") === adminPassword
  );
  if (!authorizingAdmin) {
    return res.status(403).json({ error: "Senha do administrador inválida." });
  }

  const attendance = psychologyAttendanceEntries.find(entry => String(entry.id || "").trim() === entryId);
  if (!attendance) return res.status(404).json({ error: "Registro da Psicologia não encontrado." });

  const index = psychologyAttendanceEntries.indexOf(attendance);
  psychologyAttendanceEntries.splice(index, 1);
  for (const user of users) {
    for (const shift of Array.isArray(user?.shifts) ? user.shifts : []) {
      if (Array.isArray(shift.psychologyAttendanceSnapshot)) {
        shift.psychologyAttendanceSnapshot = shift.psychologyAttendanceSnapshot.filter(
          entry => String(entry?.id || "").trim() !== entryId
        );
      }
      if (Array.isArray(shift.reportSnapshot?.psychologyAttendances)) {
        shift.reportSnapshot.psychologyAttendances = shift.reportSnapshot.psychologyAttendances.filter(
          entry => String(entry?.id || "").trim() !== entryId
        );
      }
    }
  }

  addUserAction(req.user, "PSYCHOLOGY_ATTENDANCE_DELETE", `Apagou registro da Psicologia de ${attendance.patientName || "paciente"}`, {
    entryId,
    patientName: attendance.patientName || "",
    authorizedBy: authorizingAdmin.nome || authorizingAdmin.username || "Administrador"
  });

  await persistState();
  res.json({ ok: true });
});

app.get("/api/social-service/attendances", requireAuth, (req, res) => {
  const month = String(req.query?.month || "").trim();
  const showAll = month.toLowerCase() === "all";
  const includeFollowUps = String(req.query?.includeFollowUps || "").trim().toLowerCase() === "true";
  if (month && !showAll && !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Mês inválido" });
  }

  const selectedMonth = showAll ? "all" : (month || new Date().toISOString().slice(0, 7));
  const itemsMap = new Map();

  const includeItem = rawEntry => {
    const entry = socialServiceAttendanceEntryForClient(rawEntry);
    if (entry.entryType === "observacao_plantao" || (!includeFollowUps && entry.entryType === "acompanhamento")) return;
    const entryMonth = String(entry.closedAt || entry.shiftDate || "").slice(0, 7);
    if (!showAll && entryMonth !== selectedMonth) return;
    const key = [
      entry.entryType || "",
      entry.shiftId || "",
      entry.patientId || "",
      entry.manualRequestId || "",
      entry.patientName || "",
      entry.bedId || "",
      entry.category || "",
      entry.entryLabel || "",
      entry.closedAt || "",
      entry.observation || ""
    ].join("|");
    itemsMap.set(key, entry);
  };

  for (const patient of patientRegistry) {
    if (patient?.deletedAt) continue;
    for (const rawEntry of buildPatientSocialSupportHistory(patient.socialSupportHistory)) {
      includeItem(rawEntry);
    }
  }

  for (const user of users) {
    for (const shift of Array.isArray(user?.shifts) ? user.shifts : []) {
      for (const entry of buildSocialServiceShiftHistoryEntries(shift, user)) {
        includeItem(entry);
      }
    }
  }

  for (const entry of socialServiceManualAttendanceEntries) {
    includeItem(entry);
  }

  if (includeFollowUps) {
    for (const request of socialServiceManualRequests) {
      for (const claim of Array.isArray(request.claims) ? request.claims : []) {
        includeItem({
          id: `manual-claim-${request.id}-${claim.shiftId}`,
          manualRequestId: request.id,
          patientName: request.patientName || "",
          patientBirthDate: request.birthDate || "",
          patientAgeLabel: getPatientAgeLabel(request.birthDate || ""),
          category: request.category || "",
          wardName: request.sectorOrReason || "",
          contacts: claim.contacts || "",
          admissionDate: request.createdAt || "",
          socialRecord: request.socialRecord || "Pendente",
          observation: claim.observation || "",
          closedAt: claim.at || "",
          closedBy: claim.by || "",
          shiftId: claim.shiftId || null,
          entryType: "acompanhamento",
          entryLabel: "Em acompanhamento"
        });
      }
    }
  }

  const items = Array.from(itemsMap.values()).sort((a, b) =>
    String(b.closedAt || "").localeCompare(String(a.closedAt || ""), "pt-BR")
    || String(a.closedBy || "").localeCompare(String(b.closedBy || ""), "pt-BR")
    || String(a.patientName || "").localeCompare(String(b.patientName || ""), "pt-BR")
  );

  res.json({
    month: selectedMonth,
    attendances: items
  });
});

app.get("/api/social-service/requests/manual", requireAuth, (req, res) => {
  const items = socialServiceManualRequests
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  res.json({ requests: items.map(socialServiceManualRequestForClient) });
});

app.post("/api/social-service/requests/manual", requireAuth, async (req, res) => {
  if (String(req.user.activeShift?.serviceType || "").trim().toUpperCase() !== "SERVICO_SOCIAL") {
    return res.status(403).json({ error: "Abra o plantão do Serviço Social para cadastrar uma solicitação avulsa." });
  }
  const patientName = String(req.body?.patientName || "").trim();
  const category = String(req.body?.category || "AVULSO").trim().toUpperCase();
  const birthDate = String(req.body?.birthDate || "").trim();
  const sectorOrReason = String(req.body?.sectorOrReason || "").trim();
  const notes = String(req.body?.notes || "").trim();

  if (!patientName) return res.status(400).json({ error: "Informe o nome da pessoa ou paciente" });
  if (!sectorOrReason) return res.status(400).json({ error: "Informe o setor ou motivo" });
  if (!["AVULSO", "ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(category)) {
    return res.status(400).json({ error: "Selecione um tipo válido de atendimento avulso." });
  }

  const now = new Date().toISOString();
  const entry = {
    id: createRecordId(),
    category,
    patientName,
    birthDate,
    sectorOrReason,
    notes,
    contacts: "",
    socialRecord: "Pendente",
    observation: "",
    status: "SOLICITADO",
    createdAt: now,
    createdBy: req.user.nome || req.user.username || "",
    updatedAt: "",
    updatedBy: "",
    closedAt: "",
    closedBy: ""
  };

  socialServiceManualRequests.unshift(entry);

  addUserAction(req.user, "SOCIAL_SERVICE_MANUAL_REQUEST_CREATE", `Registrou solicitacao avulsa para ${patientName}`, {
    patientName,
    category,
    sectorOrReason,
    notes
  });

  await persistState();
  res.json({ ok: true, request: socialServiceManualRequestForClient(entry) });
});

app.patch("/api/social-service/requests/manual/:requestId", requireAuth, async (req, res) => {
  if (String(req.user.activeShift?.serviceType || "").trim().toUpperCase() !== "SERVICO_SOCIAL") {
    return res.status(403).json({ error: "Abra o plantão do Serviço Social para atualizar solicitações avulsas." });
  }
  const requestId = String(req.params?.requestId || "").trim();
  const entry = socialServiceManualRequests.find(item => String(item.id || "").trim() === requestId);
  if (!entry) {
    return res.status(404).json({ error: "Solicitacao avulsa do Serviço Social nao encontrada." });
  }

  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const nextStatus = String(req.body?.status || entry.status || "EM_ACOMPANHAMENTO").trim().toUpperCase();
  const requestedCategory = String(req.body?.category || entry.category || "AVULSO").trim().toUpperCase();
  if (!["SOLICITADO", "EM_ACOMPANHAMENTO", "BAIXA"].includes(nextStatus)) {
    return res.status(400).json({ error: "Status inválido para a solicitação avulsa do Serviço Social." });
  }
  if (!["AVULSO", "ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(requestedCategory)) {
    return res.status(400).json({ error: "Selecione um tipo válido de atendimento avulso." });
  }
  const finalStatus = nextStatus;
  if (finalStatus === "BAIXA" && String(entry.status || "").trim().toUpperCase() === "BAIXA") {
    return res.json({ ok: true, alreadyClosed: true, request: socialServiceManualRequestForClient(entry) });
  }

  entry.contacts = String(req.body?.contacts || "").trim();
  entry.category = requestedCategory;
  entry.socialRecord = normalizeSocialRecordStatus(req.body?.socialRecord || entry.socialRecord || "Pendente");
  entry.observation = String(req.body?.observation || "").trim();
  entry.notes = req.body?.notes === undefined ? String(entry.notes || "").trim() : String(req.body?.notes || "").trim();
  entry.status = finalStatus;
  entry.updatedAt = now;
  entry.updatedBy = actor;
  entry.closedAt = finalStatus === "BAIXA" ? now : "";
  entry.closedBy = finalStatus === "BAIXA" ? actor : "";

  const manualSocialShift = getUserActiveShiftOfType(req.user, "SERVICO_SOCIAL");
  if (finalStatus === "EM_ACOMPANHAMENTO" && manualSocialShift) {
    if (!Array.isArray(entry.claims)) entry.claims = [];
    const existingClaim = getSocialManualClaim(entry, manualSocialShift.id);
    if (req.body?.attended === true || existingClaim) {
      const claim = {
        shiftId: Number(manualSocialShift.id),
        by: existingClaim?.by || actor,
        at: existingClaim?.at || now,
        observation: entry.observation,
        contacts: entry.contacts
      };
      entry.claims = [claim, ...entry.claims.filter(item => Number(item.shiftId) !== Number(manualSocialShift.id))];
    }
  }

  if (finalStatus === "BAIXA") {
    socialServiceManualAttendanceEntries.unshift(socialServiceAttendanceEntryForClient({
      id: createRecordId(),
      patientId: null,
      patientName: entry.patientName || "",
      patientBirthDate: entry.birthDate || "",
      patientAgeLabel: getPatientAgeLabel(entry.birthDate || ""),
      wardId: null,
      wardName: entry.sectorOrReason || "",
      bedId: null,
      contacts: entry.contacts || "",
      category: entry.category || "",
      admissionDate: entry.createdAt || "",
      socialRecord: entry.socialRecord || "Pendente",
      observation: entry.observation || entry.notes || "",
      closedAt: now,
      closedBy: actor,
      shiftId: manualSocialShift?.id || null,
      shiftDate: getOperationalDayKey(now),
      shiftLength: "",
      shiftPeriod: "",
      entryType: "baixa",
      entryLabel: entry.category === "ACOMPANHANTE"
        ? "Acompanhante - baixa do atendimento"
        : (entry.category === "FAMILIAR"
          ? "Familiar - baixa do atendimento"
          : (entry.category === "OBITO" ? "Atendimento de óbito" : "Baixa do atendimento"))
    }));
    socialServiceManualAttendanceEntries.splice(3000);
  }

  addUserAction(req.user, "SOCIAL_SERVICE_MANUAL_REQUEST_UPDATE", `Atualizou solicitacao avulsa do Serviço Social para ${entry.patientName}`, {
    requestId: entry.id,
    patientName: entry.patientName,
    status: entry.status
  });

  await persistState();
  res.json({ ok: true, request: socialServiceManualRequestForClient(entry) });
});

app.delete("/api/social-service/requests/manual/:requestId", requireAuth, async (req, res) => {
  const authorizingAdmin = authorizeAdminPassword(req, res);
  if (!authorizingAdmin) return;
  const requestId = String(req.params?.requestId || "").trim();
  const index = socialServiceManualRequests.findIndex(item =>
    String(item.id || "").trim() === requestId
    && String(item.status || "").trim().toUpperCase() !== "BAIXA"
  );
  if (index < 0) {
    return res.status(404).json({ error: "Solicitação avulsa ativa do Serviço Social não encontrada." });
  }
  const [entry] = socialServiceManualRequests.splice(index, 1);
  addUserAction(req.user, "SOCIAL_SERVICE_MANUAL_REQUEST_DELETE", `Excluiu solicitação avulsa do Serviço Social de ${entry.patientName}`, {
    requestId: entry.id,
    patientName: entry.patientName,
    authorizedBy: authorizingAdmin.nome || authorizingAdmin.username || "Administrador"
  });
  await persistState();
  res.json({ ok: true });
});

app.patch("/api/social-service/requests/manual/:requestId/social-form", requireAuth, async (req, res) => {
  if (String(req.user.activeShift?.serviceType || "").trim().toUpperCase() !== "SERVICO_SOCIAL") {
    return res.status(403).json({ error: "Abra o plantão do Serviço Social para salvar a ficha social." });
  }
  const requestId = String(req.params?.requestId || "").trim();
  const entry = socialServiceManualRequests.find(item => String(item.id || "").trim() === requestId);
  if (!entry) {
    return res.status(404).json({ error: "Solicitação avulsa do Serviço Social não encontrada." });
  }
  if (!req.body?.socialForm || typeof req.body.socialForm !== "object" || Array.isArray(req.body.socialForm)) {
    return res.status(400).json({ error: "Informe os dados da ficha social." });
  }

  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const previousForm = buildPatientSocialForm(entry.socialForm);
  const socialForm = buildPatientSocialForm(req.body.socialForm);
  const hasForm = hasPatientSocialFormData(socialForm);
  const formData = form => {
    const data = { ...form };
    delete data.filledAt;
    delete data.filledBy;
    delete data.updatedAt;
    delete data.updatedBy;
    return JSON.stringify(data);
  };
  const formChanged = formData(previousForm) !== formData(socialForm);
  entry.socialForm = {
    ...socialForm,
    filledAt: hasForm ? (previousForm.filledAt || now) : "",
    filledBy: hasForm ? (previousForm.filledBy || actor) : "",
    updatedAt: hasForm ? (formChanged ? now : previousForm.updatedAt) : "",
    updatedBy: hasForm ? (formChanged ? actor : previousForm.updatedBy) : ""
  };
  entry.socialRecord = hasForm ? "Concluído" : "Pendente";
  entry.updatedAt = now;
  entry.updatedBy = actor;

  addUserAction(req.user, "SOCIAL_SERVICE_MANUAL_FORM_SAVE", `Salvou a ficha social da solicitação avulsa de ${entry.patientName}`, {
    requestId: entry.id,
    patientName: entry.patientName
  });
  await persistState();
  res.json({ ok: true, request: socialServiceManualRequestForClient(entry) });
});

app.delete("/api/social-service/attendances/:entryId", requireAuth, async (req, res) => {
  const entryId = String(req.params?.entryId || "").trim();
  const adminPassword = String(req.body?.adminPassword || "");
  if (!entryId) {
    return res.status(400).json({ error: "Registro inválido" });
  }
  if (!adminPassword) {
    return res.status(400).json({ error: "Digite a senha de um administrador para apagar." });
  }

  const authorizingAdmin = users.find(user =>
    user.role === "admin" && String(user.password || "") === adminPassword
  );
  if (!authorizingAdmin) {
    return res.status(403).json({ error: "Senha do administrador inválida." });
  }

  const removed = deleteSocialServiceAttendanceEntryById(entryId);
  if (!removed) {
    return res.status(404).json({ error: "Registro do Serviço Social não encontrado." });
  }

  addUserAction(req.user, "SOCIAL_SERVICE_ATTENDANCE_DELETE", "Apagou um registro do histórico do Serviço Social", {
    entryId,
    authorizedBy: authorizingAdmin.nome || authorizingAdmin.username || "Administrador"
  });

  await persistState();
  res.json({ ok: true });
});

app.get("/api/hospital-trips", requireAuth, (req, res) => {
  const items = hospitalTripEntries
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  res.json({ trips: items.map(hospitalTripEntryForClient) });
});

app.get("/api/hospital-trips/cities", requireAuth, async (req, res) => {
  try {
    const cities = await loadMaranhaoCities();
    res.json({
      originLabel: HOSPITAL_TRIP_ORIGIN_LABEL,
      originCity: HOSPITAL_TRIP_ORIGIN_CITY,
      cities
    });
  } catch (error) {
    console.error("Falha ao carregar cidades do Maranhao", error);
    res.status(502).json({ error: "Nao foi possivel carregar a lista de cidades do Maranhao" });
  }
});

app.get("/api/hospital-trips/estimate", requireAuth, async (req, res) => {
  const destination = String(req.query?.destination || "").trim();
  if (!destination) return res.status(400).json({ error: "Informe a cidade de destino" });

  try {
    const estimate = await estimateHospitalTripDistance(destination);
    res.json({
      originLabel: HOSPITAL_TRIP_ORIGIN_LABEL,
      ...estimate
    });
  } catch (error) {
    console.error("Falha ao calcular distancia da viagem", error);
    res.status(502).json({ error: error.message || "Nao foi possivel calcular a distancia da viagem" });
  }
});

app.post("/api/portaria/visitors", requireAuth, async (req, res) => {
  const accessCode = String(req.body?.accessCode || "").trim();
  const visitorName = String(req.body?.visitorName || "").trim();
  const sectorOrReason = String(req.body?.sectorOrReason || "").trim();

  if (!accessCode) return res.status(400).json({ error: "Informe o codigo de acesso" });
  if (!visitorName) return res.status(400).json({ error: "Informe o nome do visitante" });
  if (!sectorOrReason) return res.status(400).json({ error: "Informe o setor ou motivo" });

  const now = new Date().toISOString();
  const entry = {
    id: createRecordId(),
    accessCode,
    visitorName,
    sectorOrReason,
    createdAt: now,
    createdBy: req.user.nome || req.user.username || ""
  };

  visitorRegistryEntries.unshift(entry);

  addUserAction(req.user, "PORTARIA_VISITOR_CREATE", `Registrou visitante ${visitorName} na portaria`, {
    accessCode,
    visitorName,
    sectorOrReason
  });

  await persistState();
  res.json({ ok: true, visitor: visitorRegistryEntryForClient(entry) });
});

app.post("/api/psychology/requests/manual", requireAuth, async (req, res) => {
  const patientName = String(req.body?.patientName || "").trim();
  const birthDate = String(req.body?.birthDate || "").trim();
  const sectorOrReason = String(req.body?.sectorOrReason || "").trim();
  const notes = String(req.body?.notes || "").trim();

  if (!patientName) return res.status(400).json({ error: "Informe o nome da pessoa ou paciente" });
  if (!sectorOrReason) return res.status(400).json({ error: "Informe o setor ou motivo" });

  const now = new Date().toISOString();
  const entry = {
    id: createRecordId(),
    patientName,
    birthDate,
    sectorOrReason,
    notes,
    contacts: "",
    socialRecord: "Pendente",
    observation: "",
    interventions: "",
    status: "SOLICITADO",
    createdAt: now,
    createdBy: req.user.nome || req.user.username || "",
    updatedAt: "",
    updatedBy: "",
    closedAt: "",
    closedBy: ""
  };

  psychologyManualRequests.unshift(entry);

  addUserAction(req.user, "PSYCHOLOGY_MANUAL_REQUEST_CREATE", `Registrou solicitação avulsa para ${patientName}`, {
    patientName,
    sectorOrReason,
    notes
  });

  await persistState();
  res.json({ ok: true, request: psychologyManualRequestForClient(entry) });
});

app.post("/api/hospital-trips", requireAuth, async (req, res) => {
  const origin = String(req.body?.origin || HOSPITAL_TRIP_ORIGIN_LABEL).trim();
  const destination = String(req.body?.destination || "").trim();
  const patient = buildTravelPerson(req.body?.patient);
  const companion = buildTravelPerson(req.body?.companion);
  let estimatedOneWayKm = toPositiveNumber(req.body?.estimatedOneWayKm);
  let estimatedRoundTripKm = toPositiveNumber(req.body?.estimatedRoundTripKm);
  const hasCompanion = hasTravelPersonData(companion);

  if (!origin) return res.status(400).json({ error: "Informe a origem" });
  if (!destination) return res.status(400).json({ error: "Informe o destino" });
  if (!patient.fullName) return res.status(400).json({ error: "Informe o nome completo do paciente" });
  if (!patient.address) return res.status(400).json({ error: "Informe o endereco do paciente" });
  if (!patient.cpf || patient.cpf.length !== 11) return res.status(400).json({ error: "Informe o CPF do paciente" });
  if (hasCompanion) {
    if (!companion.fullName) return res.status(400).json({ error: "Informe o nome completo do acompanhante" });
    if (!companion.address) return res.status(400).json({ error: "Informe o endereco do acompanhante" });
    if (!companion.cpf || companion.cpf.length !== 11) return res.status(400).json({ error: "Informe o CPF do acompanhante" });
  }

  if (estimatedOneWayKm == null || estimatedRoundTripKm == null) {
    const estimate = await estimateHospitalTripDistance(destination);
    estimatedOneWayKm = estimate.oneWayKm;
    estimatedRoundTripKm = estimate.roundTripKm;
  }

  const patientProcedureUnits = calculateProcedureUnits(estimatedRoundTripKm);
  const companionProcedureUnits = hasCompanion ? calculateProcedureUnits(estimatedRoundTripKm) : 0;

  const entry = {
    id: createRecordId(),
    origin,
    destination,
    kmStart: 0,
    kmEnd: estimatedRoundTripKm ?? 0,
    estimatedOneWayKm,
    estimatedRoundTripKm,
    patient,
    companion,
    patientProcedure: buildTravelProcedure(PATIENT_TRAVEL_PROCEDURE, patientProcedureUnits),
    companionProcedure: buildTravelProcedure(COMPANION_TRAVEL_PROCEDURE, companionProcedureUnits),
    createdAt: new Date().toISOString(),
    createdBy: req.user.nome || req.user.username || ""
  };

  hospitalTripEntries.unshift(entry);

  addUserAction(req.user, "HOSPITAL_TRIP_CREATE", `Registrou viagem de ${origin} para ${destination}`, {
    origin,
    destination,
    estimatedRoundTripKm,
    patient: patient.fullName,
    companion: companion.fullName
  });

  await persistState();
  res.json({ ok: true, trip: hospitalTripEntryForClient(entry) });
});

app.post("/api/patients", requireAuth, async (req, res) => {
  const nome = String(req.body?.nome || "").trim();
  const cpf = normalizeCpf(req.body?.cpf);
  const birthDate = String(req.body?.birthDate || "").trim();
  const phone = normalizePhone(req.body?.phone);
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

  const patient = createEmptyPatientRecord({ nome, cpf, birthDate, phone, nir, cil, regulationChannels, regulationAcceptedAt });
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

  const accessCode = String(req.body?.accessCode || "").trim();
  const visitorName = String(req.body?.visitorName || "").trim();
  const kinship = String(req.body?.kinship || "").trim();
  const visitedPersonName = String(patient.nome || "").trim();
  const visitDate = String(req.body?.visitDate || "").trim();
  const visitShift = String(req.body?.visitShift || "").trim().toUpperCase();
  const visitTime = String(req.body?.visitTime || "").trim();
  const note = String(req.body?.note || "").trim();

  if (!accessCode) return res.status(400).json({ error: "Informe o codigo de acesso" });
  if (!visitorName) return res.status(400).json({ error: "Informe o nome do visitante" });
  if (!kinship) return res.status(400).json({ error: "Informe o grau de parentesco" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return res.status(400).json({ error: "Informe a data da visita" });
  if (!["MANHA", "TARDE", "NOITE"].includes(visitShift)) return res.status(400).json({ error: "Selecione o turno da visita" });
  if (!/^\d{2}:\d{2}$/.test(visitTime)) return res.status(400).json({ error: "Informe o horário da visita" });

  const now = new Date().toISOString();
  const visit = {
    id: createRecordId(),
    accessCode,
    visitorName,
    kinship,
    visitedPersonName,
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
    accessCode,
    visitorName,
    kinship,
    visitedPersonName,
    visitDate,
    visitShift,
    visitTime
  });

  await persistState();
  res.json({ ok: true, visit, patient: patientForClient(patient) });
});

app.patch("/api/patients/:patientId/social-support", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const now = new Date().toISOString();
  const previousSupport = buildPatientSocialSupport(patient.socialSupport);
  const actor = req.user.nome || req.user.username || "";
  const requestedServiceStatus = String(
    req.body?.status || patient.currentAdmission?.serviceSocialRequest?.status || ""
  ).trim().toUpperCase();
  if (requestedServiceStatus && !["SOLICITADO", "EM_ACOMPANHAMENTO"].includes(requestedServiceStatus)) {
    return res.status(400).json({ error: "Selecione um status válido. Use Dar baixa para finalizar o atendimento." });
  }
  const nextSocialRecord = normalizeSocialRecordStatus(req.body?.socialRecord);
  const socialRecordUpdatedAt = nextSocialRecord === "Concluído"
    ? (previousSupport.socialRecord === "Concluído" && previousSupport.socialRecordUpdatedAt ? previousSupport.socialRecordUpdatedAt : now)
    : "";
  const socialRecordUpdatedBy = nextSocialRecord === "Concluído"
    ? (previousSupport.socialRecord === "Concluído" && previousSupport.socialRecordUpdatedBy ? previousSupport.socialRecordUpdatedBy : actor)
    : "";
  const shouldUpdateSocialForm = req.body?.socialForm && typeof req.body.socialForm === "object";
  const previousSocialForm = buildPatientSocialForm(previousSupport.socialForm);
  const mergedSocialForm = buildPatientSocialForm(shouldUpdateSocialForm
    ? {
      ...previousSocialForm,
      ...req.body.socialForm,
      familyContacts: Array.isArray(req.body.socialForm?.familyContacts)
        ? req.body.socialForm.familyContacts
        : previousSocialForm.familyContacts,
      benefits: Array.isArray(req.body.socialForm?.benefits)
        ? req.body.socialForm.benefits
        : previousSocialForm.benefits,
      profileTags: Array.isArray(req.body.socialForm?.profileTags)
        ? req.body.socialForm.profileTags
        : previousSocialForm.profileTags
    }
    : previousSocialForm);
  const hasPreviousSocialForm = hasPatientSocialFormData(previousSocialForm);
  const hasCurrentSocialForm = hasPatientSocialFormData(mergedSocialForm);
  const formDataForComparison = form => {
    const formData = { ...form };
    delete formData.filledAt;
    delete formData.filledBy;
    delete formData.updatedAt;
    delete formData.updatedBy;
    return JSON.stringify(formData);
  };
  const socialFormChanged = shouldUpdateSocialForm
    && formDataForComparison(previousSocialForm) !== formDataForComparison(mergedSocialForm);
  patient.socialSupport = buildPatientSocialSupport({
    contacts: req.body?.contacts,
    admissionNotes: req.body?.admissionNotes,
    socialRecord: nextSocialRecord,
    observation: req.body?.observation,
    socialForm: {
      ...mergedSocialForm,
      filledAt: hasCurrentSocialForm
        ? (hasPreviousSocialForm && previousSocialForm.filledAt ? previousSocialForm.filledAt : now)
        : "",
      filledBy: hasCurrentSocialForm
        ? (hasPreviousSocialForm && previousSocialForm.filledBy ? previousSocialForm.filledBy : actor)
        : "",
      updatedAt: hasCurrentSocialForm
        ? (socialFormChanged ? now : previousSocialForm.updatedAt)
        : "",
      updatedBy: hasCurrentSocialForm
        ? (socialFormChanged ? actor : previousSocialForm.updatedBy)
        : ""
    },
    dischargePending: previousSupport.dischargePending,
    dischargeNote: previousSupport.dischargeNote,
    dischargeAt: previousSupport.dischargeAt,
    dischargeBy: previousSupport.dischargeBy,
    socialRecordUpdatedAt,
    socialRecordUpdatedBy,
    updatedAt: now,
    updatedBy: actor
  });
  if (patient.currentAdmission) {
    const requestWard = wards.find(item => Number(item.id) === Number(patient.currentAdmission.wardId));
    const requestBed = requestWard?.beds?.find(item => Number(item.id) === Number(patient.currentAdmission.bedId)) || null;
    const currentRequest = requestBed?.serviceSocialRequest || patient.currentAdmission.serviceSocialRequest || {};
    const nextRequest = requestedServiceStatus === "SOLICITADO"
      ? buildBedRequestState({
        ...currentRequest,
        requested: true,
        viewedAt: "",
        viewedBy: "",
        startedAt: "",
        startedBy: "",
        closedAt: "",
        closedBy: "",
        status: "SOLICITADO"
      })
      : buildStartedBedRequestState({
        ...currentRequest,
        ...(String(currentRequest.status || "").trim().toUpperCase() === "BAIXA"
          ? { status: "", closedAt: "", closedBy: "" }
          : {})
      }, actor, now);
    patient.currentAdmission.serviceSocialRequest = nextRequest;
    const socialShift = getUserActiveShifts(req.user).find(shift =>
      String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
    );
    const admissionDate = String(patient.currentAdmission.admittedAt || "");
    const isSameFollowUp = entry =>
      entry?.entryType === "acompanhamento"
      && Number(entry.shiftId) === Number(socialShift?.id)
      && String(entry.admissionDate || "") === admissionDate;
    if (!Array.isArray(patient.socialSupportHistory)) patient.socialSupportHistory = [];
    if (socialShift && requestedServiceStatus === "EM_ACOMPANHAMENTO"
      && (req.body?.attended === true || patient.socialSupportHistory.some(isSameFollowUp))) {
      const existing = patient.socialSupportHistory.find(isSameFollowUp);
      const followUp = socialServiceAttendanceEntryForClient({
        ...(existing || {}),
        id: existing?.id || createRecordId(),
        patientId: patient.id,
        patientName: patient.nome || "",
        patientBirthDate: patient.birthDate || "",
        wardId: patient.currentAdmission.wardId || null,
        wardName: patient.currentAdmission.wardNome || "",
        bedId: patient.currentAdmission.bedId || null,
        contacts: patient.socialSupport.contacts || patient.phone || "",
        admissionDate,
        socialRecord: patient.socialSupport.socialRecord,
        observation: patient.socialSupport.observation,
        closedAt: existing?.closedAt || now,
        closedBy: existing?.closedBy || actor,
        shiftId: socialShift.id,
        shiftDate: socialShift.shiftDate || getOperationalDayKey(now),
        shiftLength: socialShift.shiftLength || "",
        shiftPeriod: socialShift.shiftPeriod || "",
        entryType: "acompanhamento",
        entryLabel: "Em acompanhamento"
      });
      patient.socialSupportHistory = existing
        ? patient.socialSupportHistory.map(entry => isSameFollowUp(entry) ? followUp : entry)
        : [followUp, ...patient.socialSupportHistory].slice(0, 300);
    } else if (socialShift && requestedServiceStatus === "SOLICITADO") {
      patient.socialSupportHistory = patient.socialSupportHistory.filter(entry => !isSameFollowUp(entry));
    }
    const ward = wards.find(item => Number(item.id) === Number(patient.currentAdmission?.wardId));
    const bed = ward?.beds?.find(item => Number(item.id) === Number(patient.currentAdmission?.bedId)) || null;
    if (bed) {
      normalizeBedData(bed);
      bed.serviceSocialRequest = nextRequest;
    }
  }
  patient.updatedAt = now;

  addUserAction(req.user, "PATIENT_SOCIAL_SUPPORT_UPDATE", `Atualizou o acompanhamento social do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    active: Boolean(patient.currentAdmission)
  });

  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.delete("/api/patients/:patientId/social-support/request", requireAuth, async (req, res) => {
  const authorizingAdmin = authorizeAdminPassword(req, res);
  if (!authorizingAdmin) return;
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  const admission = patient.currentAdmission;
  if (!admission) {
    return res.status(404).json({ error: "O paciente não possui uma solicitação ativa do Serviço Social." });
  }
  const ward = wards.find(item => Number(item.id) === Number(admission.wardId));
  const bed = ward?.beds?.find(item => Number(item.id) === Number(admission.bedId)) || null;
  if (bed) normalizeBedData(bed);
  const currentRequest = bed?.serviceSocialRequest || admission.serviceSocialRequest || {};
  if (String(currentRequest.status || "").trim().toUpperCase() === "BAIXA" || currentRequest.closedAt) {
    return res.status(409).json({ error: "A solicitação do Serviço Social já foi finalizada e não pode ser excluída da fila." });
  }
  if (!currentRequest.requested) {
    return res.status(404).json({ error: "A solicitação ativa do Serviço Social não foi encontrada." });
  }
  const clearedRequest = buildBedRequestState({
    requested: false,
    observation: currentRequest.observation || "",
    status: ""
  });
  admission.serviceSocialRequest = clearedRequest;
  if (bed) bed.serviceSocialRequest = clearedRequest;
  patient.updatedAt = new Date().toISOString();
  addUserAction(req.user, "PATIENT_SOCIAL_SUPPORT_REQUEST_DELETE", `Excluiu da fila a solicitação do Serviço Social de ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    authorizedBy: authorizingAdmin.nome || authorizingAdmin.username || "Administrador"
  });
  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.post("/api/patients/:patientId/social-support/close", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  const activeOrLastAdmission = patient.currentAdmission || (Array.isArray(patient.admissionHistory) ? patient.admissionHistory[0] : null);
  if (!activeOrLastAdmission) {
    return res.status(400).json({ error: "O paciente nao possui internacao registrada para finalizar o acompanhamento." });
  }

  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const previousSupport = buildPatientSocialSupport(patient.socialSupport);
  const category = String(req.body?.category || "").trim().toUpperCase();
  if (category && category !== "OBITO") {
    return res.status(400).json({ error: "Tipo de atendimento inválido para a finalização." });
  }
  const activeShift = String(req.user.activeShift?.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
    ? req.user.activeShift
    : null;
  const ward = wards.find(item => Number(item.id) === Number(activeOrLastAdmission?.wardId));
  const bed = ward?.beds?.find(item => Number(item.id) === Number(activeOrLastAdmission?.bedId)) || null;
  if (bed) normalizeBedData(bed);
  const currentRequest = bed?.serviceSocialRequest || activeOrLastAdmission?.serviceSocialRequest || {};
  if (String(currentRequest.status || "").trim().toUpperCase() === "BAIXA" || currentRequest.closedAt) {
    const existingAttendance = buildPatientSocialSupportHistory(patient.socialSupportHistory).find(entry =>
      entry.entryType === "baixa"
      && Number(entry.patientId) === Number(patient.id)
      && String(entry.admissionDate || "") === String(activeOrLastAdmission?.admittedAt || "")
    ) || null;
    return res.json({
      ok: true,
      alreadyClosed: true,
      patient: patientForClient(patient),
      attendance: existingAttendance
    });
  }

  const attendance = socialServiceAttendanceEntryForClient({
    id: createRecordId(),
    patientId: patient.id,
    patientName: patient.nome || "",
    patientBirthDate: patient.birthDate || "",
    wardId: activeOrLastAdmission?.wardId || null,
    wardName: activeOrLastAdmission?.wardNome || ward?.nome || "",
    bedId: activeOrLastAdmission?.bedId || null,
    contacts: req.body?.contacts || previousSupport.contacts || patient.phone || "",
    category,
    admissionDate: activeOrLastAdmission?.admittedAt || "",
    socialRecord: "Concluído",
    observation: req.body?.observation || previousSupport.observation || "",
    closedAt: now,
    closedBy: actor,
    shiftId: activeShift?.id || null,
    shiftDate: activeShift?.shiftDate || getOperationalDayKey(now),
    shiftLength: activeShift?.shiftLength || "",
    shiftPeriod: activeShift?.shiftPeriod || "",
    entryLabel: category === "OBITO" ? "Atendimento de óbito" : "Baixa do atendimento"
  });

  if (!Array.isArray(patient.socialSupportHistory)) patient.socialSupportHistory = [];
  patient.socialSupportHistory = patient.socialSupportHistory.filter(entry =>
    !(entry?.entryType === "acompanhamento"
      && Number(entry.shiftId) === Number(activeShift?.id)
      && String(entry.admissionDate || "") === String(activeOrLastAdmission?.admittedAt || ""))
  );
  patient.socialSupportHistory.unshift(attendance);
  patient.socialSupportHistory = patient.socialSupportHistory.slice(0, 300);

  const closedRequest = buildBedRequestState({
    ...(bed?.serviceSocialRequest || patient.currentAdmission?.serviceSocialRequest || {}),
    requested: false,
    closedAt: now,
    closedBy: actor,
    status: "BAIXA",
    observation: attendance.observation
  });

  if (bed) {
    bed.serviceSocialRequest = closedRequest;
  }

  if (patient.currentAdmission) {
    patient.currentAdmission.serviceSocialRequest = closedRequest;
  }

  patient.socialSupport = buildPatientSocialSupport({
    ...previousSupport,
    dischargePending: false,
    dischargeNote: "",
    dischargeAt: "",
    dischargeBy: "",
    updatedAt: now,
    updatedBy: actor
  });
  patient.updatedAt = now;

  addUserAction(req.user, "PATIENT_SOCIAL_SUPPORT_CLOSE", `Deu baixa no atendimento social do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    attendanceId: attendance.id,
    shiftId: attendance.shiftId
  });

  await persistState();
  res.json({ ok: true, patient: patientForClient(patient), attendance });
});

app.post("/api/patients/:patientId/social-support/companion-attendance", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  const admission = patient.currentAdmission;
  if (!admission) {
    return res.status(400).json({ error: "O paciente não possui internação ativa para registrar atendimento ao acompanhante." });
  }
  const activeShift = getUserActiveShifts(req.user).find(shift =>
    String(shift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
  );
  if (!activeShift) {
    return res.status(403).json({ error: "Abra o plantão do Serviço Social para registrar atendimento ao acompanhante." });
  }
  const companionName = String(req.body?.companionName || "").trim();
  const companionBirthDate = String(req.body?.companionBirthDate || "").trim();
  const companionKinship = String(req.body?.companionKinship || "").trim();
  if (!companionName) return res.status(400).json({ error: "Informe o nome completo do acompanhante." });
  const companionBirthDateValue = new Date(`${companionBirthDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(companionBirthDate)
    || Number.isNaN(companionBirthDateValue.getTime())
    || companionBirthDateValue.toISOString().slice(0, 10) !== companionBirthDate
  ) {
    return res.status(400).json({ error: "Informe uma data de nascimento válida para o acompanhante." });
  }
  if (!companionKinship) return res.status(400).json({ error: "Informe o grau de parentesco do acompanhante." });

  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const attendance = socialServiceAttendanceEntryForClient({
    id: createRecordId(),
    patientId: patient.id,
    patientName: patient.nome || "",
    patientBirthDate: patient.birthDate || "",
    wardId: admission.wardId || null,
    wardName: admission.wardNome || "",
    bedId: admission.bedId || null,
    contacts: patient.phone || patient.socialSupport?.contacts || "",
    category: "ACOMPANHANTE",
    companionName,
    companionBirthDate,
    companionKinship,
    admissionDate: admission.admittedAt || "",
    socialRecord: "Concluído",
    observation: req.body?.observation || "",
    closedAt: now,
    closedBy: actor,
    shiftId: activeShift.id || null,
    shiftDate: activeShift.shiftDate || getOperationalDayKey(now),
    shiftLength: activeShift.shiftLength || "",
    shiftPeriod: activeShift.shiftPeriod || "",
    entryType: "baixa",
    entryLabel: "Atendimento ao acompanhante"
  });

  if (!Array.isArray(patient.socialSupportHistory)) patient.socialSupportHistory = [];
  patient.socialSupportHistory.unshift(attendance);
  patient.socialSupportHistory = patient.socialSupportHistory.slice(0, 300);
  patient.updatedAt = now;
  addUserAction(req.user, "PATIENT_SOCIAL_COMPANION_ATTENDANCE", `Registrou atendimento ao acompanhante ${companionName} do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    attendanceId: attendance.id,
    shiftId: attendance.shiftId
  });

  await persistState();
  res.status(201).json({ ok: true, patient: patientForClient(patient), attendance });
});

app.patch("/api/patients/:patientId/psychology-support", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const previousSupport = buildPatientPsychologySupport(patient.psychologySupport);
  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const normalizedStatus = String(req.body?.status || patient.currentAdmission?.psychologyRequest?.status || "").trim().toUpperCase();
  const finalStatus = ["BAIXA", "SOLICITADO"].includes(normalizedStatus) ? normalizedStatus : "EM_ACOMPANHAMENTO";
  const admission = patient.currentAdmission;
  const ward = admission
    ? wards.find(item => Number(item.id) === Number(admission.wardId))
    : null;
  const bed = admission
    ? ward?.beds?.find(item => Number(item.id) === Number(admission.bedId)) || null
    : null;
  if (bed) normalizeBedData(bed);
  const currentRequest = bed?.psychologyRequest || admission?.psychologyRequest || {};
  if (finalStatus === "BAIXA"
    && (String(currentRequest.status || "").trim().toUpperCase() === "BAIXA" || currentRequest.closedAt)) {
    return res.json({ ok: true, alreadyClosed: true, patient: patientForClient(patient) });
  }
  patient.psychologySupport = buildPatientPsychologySupport({
    interventions: req.body?.interventions,
    observation: req.body?.observation,
    dischargePending: finalStatus === "BAIXA" ? false : previousSupport.dischargePending,
    dischargeNote: finalStatus === "BAIXA" ? "" : previousSupport.dischargeNote,
    dischargeAt: finalStatus === "BAIXA" ? "" : previousSupport.dischargeAt,
    dischargeBy: finalStatus === "BAIXA" ? "" : previousSupport.dischargeBy,
    updatedAt: now,
    updatedBy: actor
  });
  if (admission) {
    const nextRequest = finalStatus === "BAIXA"
      ? buildBedRequestState({
        ...currentRequest,
        requested: false,
        closedAt: now,
        closedBy: actor,
        observation: patient.psychologySupport.observation || "",
        status: "BAIXA"
      })
      : finalStatus === "SOLICITADO"
        ? buildBedRequestState({
          ...currentRequest,
          requested: true,
          viewedAt: "",
          viewedBy: "",
          startedAt: "",
          startedBy: "",
          closedAt: "",
          closedBy: "",
          observation: "",
          status: "SOLICITADO"
        })
        : buildStartedBedRequestState(currentRequest, actor, now);
    patient.currentAdmission.psychologyRequest = nextRequest;
    if (bed) {
      normalizeBedData(bed);
      bed.psychologyRequest = nextRequest;
    }
  }
  patient.updatedAt = now;
  const activePsychologyShift = getUserActiveShiftOfType(req.user, "PSICOLOGIA");
  const claimKey = activePsychologyShift
    ? getPsychologyAttendanceKey({ shiftId: activePsychologyShift.id, patientId: patient.id })
    : "";
  const existingClaim = claimKey
    ? psychologyAttendanceEntries.find(item => getPsychologyAttendanceKey(item) === claimKey)
    : null;
  const hasActiveClaim = Boolean(existingClaim && String(existingClaim.status || "").toUpperCase() === "EM_ACOMPANHAMENTO");
  if (finalStatus === "EM_ACOMPANHAMENTO" && (req.body?.attended === true || hasActiveClaim) && admission && activePsychologyShift) {
    upsertPsychologyAttendanceEntry({
      id: createRecordId(),
      shiftId: activePsychologyShift.id,
      patientId: patient.id,
      patientName: patient.nome || "",
      patientBirthDate: patient.birthDate || "",
      wardId: admission.wardId || null,
      wardName: admission.wardNome || "",
      bedId: admission.bedId || null,
      status: "EM_ACOMPANHAMENTO",
      interventions: patient.psychologySupport.interventions,
      observation: patient.psychologySupport.observation,
      createdAt: existingClaim?.createdAt || now,
      createdBy: existingClaim?.createdBy || actor
    }, { preserveDischarge: true });
  }
  if (finalStatus === "BAIXA") {
    upsertPsychologyAttendanceEntry({
      id: createRecordId(),
      shiftId: activePsychologyShift?.id || null,
      patientId: patient.id,
      patientName: patient.nome || "",
      wardId: patient.currentAdmission?.wardId || null,
      wardName: patient.currentAdmission?.wardNome || "",
      bedId: patient.currentAdmission?.bedId || null,
      status: finalStatus,
      interventions: patient.psychologySupport.interventions,
      observation: patient.psychologySupport.observation,
      createdAt: now,
      createdBy: actor
    });
  }

  addUserAction(req.user, "PATIENT_PSYCHOLOGY_SUPPORT_UPDATE", `Atualizou o acompanhamento psicológico do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    active: Boolean(patient.currentAdmission)
  });

  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.delete("/api/patients/:patientId/psychology-support/request", requireAuth, async (req, res) => {
  const authorizingAdmin = authorizeAdminPassword(req, res);
  if (!authorizingAdmin) return;
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  const admission = patient.currentAdmission;
  if (!admission) {
    return res.status(404).json({ error: "O paciente não possui uma solicitação ativa da Psicologia." });
  }
  const ward = wards.find(item => Number(item.id) === Number(admission.wardId));
  const bed = ward?.beds?.find(item => Number(item.id) === Number(admission.bedId)) || null;
  if (bed) normalizeBedData(bed);
  const currentRequest = bed?.psychologyRequest || admission.psychologyRequest || {};
  if (String(currentRequest.status || "").trim().toUpperCase() === "BAIXA" || currentRequest.closedAt) {
    return res.status(409).json({ error: "A solicitação da Psicologia já foi finalizada e não pode ser excluída da fila." });
  }
  if (!currentRequest.requested) {
    return res.status(404).json({ error: "A solicitação ativa da Psicologia não foi encontrada." });
  }
  const clearedRequest = buildBedRequestState({
    requested: false,
    observation: currentRequest.observation || "",
    status: ""
  });
  admission.psychologyRequest = clearedRequest;
  if (bed) bed.psychologyRequest = clearedRequest;
  patient.updatedAt = new Date().toISOString();
  addUserAction(req.user, "PATIENT_PSYCHOLOGY_SUPPORT_REQUEST_DELETE", `Excluiu da fila a solicitação da Psicologia de ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    authorizedBy: authorizingAdmin.nome || authorizingAdmin.username || "Administrador"
  });
  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.patch("/api/patients/:patientId", requireAuth, async (req, res) => {
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const nome = req.body?.nome === undefined
    ? String(patient.nome || "").trim()
    : String(req.body?.nome || "").trim();
  const cpf = req.body?.cpf === undefined
    ? normalizeCpf(patient.cpf)
    : normalizeCpf(req.body?.cpf);
  const currentCpf = normalizeCpf(patient.cpf);
  const birthDate = req.body?.birthDate === undefined
    ? String(patient.birthDate || "").trim()
    : String(req.body?.birthDate || "").trim();
  const currentBirthDate = String(patient.birthDate || "").trim();
  const phone = req.body?.phone === undefined
    ? normalizePhone(patient.phone)
    : normalizePhone(req.body?.phone);
  const diagnostico = req.body?.diagnostico === undefined
    ? String(patient.diagnostico || "").trim()
    : String(req.body?.diagnostico || "").trim();
  const nir = req.body?.nir === undefined
    ? String(patient.nir || "").trim()
    : String(req.body?.nir || "").trim();
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
  const nirWorkflowStatus = req.body?.nirWorkflowStatus === undefined
    ? String(patient.nirWorkflowStatus || "").trim()
    : String(req.body?.nirWorkflowStatus || "").trim();
  const nirAcceptedLocation = req.body?.nirAcceptedLocation === undefined
    ? String(patient.nirAcceptedLocation || "").trim()
    : String(req.body?.nirAcceptedLocation || "").trim();
  const nirSpecialty = req.body?.nirSpecialty === undefined
    ? String(patient.nirSpecialty || "").trim()
    : String(req.body?.nirSpecialty || "").trim();
  const nirActionReason = req.body?.nirActionReason === undefined
    ? String(patient.nirActionReason || "").trim()
    : String(req.body?.nirActionReason || "").trim();
  const nirStatusUpdatedAt = req.body?.nirStatusUpdatedAt === undefined
    ? String(patient.nirStatusUpdatedAt || "").trim()
    : String(req.body?.nirStatusUpdatedAt || "").trim();
  const nirStatusUpdatedBy = req.body?.nirStatusUpdatedBy === undefined
    ? String(patient.nirStatusUpdatedBy || "").trim()
    : String(req.body?.nirStatusUpdatedBy || "").trim();
  const nirHistory = Array.isArray(req.body?.nirHistory)
    ? req.body.nirHistory
    : (Array.isArray(patient.nirHistory) ? patient.nirHistory : []);
  const nirDischargePending = req.body?.nirDischargePending === undefined
    ? Boolean(patient.nirDischargePending)
    : Boolean(req.body?.nirDischargePending);
  const nirDischargeNote = req.body?.nirDischargeNote === undefined
    ? String(patient.nirDischargeNote || "").trim()
    : String(req.body?.nirDischargeNote || "").trim();
  const nirDischargeAt = req.body?.nirDischargeAt === undefined
    ? String(patient.nirDischargeAt || "").trim()
    : String(req.body?.nirDischargeAt || "").trim();
  const nirDischargeBy = req.body?.nirDischargeBy === undefined
    ? String(patient.nirDischargeBy || "").trim()
    : String(req.body?.nirDischargeBy || "").trim();

  const nirFieldChanges = [
    ["nir", nir, String(patient.nir || "").trim()],
    ["cil", cil, String(patient.cil || "").trim()],
    ["regulationChannels", regulationChannels, patient.regulationChannels || []],
    ["regulationAcceptedAt", regulationAcceptedAt, String(patient.regulationAcceptedAt || "").trim()],
    ["nirLastUpdateAt", nirLastUpdateAt, String(patient.nirLastUpdateAt || "").trim()],
    ["nirLastUpdateBy", nirLastUpdateBy, String(patient.nirLastUpdateBy || "").trim()],
    ["nirUpdateChannels", nirUpdateChannels, patient.nirUpdateChannels || []],
    ["nirWorkflowStatus", nirWorkflowStatus, String(patient.nirWorkflowStatus || "").trim()],
    ["nirAcceptedLocation", nirAcceptedLocation, String(patient.nirAcceptedLocation || "").trim()],
    ["nirSpecialty", nirSpecialty, String(patient.nirSpecialty || "").trim()],
    ["nirActionReason", nirActionReason, String(patient.nirActionReason || "").trim()],
    ["nirStatusUpdatedAt", nirStatusUpdatedAt, String(patient.nirStatusUpdatedAt || "").trim()],
    ["nirStatusUpdatedBy", nirStatusUpdatedBy, String(patient.nirStatusUpdatedBy || "").trim()],
    ["nirDischargePending", nirDischargePending, Boolean(patient.nirDischargePending)],
    ["nirDischargeNote", nirDischargeNote, String(patient.nirDischargeNote || "").trim()],
    ["nirDischargeAt", nirDischargeAt, String(patient.nirDischargeAt || "").trim()],
    ["nirDischargeBy", nirDischargeBy, String(patient.nirDischargeBy || "").trim()],
    ["nirHistory", nirHistory, patient.nirHistory || []]
  ];
  const hasNirChanges = nirFieldChanges.some(([field, nextValue, currentValue]) =>
    Object.prototype.hasOwnProperty.call(req.body || {}, field)
    && JSON.stringify(nextValue) !== JSON.stringify(currentValue)
  );
  if (hasNirChanges && !hasActiveServiceShift(req.user, "NIR")) {
    return res.status(403).json({ error: "Abra o plantão NIR para alterar os dados dos pacientes aceitos." });
  }

  if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
  const allowBlankCpf = !currentCpf && !cpf;
  if (!allowBlankCpf && (!cpf || cpf.length !== 11)) {
    return res.status(400).json({ error: "CPF deve ter 11 dígitos" });
  }
  const allowBlankBirthDate = !currentBirthDate && !birthDate;
  if (!allowBlankBirthDate && !birthDate) {
    return res.status(400).json({ error: "Data de nascimento é obrigatória" });
  }
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ error: "Data de nascimento inválida" });
  }
  if (cpf && patientRegistry.some(item => item.id !== patient.id && !item.deletedAt && normalizeCpf(item.cpf) === cpf)) {
    return res.status(400).json({ error: "Já existe outro paciente com esse CPF" });
  }

  patient.nome = nome;
  patient.cpf = cpf;
  patient.birthDate = birthDate;
  patient.phone = phone;
  patient.diagnostico = diagnostico;
  patient.nir = nir;
  patient.cil = cil;
  patient.regulationChannels = Array.from(new Set(regulationChannels));
  patient.regulationAcceptedAt = regulationAcceptedAt;
  patient.nirLastUpdateAt = nirLastUpdateAt;
  patient.nirLastUpdateBy = nirLastUpdateBy;
  patient.nirUpdateChannels = Array.from(new Set(nirUpdateChannels));
  patient.nirWorkflowStatus = nirWorkflowStatus;
  patient.nirAcceptedLocation = nirAcceptedLocation;
  patient.nirSpecialty = nirSpecialty;
  patient.nirActionReason = nirActionReason;
  patient.nirStatusUpdatedAt = nirStatusUpdatedAt;
  patient.nirStatusUpdatedBy = nirStatusUpdatedBy;
  patient.nirDischargePending = nirDischargePending;
  patient.nirDischargeNote = nirDischargeNote;
  patient.nirDischargeAt = nirDischargeAt;
  patient.nirDischargeBy = nirDischargeBy;
  patient.nirHistory = Array.isArray(nirHistory) ? nirHistory : [];
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

app.patch("/api/patients/:patientId/nir-accept", requireAuth, async (req, res) => {
  if (!hasActiveServiceShift(req.user, "NIR")) {
    return res.status(403).json({ error: "Abra o plantão NIR antes de aceitar pacientes." });
  }
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  const admission = patient.currentAdmission;
  if (!admission?.wardId || !admission?.bedId) {
    return res.status(409).json({ error: "O paciente não possui uma internação ativa para aceitar no NIR." });
  }
  const ward = wards.find(item => Number(item.id) === Number(admission.wardId));
  const bed = ward?.beds?.find(item => Number(item.id) === Number(admission.bedId));
  if (!bed) return res.status(409).json({ error: "O leito atual do paciente não foi encontrado." });

  const now = new Date().toISOString();
  const actor = req.user.nome || req.user.username || "";
  const selectedNirChannels = [
    ...(Array.isArray(patient.regulationChannels) ? patient.regulationChannels : []),
    ...(Array.isArray(patient.nirUpdateChannels) ? patient.nirUpdateChannels : [])
  ]
    .map(channel => String(channel || "").trim().toUpperCase())
    .filter(channel => channel === "EMAIL" || channel === "CIL");
  patient.nirUpdateChannels = Array.from(new Set(selectedNirChannels));
  const currentRequest = buildBedRequestState(bed.nirRequest);
  bed.nirRequest = {
    ...currentRequest,
    requested: true,
    requestedAt: currentRequest.requestedAt || now,
    requestedBy: currentRequest.requestedBy || actor,
    viewedAt: currentRequest.viewedAt || now,
    viewedBy: currentRequest.viewedBy || actor,
    startedAt: now,
    startedBy: actor,
    closedAt: "",
    closedBy: "",
    observation: "",
    status: "EM_ACOMPANHAMENTO"
  };
  patient.regulationAcceptedAt = "";
  patient.nirWorkflowStatus = "EM_ACOMPANHAMENTO";
  patient.nirActionReason = "";
  patient.nirStatusUpdatedAt = now;
  patient.nirStatusUpdatedBy = actor;
  patient.nirDischargePending = false;
  patient.nirDischargeNote = "";
  patient.nirDischargeAt = "";
  patient.nirDischargeBy = "";
  patient.nirHistory = [{
    status: "ACEITO",
    at: now,
    by: actor
  }, ...(Array.isArray(patient.nirHistory) ? patient.nirHistory : [])].slice(0, 20);
  patient.updatedAt = now;
  normalizeBedData(bed);
  addUserAction(req.user, "PATIENT_NIR_ACCEPT", `Aceitou o paciente ${patient.nome} no NIR`, {
    patientId: patient.id,
    patientName: patient.nome
  });
  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.patch("/api/patients/:patientId/nir-regulation-date", requireAuth, async (req, res) => {
  if (!hasActiveServiceShift(req.user, "NIR")) {
    return res.status(403).json({ error: "Abra o plantão NIR para alterar a data da regulação." });
  }
  const patient = findPatientOr404(req, res);
  if (!patient) return;
  const value = String(req.body?.regulationAcceptedAt || "").trim();
  const timestamp = value ? new Date(value) : null;
  if (value && (!timestamp || Number.isNaN(timestamp.getTime()))) {
    return res.status(400).json({ error: "A data da regulação é inválida." });
  }
  patient.regulationAcceptedAt = timestamp ? timestamp.toISOString() : "";
  patient.updatedAt = new Date().toISOString();
  await persistState();
  res.json({ ok: true, patient: patientForClient(patient) });
});

app.post("/api/patients/:patientId/nir-update", requireAuth, async (req, res) => {
  if (!hasActiveServiceShift(req.user, "NIR")) {
    return res.status(403).json({ error: "Abra o plantão NIR para alterar os dados dos pacientes aceitos." });
  }
  const patient = findPatientOr404(req, res);
  if (!patient) return;

  const hasChannelToggle = Object.prototype.hasOwnProperty.call(req.body || {}, "channel");
  let channels = Array.isArray(req.body?.channels)
    ? req.body.channels
      .map(item => String(item || "").trim().toUpperCase())
      .filter(item => item === "CIL" || item === "EMAIL")
    : (Array.isArray(patient.nirUpdateChannels) ? [...patient.nirUpdateChannels] : []);
  let toggledChannel = "";
  if (hasChannelToggle) {
    toggledChannel = String(req.body?.channel || "").trim().toUpperCase();
    if (!["CIL", "EMAIL"].includes(toggledChannel) || typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "Seleção do canal de atualização inválida." });
    }
    channels = channels.filter(channel => channel === "CIL" || channel === "EMAIL");
    channels = Array.from(new Set(channels));
    if (req.body.enabled && !channels.includes(toggledChannel)) channels.push(toggledChannel);
    if (!req.body.enabled) channels = channels.filter(channel => channel !== toggledChannel);
  }
  const cil = req.body?.cil === undefined
    ? String(patient.cil || "").trim()
    : String(req.body?.cil || "").trim();

  if (!hasChannelToggle && !Array.isArray(req.body?.channels) && req.body?.cil === undefined) {
    return res.status(400).json({ error: "Informe ao menos uma atualização: SIREL ou EMAIL." });
  }

  const now = new Date().toISOString();
  patient.cil = cil;
  patient.nirLastUpdateAt = now;
  patient.nirLastUpdateBy = req.user.nome || req.user.username || "";
  patient.nirUpdateChannels = Array.from(new Set(channels));
  if (hasChannelToggle) {
    patient.nirHistory = [{
      status: `CANAL ${toggledChannel} ${req.body.enabled ? "SELECIONADO" : "DESMARCADO"}`,
      at: now,
      by: patient.nirLastUpdateBy,
      channel: toggledChannel
    }, ...(Array.isArray(patient.nirHistory) ? patient.nirHistory : [])].slice(0, 20);
  }
  patient.updatedAt = now;

  if (patient.currentAdmission) {
    const ward = wards.find(item => item.id === patient.currentAdmission.wardId);
    const bed = ward?.beds?.find(item => item.id === patient.currentAdmission.bedId);
    if (bed) {
      bed.cil = cil;
      normalizeBedData(bed);
    }
  }

  addUserAction(req.user, "PATIENT_NIR_UPDATE", `Atualizou o NIR do paciente ${patient.nome}`, {
    patientId: patient.id,
    patientName: patient.nome,
    channels: patient.nirUpdateChannels,
    cil: patient.cil
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

app.get("/api/nir/census", requireAuth, async (req, res) => {
  const month = String(req.query?.month || getOperationalDayKey().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Selecione um mês válido para consultar o censo." });
  }

  const reportsChanged = refreshAutomaticCensusReports();
  if (reportsChanged) {
    try {
      await persistState();
    } catch (error) {
      return res.status(503).json({
        error: error.message || "Não foi possível salvar a atualização automática do censo."
      });
    }
  }

  const reports = censusDailyReports
    .filter(report => report.periodStartDate.startsWith(`${month}-`))
    .sort((a, b) =>
      String(b.periodStartDate).localeCompare(String(a.periodStartDate))
      || String(a.wardName).localeCompare(String(b.wardName), "pt-BR")
    );
  const reportWardIds = new Set(reports.map(report => Number(report.wardId)));
  const monthWards = wards
    .filter(ward => !isWardArchived(ward) || reportWardIds.has(Number(ward.id)))
    .map(ward => ({ id: ward.id, nome: ward.nome }));
  for (const report of reports) {
    if (!monthWards.some(ward => Number(ward.id) === Number(report.wardId))) {
      monthWards.push({ id: report.wardId, nome: report.wardName || "Setor arquivado" });
    }
  }
  res.json({ month, wards: monthWards, reports });
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
  const serviceType = String(req.body?.serviceType || "").trim().toUpperCase();
  const serviceLabel = getServiceShiftLabel(serviceType);
  const isStandaloneService = ["NIR", "PSICOLOGIA", "SERVICO_SOCIAL"].includes(serviceType);
  const shiftLength = String(req.body?.shiftLength || "").trim().toUpperCase();
  if (!["12H", "24H"].includes(shiftLength)) {
    return res.status(400).json({ error: "Selecione se o plantão será de 12H ou 24H." });
  }
  const wardId = parseInt(req.body?.wardId, 10);
  const ward = isStandaloneService ? null : wards.find(item => item.id === wardId);
  if (!isStandaloneService && !ward) return res.status(400).json({ error: "Selecione um setor válido para abrir o plantão" });
  if (getUserActiveShifts(req.user).some(shift =>
    String(shift.serviceType || "").trim().toUpperCase() === serviceType
    && (isStandaloneService || Number(shift.wardId) === Number(ward.id))
  )) {
    return res.status(400).json({ error: "Você já tem um plantão aberto para este setor." });
  }
  const shiftDate = getCurrentIsoDate();
  const activeShiftOwner = findActiveShiftOwnerForDay(isStandaloneService ? null : ward.id, shiftDate, serviceType);
  let approvedAuthorization = null;
  if (activeShiftOwner) {
    approvedAuthorization = shiftAuthorizationRequests.find(request =>
      request.status === "approved"
      && request.requesterUsername === req.user.username
      && Number(request.wardId) === Number(ward?.id)
      && request.shiftDate === shiftDate
    ) || null;
    if (!approvedAuthorization) {
      return res.status(409).json({
        error: isStandaloneService
          ? `O plantão de hoje de ${serviceLabel} já foi aberto por ${activeShiftOwner.nome || activeShiftOwner.username}. Somente esse acesso pode continuar no dia.`
          : `O plantão de hoje no setor ${ward.nome} já foi aberto por ${activeShiftOwner.nome || activeShiftOwner.username}. Somente esse acesso pode continuar no dia.`
      });
    }
  }
  let shiftPeriod = String(req.body?.shiftPeriod || "").trim().toUpperCase();
  if (shiftLength === "24H") shiftPeriod = "COMPLETO";
  if (!["DIA", "NOITE", "COMPLETO"].includes(shiftPeriod)) shiftPeriod = "DIA";
  const ownerName = req.user.nome || req.user.username;
  const openedAt = new Date().toISOString();
  const defaultNurseDay = shiftLength === "24H" || shiftPeriod === "DIA" || shiftPeriod === "COMPLETO" ? ownerName : "";
  const defaultNurseNight = shiftLength === "24H" || shiftPeriod === "NOITE" || shiftPeriod === "COMPLETO" ? ownerName : "";
  const patientsAtOpen = isStandaloneService
    ? []
    : ward.beds
      .filter(isBedOccupiedByPatient)
      .map(bed => {
        const patient = ensurePatientRecordFromBed(bed);
        return {
          patientId: patient.id,
          bedId: bed.id,
          enfermaria: bed.enfermaria || "",
          nome: bed.nome || "",
          cpf: normalizeCpf(bed.cpf),
          birthDate: bed.birthDate || "",
          telefone: patient.phone || "",
          admissao: bed.admissao || "",
          diagnostico: bed.diagnostico || "",
          nir: bed.nir || "",
          cil: bed.cil || "",
          serviceSocialRequest: buildBedRequestState(bed.serviceSocialRequest),
          psychologyRequest: buildBedRequestState(bed.psychologyRequest),
          pendencias: bed.pendencias || "",
          procedimentos: Array.isArray(bed.procedimentos) ? [...bed.procedimentos] : []
        };
      });

  req.user.activeShift = {
    id: nextShiftId++,
    serviceType,
    shiftDate,
    openedAt,
    closedAt: null,
    workPeriods: [{ openedAt, closedAt: null }],
    wardId: isStandaloneService ? null : ward.id,
    wardNome: isStandaloneService ? serviceLabel : ward.nome,
    ownerUsername: req.user.username,
    ownerName,
    shiftLength,
    shiftPeriod,
    authorizationRequestId: approvedAuthorization?.id || null,
    authorizationApprovedBy: approvedAuthorization?.decidedBy || "",
    patientsAtOpen,
    team: serviceType === "NIR"
      ? {
        enfermeiroResponsavel: ownerName,
        auxiliarAdministrativo: ""
      }
      : {
        medicoPlantao: "",
        enfermeiroDia: defaultNurseDay,
        tecnicosDia: "",
        enfermeiroNoite: defaultNurseNight,
        tecnicosNoite: "",
        faltosos: ""
      },
    teamUpdatedAt: "",
    teamUpdatedBy: "",
    nursingReport: "",
    nursingReportUpdatedAt: "",
    nursingReportUpdatedBy: "",
    socialServiceReport: { companions: "", families: "", deaths: "", pending: "" },
    socialServiceReportUpdatedAt: "",
    socialServiceReportUpdatedBy: "",
    actions: [],
    pendenciasFinalizadas: []
  };
  if (!Array.isArray(req.user.activeShifts)) req.user.activeShifts = [];
  req.user.activeShifts.push(req.user.activeShift);
  if (serviceType === "SERVICO_SOCIAL") {
    clearActiveSocialServiceShiftDrafts();
  }
  addUserAction(req.user, "SHIFT_OPEN", isStandaloneService ? `Abriu plantão de ${serviceLabel}` : `Abriu plantão no setor ${ward.nome}`, {
    serviceType,
    wardId: isStandaloneService ? null : ward.id,
    wardNome: isStandaloneService ? serviceLabel : ward.nome,
    shiftLength,
    shiftPeriod,
    authorizationRequestId: approvedAuthorization?.id || null,
    authorizationApprovedBy: approvedAuthorization?.decidedBy || ""
  });
  if (approvedAuthorization) {
    approvedAuthorization.status = "used";
    approvedAuthorization.usedAt = openedAt;
    approvedAuthorization.shiftId = req.user.activeShift.id;
  }
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

function normalizeNirExternalRegulations(rows) {
  if (!Array.isArray(rows) || rows.length > 100) return null;
  const fields = {
    patient: 180,
    age: 3,
    specialty: 120,
    origin: 120,
    professional: 180,
    transferType: 80,
    regulator: 120,
    result: 20
  };
  const allowedOptions = {
    specialty: ["ORTOPEDIA", "CIRURGICA", "CLÍNICA MÉDICA", "OBSTETRÍCIA", "VASCULAR", "UTI ADULTO", "UTI NEO", "HEMODINÂMICA", "NEUROLOGIA", "NEFROLOGIA", "OUTROS"],
    origin: ["CIDELÂNCIA", "SÃO FRANCISCO DO BREJÃO", "SÃO PEDRO DA ÁGUA BRANCA", "BOM JESUS DAS SELVAS", "ITINGA", "BURITICUPU", "VILA NOVA DOS MARTÍRIOS", "REGIONAL-AÇAILÂNDIA", "HMA", "OUTROS"],
    transferType: ["INTERNA: PARA HMA", "EXTERNA: PARA OUTRAS UNIDADES", "HEMODINÂMICA"],
    result: ["AUTORIZADO", "NEGADO"]
  };
  const normalizeOption = (value, options, aliases = {}) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const normalize = text => String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "");
    const key = normalize(raw);
    const alias = aliases[key];
    if (alias) return alias;
    return options.find(option => normalize(option) === key)
      || (options.includes("OUTROS") ? "OUTROS" : "");
  };
  const normalized = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const item = {
      id: String(row.id || `nir-external-${index}`).trim().slice(0, 80),
      startedAt: String(row.startedAt || "").trim(),
      endedAt: String(row.endedAt || "").trim(),
      closedAt: String(row.closedAt || "").trim()
    };
    for (const [field, maxLength] of Object.entries(fields)) {
      const value = row[field] === undefined || row[field] === null ? "" : row[field];
      if (!["string", "number"].includes(typeof value)) return null;
      item[field] = String(value).trim().slice(0, maxLength);
      if (allowedOptions[field]) {
        item[field] = normalizeOption(item[field], allowedOptions[field], field === "specialty"
          ? { ORT: "ORTOPEDIA", ORTO: "ORTOPEDIA" }
          : {});
      }
    }
    for (const field of ["startedAt", "endedAt", "closedAt"]) {
      if (item[field] && Number.isNaN(new Date(item[field]).getTime())) return null;
    }
    normalized.push(item);
  }
  return normalized;
}

app.put("/api/shifts/nir/external-regulations", requireAuth, async (req, res) => {
  if (!hasActiveServiceShift(req.user, "NIR")) {
    return res.status(403).json({ error: "Abra o plantão NIR para salvar a regulação externa." });
  }
  const regulations = normalizeNirExternalRegulations(req.body?.regulations);
  if (!regulations) {
    return res.status(400).json({ error: "Os registros da regulação externa são inválidos ou excedem o limite permitido." });
  }
  req.user.activeShift.nirExternalRegulations = regulations;
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
  if (String(req.user.activeShift.serviceType || "").trim().toUpperCase() === "NIR") {
    req.user.activeShift.team = {
      enfermeiroResponsavel: req.user.activeShift.ownerName || req.user.nome || req.user.username || "",
      auxiliarAdministrativo: String(req.body?.auxiliarAdministrativo || "").trim().slice(0, 160)
    };
  } else {
    Object.assign(req.user.activeShift.team, req.body || {});
  }
  const ward = wards.find(item => item.id === req.user.activeShift.wardId);
  if (ward) {
    Object.assign(ensureWardTeam(ward), req.user.activeShift.team);
  }
  req.user.activeShift.teamUpdatedAt = new Date().toISOString();
  req.user.activeShift.teamUpdatedBy = req.user.nome || req.user.username;
  addUserAction(req.user, "SHIFT_TEAM_UPDATE", getServiceShiftLabel(req.user.activeShift.serviceType || "")
    ? `Atualizou a equipe do plantão de ${getServiceShiftLabel(req.user.activeShift.serviceType || "")}`
    : `Atualizou a equipe do plantao no setor ${req.user.activeShift.wardNome}`, {
    serviceType: req.user.activeShift.serviceType || "",
    wardId: req.user.activeShift.wardId,
    wardNome: req.user.activeShift.wardNome,
    shiftId: req.user.activeShift.id
  });
  await persistState();
  res.json({ ok: true, team: req.user.activeShift.team, user: sanitizeUser(req.user) });
});

app.patch("/api/shifts/nursing-report", requireAuth, async (req, res) => {
  if (!req.user.activeShift) return res.status(400).json({ error: "Nao ha plantao aberto para este usuario" });
  req.user.activeShift.nursingReport = String(req.body?.nursingReport || "").trim();
  if (req.user.activeShift.nursingReport) {
    req.user.activeShift.nursingReportUpdatedAt = new Date().toISOString();
    req.user.activeShift.nursingReportUpdatedBy = req.user.nome || req.user.username;
  } else {
    req.user.activeShift.nursingReportUpdatedAt = "";
    req.user.activeShift.nursingReportUpdatedBy = "";
  }
  await persistState();
  res.json({
    ok: true,
    nursingReport: req.user.activeShift.nursingReport,
    user: sanitizeUser(req.user)
  });
});

app.patch("/api/shifts/social-service-report", requireAuth, async (req, res) => {
  const shift = req.user.activeShift;
  if (String(shift?.serviceType || "").trim().toUpperCase() !== "SERVICO_SOCIAL") {
    return res.status(400).json({ error: "Abra o plantão do Serviço Social antes de salvar este relatório." });
  }
  const source = req.body?.socialServiceReport;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return res.status(400).json({ error: "Informe os campos do relatório do Serviço Social." });
  }
  if (String(source.pending || "").length > 6000) {
    return res.status(400).json({ error: "O campo de pendências pode conter no máximo 6.000 caracteres." });
  }
  shift.socialServiceReport = {
    ...(shift.socialServiceReport && typeof shift.socialServiceReport === "object" ? shift.socialServiceReport : {}),
    pending: String(source.pending || "").trim()
  };
  shift.socialServiceReportUpdatedAt = new Date().toISOString();
  shift.socialServiceReportUpdatedBy = req.user.nome || req.user.username || "";
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user) });
});

app.post("/api/shifts/close", requireAuth, async (req, res) => {
  if (!req.user.activeShift) return res.status(400).json({ error: "Não há plantão aberto para este usuário" });
  const closePassword = String(req.body?.password || "");
  if (!closePassword || closePassword !== String(req.user.password || "")) {
    return res.status(403).json({ error: "Senha incorreta. O plantão continua aberto." });
  }
  const closingShift = req.user.activeShift;
  const censusInput = req.body?.census;
  if (censusInput !== undefined && censusInput !== null) {
    const validCensus = censusInput
      && typeof censusInput === "object"
      && !Array.isArray(censusInput)
      && Number(censusInput.wardId) === Number(closingShift.wardId)
      && censusInput.values
      && typeof censusInput.values === "object"
      && !Array.isArray(censusInput.values)
      && Object.values(censusInput.values).every(value => Number.isInteger(Number(value)) && Number(value) >= 0);
    if (!validCensus) return res.status(400).json({ error: "O resumo do censo não corresponde ao setor deste plantão." });
  }
  if (String(closingShift.serviceType || "").trim().toUpperCase() === "NIR") {
    const externalRows = req.body?.nirExternalRegulations
      ?? closingShift.nirExternalRegulations
      ?? [];
    const normalizedExternalRows = normalizeNirExternalRegulations(externalRows);
    if (!normalizedExternalRows) {
      return res.status(400).json({ error: "Os registros da regulação externa são inválidos ou excedem o limite permitido." });
    }
    closingShift.nirExternalRegulations = normalizedExternalRows;
    closingShift.nirExternalRegulationsSnapshot = normalizedExternalRows.map(item => ({ ...item }));
  }
  const socialReportInput = req.body?.socialServiceReport;
  if (String(closingShift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL"
    && socialReportInput !== undefined
    && (!socialReportInput || typeof socialReportInput !== "object" || Array.isArray(socialReportInput)
      || String(socialReportInput.pending || "").length > 6000)) {
    return res.status(400).json({ error: "O relatório do Serviço Social é inválido ou excede o limite permitido." });
  }
  req.user.activeShift.nursingReport = String(req.body?.nursingReport || req.user.activeShift.nursingReport || "").trim();
  if (req.user.activeShift.nursingReport) {
    req.user.activeShift.nursingReportUpdatedAt = new Date().toISOString();
    req.user.activeShift.nursingReportUpdatedBy = req.user.nome || req.user.username;
  } else {
    req.user.activeShift.nursingReportUpdatedAt = "";
    req.user.activeShift.nursingReportUpdatedBy = "";
  }
  const closeAction = addUserAction(req.user, "SHIFT_CLOSE", getServiceShiftLabel(closingShift.serviceType || "")
    ? `Fechou plantão de ${getServiceShiftLabel(closingShift.serviceType || "")}`
    : `Fechou plantão no setor ${closingShift.wardNome}`, {
    serviceType: closingShift.serviceType || "",
    wardId: closingShift.wardId,
    wardNome: closingShift.wardNome
  });
  closingShift.closedAt = closeAction.at;
  if (!Array.isArray(closingShift.workPeriods) || !closingShift.workPeriods.length) {
    closingShift.workPeriods = [{ openedAt: closingShift.openedAt || "", closedAt: null }];
  }
  closingShift.workPeriods[closingShift.workPeriods.length - 1].closedAt = closeAction.at;
  if (String(closingShift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL") {
    const socialReport = socialReportInput;
    if (socialReport !== undefined) {
      closingShift.socialServiceReport = {
        ...(closingShift.socialServiceReport && typeof closingShift.socialServiceReport === "object" ? closingShift.socialServiceReport : {}),
        pending: String(socialReport.pending || "").trim()
      };
      closingShift.socialServiceReportUpdatedAt = closeAction.at;
      closingShift.socialServiceReportUpdatedBy = req.user.nome || req.user.username || "";
    }
    closingShift.socialServiceAttendances = getSocialServiceAttendancesForShift(closingShift);
    closingShift.socialServiceSnapshot = patientRegistry
      .flatMap(patient => (Array.isArray(patient.socialSupportHistory) ? patient.socialSupportHistory : [])
        .filter(item => item?.entryType === "acompanhamento" && Number(item.shiftId) === Number(closingShift.id))
        .map(item => ({ patient, claim: socialServiceAttendanceEntryForClient(item) })))
      .map(({ patient, claim }) => ({
        socialHistoryId: claim.id,
        patientId: patient.id,
        bed: String(claim.bedId || "-"),
        sector: claim.wardName || "",
        patient: claim.patientName || patient.nome || "",
        patientBirthDate: claim.patientBirthDate || patient.birthDate || "",
        age: getPatientAgeLabel(claim.patientBirthDate || patient.birthDate || "") || "-",
        contacts: claim.contacts || "",
        admission: claim.admissionDate ? new Date(claim.admissionDate).toLocaleDateString("pt-BR") : "",
        serviceStatus: "Em acompanhamento",
        serviceStatusMeta: claim.closedBy ? `Em acompanhamento por ${claim.closedBy}` : "",
        socialRecord: claim.socialRecord || "Pendente",
        observation: claim.observation || "",
        updatedAt: claim.closedAt || "",
        updatedBy: claim.closedBy || ""
      }));
    for (const entry of socialServiceManualRequests) {
      const manualClaim = getSocialManualClaim(entry, closingShift.id);
      if (!manualClaim) continue;
      closingShift.socialServiceSnapshot.push({
        socialHistoryId: `shift-${closingShift.id}-manual-${entry.id}`,
        category: ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(entry.category || "").trim().toUpperCase())
          ? String(entry.category).trim().toUpperCase()
          : "AVULSO",
        bed: "Avulso",
        sector: entry.sectorOrReason || "",
        patient: entry.patientName || "",
        patientBirthDate: entry.birthDate || "",
        age: getPatientAgeLabel(entry.birthDate || "") || "-",
        contacts: manualClaim.contacts || entry.contacts || "",
        admission: entry.createdAt || "",
        serviceStatus: "Em acompanhamento",
        socialRecord: normalizeSocialRecordStatus(entry.socialRecord || "Pendente"),
        observation: manualClaim.observation || "",
        updatedAt: manualClaim.at || closeAction.at,
        updatedBy: manualClaim.by || closingShift.ownerName || req.user.nome || req.user.username || ""
      });
    }
    const isUpdatedDuringShift = value => {
      const timestamp = value ? new Date(value).getTime() : Number.NaN;
      return Number.isFinite(timestamp) && closingShift.workPeriods.some(period => {
        const startedAt = new Date(period.openedAt || closingShift.openedAt || 0).getTime();
        const endedAt = new Date(period.closedAt || closeAction.at).getTime();
        return Number.isFinite(startedAt) && Number.isFinite(endedAt) && timestamp >= startedAt && timestamp <= endedAt;
      });
    };
    const updates = [];
    for (const patient of patientRegistry) {
      if (patient?.deletedAt) continue;
      const form = buildPatientSocialForm(patient?.socialSupport?.socialForm);
      if (!form.updatedAt || !isUpdatedDuringShift(form.updatedAt)) continue;
      const admission = patient.currentAdmission || patient.lastAdmission || {};
      updates.push({
        patient: patient.nome || form.fullName || "Paciente",
        location: admission.wardNome ? `${admission.wardNome} - Leito ${admission.bedId || "-"}` : "Paciente sem internação ativa",
        updatedAt: form.updatedAt,
        updatedBy: form.updatedBy || "-"
      });
    }
    for (const entry of socialServiceManualRequests) {
      const form = buildPatientSocialForm(entry.socialForm);
      if (!form.updatedAt || !isUpdatedDuringShift(form.updatedAt)) continue;
      updates.push({
        patient: entry.patientName || form.fullName || "Atendimento avulso",
        location: entry.sectorOrReason || "Atendimento avulso",
        updatedAt: form.updatedAt,
        updatedBy: form.updatedBy || "-"
      });
    }
    closingShift.socialServiceFormUpdates = updates.sort((a, b) => String(a.patient).localeCompare(String(b.patient), "pt-BR"));
    const manualAttendanceRows = closingShift.socialServiceSnapshot
      .filter(item => String(item.bed || "") === "Avulso" && ["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(item.category || "").trim().toUpperCase()))
      .map(item => ({
        category: String(item.category || "").trim().toUpperCase(),
        patient: String(item.patient || "").trim(),
        location: String(item.sector || "").trim(),
        observation: String(item.observation || "").trim(),
        contacts: String(item.contacts || "").trim(),
        status: String(item.serviceStatus || "").trim()
      }));
    for (const entry of socialServiceManualAttendanceEntries) {
      if (!["ACOMPANHANTE", "FAMILIAR", "OBITO"].includes(String(entry.category || "").trim().toUpperCase())) continue;
      if (!isUpdatedDuringShift(entry.closedAt)) continue;
      if (entry.entryType !== "baixa") continue;
      if (Number(entry.shiftId) ? Number(entry.shiftId) !== Number(closingShift.id) : !sameShiftOwner(closingShift, entry.closedBy)) continue;
      manualAttendanceRows.push({
        category: String(entry.category).trim().toUpperCase(),
        patient: String(entry.patientName || "").trim(),
        location: String(entry.wardName || "").trim(),
        observation: String(entry.observation || "").trim(),
        contacts: String(entry.contacts || "").trim(),
        status: "Baixa"
      });
    }
    closingShift.socialServiceManualAttendances = manualAttendanceRows;
  }
  if (String(closingShift.serviceType || "").trim().toUpperCase() === "NIR") {
    closingShift.nirAcceptedSnapshot = patientRegistry
      .map(patient => patientForClient(patient))
      .filter(clientPatient => {
        const workflowStatus = String(clientPatient.nirWorkflowStatus || "").trim().toUpperCase();
        const admission = clientPatient.currentAdmission || clientPatient.lastAdmission || {};
        const request = admission.nirRequest || {};
        const requestStatus = String(request.status || "").trim().toUpperCase();
        if (
          requestStatus === "SOLICITADO"
          || requestStatus === "BAIXA"
          || ["SOLICITADO", "BAIXA", "CANCELADO"].includes(workflowStatus)
        ) return false;
        const hasActiveRequest = Boolean(request.requested || request.requestedAt || request.viewedAt || request.startedAt);
        if (
          workflowStatus !== "EM_ACOMPANHAMENTO"
          && requestStatus !== "EM_ACOMPANHAMENTO"
          && (hasActiveRequest || !String(clientPatient.regulationAcceptedAt || "").trim())
        ) return false;
        if (clientPatient.nirDischargePending) return true;
        if (requestStatus === "BAIXA" || request.closedAt) return false;
        return Boolean(request.requested || request.requestedAt || request.viewedAt || request.startedAt);
      })
      .sort((a, b) => {
        const admissionA = a.currentAdmission || a.lastAdmission || {};
        const admissionB = b.currentAdmission || b.lastAdmission || {};
        return String(admissionA.wardNome || "").localeCompare(String(admissionB.wardNome || ""), "pt-BR")
          || Number(admissionA.bedId || 0) - Number(admissionB.bedId || 0)
          || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
      })
      .map(clientPatient => {
        const admission = clientPatient.currentAdmission || clientPatient.lastAdmission || {};
        return {
          patientId: clientPatient.id,
          patientName: clientPatient.nome || "",
          cpf: clientPatient.cpf || "",
          wardName: admission.wardNome || "",
          bedId: admission.bedId || "",
          admittedAt: admission.admittedAt || "",
          nir: clientPatient.nir || "",
          cil: clientPatient.cil || "",
          diagnosis: clientPatient.diagnostico || "",
          nirWorkflowStatus: clientPatient.nirWorkflowStatus || admission.nirRequest?.status || "",
          nirSpecialty: clientPatient.nirSpecialty || "",
          regulationAcceptedAt: clientPatient.regulationAcceptedAt || "",
          nirUpdateChannels: Array.isArray(clientPatient.nirUpdateChannels) ? [...clientPatient.nirUpdateChannels] : [],
          nirLastUpdateAt: clientPatient.nirLastUpdateAt || "",
          nirDischargePending: Boolean(clientPatient.nirDischargePending),
          nirActionReason: clientPatient.nirActionReason || admission.nirRequest?.observation || ""
        };
      });
  }
  if (String(closingShift.serviceType || "").trim().toUpperCase() === "PSICOLOGIA") {
    closingShift.psychologyAttendanceSnapshot = psychologyAttendanceEntries
      .filter(entry =>
        Number(entry.shiftId) === Number(closingShift.id)
        && String(entry.status || "").trim().toUpperCase() === "EM_ACOMPANHAMENTO"
      )
      .map(entry => ({ ...entry }));
  }
  const report = buildShiftReport(req.user, closingShift);
  report.census = censusInput ? {
    wardId: Number(censusInput.wardId),
    wardName: String(censusInput.wardName || ""),
    periodStartDate: String(censusInput.periodStartDate || ""),
    periodEndDate: String(censusInput.periodEndDate || ""),
    period: String(censusInput.period || ""),
    authors: String(censusInput.authors || ""),
    values: Object.fromEntries(Object.entries(censusInput.values).map(([key, value]) => [key, Number(value)]))
  } : null;
  report.psychologyRows = String(closingShift.serviceType || "").trim().toUpperCase() === "PSICOLOGIA"
    ? psychologyAttendanceEntries
      .filter(entry => Number(entry.shiftId) === Number(closingShift.id))
      .map(entry => psychologyAttendanceEntryForClient(entry))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(0, 14)
      .map((entry, index) => {
        const registeredPatient = patientRegistry.find(patient => Number(patient.id) === Number(entry.patientId));
        const birthDate = entry.patientBirthDate || registeredPatient?.birthDate || "";
        return {
          number: String(index + 1).padStart(2, "0"),
          sector: entry.wardName.slice(0, 120),
          bed: String(entry.bedId || "-"),
          patient: entry.patientName.slice(0, 200),
          age: getPatientAgeLabel(birthDate) || "-",
          interventions: entry.interventions.slice(0, 1000),
          observation: `${entry.status === "BAIXA" ? "[Alta/baixa] " : ""}${entry.observation}`.slice(0, 2000)
        };
      })
    : [];
  report.printMode = String(closingShift.serviceType || "").trim().toUpperCase() === "NIR"
    ? "nir"
    : (String(closingShift.serviceType || "").trim().toUpperCase() === "PSICOLOGIA"
      ? "psychology"
      : (String(closingShift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL" ? "social_service" : "default"));
  report.nirAcceptedSnapshot = Array.isArray(closingShift.nirAcceptedSnapshot)
    ? closingShift.nirAcceptedSnapshot.map(patient => ({ ...patient }))
    : [];
  report.nirExternalRegulations = Array.isArray(closingShift.nirExternalRegulationsSnapshot)
    ? closingShift.nirExternalRegulationsSnapshot.map(item => ({ ...item }))
    : [];
  report.psychologyAttendances = Array.isArray(closingShift.psychologyAttendanceSnapshot)
    ? closingShift.psychologyAttendanceSnapshot.map(item => ({ ...item }))
    : [];
  closingShift.reportSnapshot = report;
  if (String(closingShift.serviceType || "").trim().toUpperCase() === "SERVICO_SOCIAL") {
    clearActiveSocialServiceShiftDrafts();
  }
  if (!Array.isArray(req.user.shifts)) req.user.shifts = [];
  req.user.shifts.unshift(closingShift);
  req.user.shifts = req.user.shifts.slice(0, 100);
  req.user.activeShifts = getUserActiveShifts(req.user)
    .filter(shift => String(shift.id) !== String(closingShift.id));
  req.user.activeShift = req.user.activeShifts.at(-1) || null;
  await persistState();
  res.json({ ok: true, user: sanitizeUser(req.user), report });
});

app.get("/api/nir/shift-reports", requireAuth, (req, res) => {
  const reports = users.flatMap(owner =>
    (Array.isArray(owner.shifts) ? owner.shifts : [])
      .filter(shift =>
        shift
        && shift.closedAt
        && String(shift.serviceType || "").trim().toUpperCase() === "NIR"
      )
      .map(shift => ({
        id: String(shift.id),
        ownerUsername: shift.ownerUsername || owner.username || "",
        ownerName: shift.ownerName || owner.nome || owner.username || "",
        shiftDate: shift.shiftDate || (shift.openedAt ? String(shift.openedAt).slice(0, 10) : ""),
        openedAt: shift.openedAt || "",
        closedAt: shift.closedAt || "",
        shiftLength: shift.shiftLength || "12H",
        shiftPeriod: shift.shiftPeriod || "DIA"
      }))
  ).sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
  res.json({ reports });
});

app.post("/api/nir/shift-reports/:shiftId/open", requireAuth, (req, res) => {
  const owner = users.find(user =>
    (Array.isArray(user.shifts) ? user.shifts : []).some(shift =>
      String(shift?.id) === String(req.params.shiftId)
      && shift.closedAt
      && String(shift.serviceType || "").trim().toUpperCase() === "NIR"
    )
  );
  const shift = owner?.shifts?.find(item =>
    String(item?.id) === String(req.params.shiftId)
    && item.closedAt
    && String(item.serviceType || "").trim().toUpperCase() === "NIR"
  );
  if (!owner || !shift) return res.status(404).json({ error: "Ficha finalizada do NIR não encontrada." });
  if (owner.username !== req.user.username) {
    const adminPassword = String(req.body?.adminPassword || "");
    const validAdminPassword = adminPassword
      && users.some(user => user.role === "admin" && String(user.password || "") === adminPassword);
    if (!validAdminPassword) {
      return res.status(403).json({ error: "Senha do administrador incorreta ou não informada." });
    }
  }

  const savedReport = shift.reportSnapshot || buildShiftReport(owner, shift);
  const team = shift.team || {};
  res.json({
    report: {
      printMode: "nir",
      shift: {
        id: shift.id,
        openedAt: shift.openedAt || "",
        closedAt: shift.closedAt || "",
        workPeriods: Array.isArray(shift.workPeriods) ? shift.workPeriods : [],
        shiftDate: shift.shiftDate || "",
        wardNome: "NIR",
        serviceType: "NIR",
        shiftLength: shift.shiftLength || "12H",
        shiftPeriod: shift.shiftPeriod || "DIA",
        username: shift.ownerUsername || owner.username || "",
        nome: shift.ownerName || owner.nome || owner.username || "",
        team: {
          enfermeiroResponsavel: shift.ownerName || owner.nome || owner.username || "",
          auxiliarAdministrativo: String(team.auxiliarAdministrativo || "").trim()
        },
        nursingReport: String(shift.nursingReport || "").trim(),
        nursingReportUpdatedAt: String(shift.nursingReportUpdatedAt || "").trim()
      },
      nirAcceptedSnapshot: Array.isArray(shift.nirAcceptedSnapshot)
        ? shift.nirAcceptedSnapshot.map(patient => ({ ...patient }))
        : (Array.isArray(savedReport.nirAcceptedSnapshot) ? savedReport.nirAcceptedSnapshot.map(patient => ({ ...patient })) : []),
      nirExternalRegulations: Array.isArray(shift.nirExternalRegulationsSnapshot)
        ? shift.nirExternalRegulationsSnapshot.map(item => ({ ...item }))
        : (Array.isArray(savedReport.nirExternalRegulations) ? savedReport.nirExternalRegulations.map(item => ({ ...item })) : [])
    }
  });
});

app.get("/api/shifts/:shiftId/report", requireAuth, (req, res) => {
  const requestedOwner = String(req.query.ownerUsername || req.user.username).trim();
  if (requestedOwner !== req.user.username && req.user.role !== "admin") {
    return res.status(403).json({ error: "Apenas administradores podem consultar relatórios de outros profissionais." });
  }
  const owner = users.find(user => user.username === requestedOwner);
  if (!owner) return res.status(404).json({ error: "Profissional do plantão não encontrado." });
  const shift = (Array.isArray(owner.shifts) ? owner.shifts : [])
    .find(item => String(item.id) === String(req.params.shiftId));
  if (!shift || !shift.closedAt) return res.status(404).json({ error: "Relatório de plantão encerrado não encontrado." });
  const report = shift.reportSnapshot
    ? {
      ...shift.reportSnapshot,
      summary: {
        ...(shift.reportSnapshot.summary || {}),
        dispositivos: getShiftProcedureSummary(
          wards.find(ward => Number(ward.id) === Number(shift.wardId)),
          shift
        )
      }
    }
    : buildShiftReport(owner, shift);
  res.json({
    report: {
      ...report,
      printMode: report.printMode || (String(shift.serviceType || "").toUpperCase() === "PSICOLOGIA"
        ? "psychology"
        : (String(shift.serviceType || "").toUpperCase() === "SERVICO_SOCIAL"
          ? "social_service"
          : (String(shift.serviceType || "").toUpperCase() === "NIR" ? "nir" : "default")))
    }
  });
});

app.get("/api/shifts/history", requireAuth, requireAdmin, (req, res) => {
  const shifts = users.flatMap(owner => {
    const activeShifts = getUserActiveShifts(owner);
    const historicalShifts = Array.isArray(owner.shifts) ? owner.shifts : [];
    const seen = new Set();
    return [...activeShifts, ...historicalShifts]
      .filter(shift => {
        const key = String(shift.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(shift => sanitizeShiftHistoryEntry(shift, owner));
  }).sort((a, b) =>
    String(b.shiftDate || b.openedAt || "").localeCompare(String(a.shiftDate || a.openedAt || ""))
  );
  res.json({ shifts });
});

app.post("/api/shifts/:shiftId/reopen-requests", requireAuth, async (req, res) => {
  const shift = (Array.isArray(req.user.shifts) ? req.user.shifts : [])
    .find(item => String(item.id) === String(req.params.shiftId));
  if (!shift || !shift.closedAt) return res.status(404).json({ error: "Plantão encerrado não encontrado." });
  const activeShiftForSameService = getUserActiveShifts(req.user).some(activeShift =>
    Number(activeShift.wardId) === Number(shift.wardId)
    && String(activeShift.serviceType || "").trim().toUpperCase() === String(shift.serviceType || "").trim().toUpperCase()
  );
  if (activeShiftForSameService) {
    return res.status(409).json({ error: "Feche o plantão atual deste setor antes de solicitar a reabertura." });
  }
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 10) return res.status(400).json({ error: "Informe o motivo da reabertura com pelo menos 10 caracteres." });
  if (reason.length > 1000) return res.status(400).json({ error: "O motivo da reabertura deve ter no máximo 1.000 caracteres." });
  if (!Array.isArray(shift.reopenRequests)) shift.reopenRequests = [];
  const pendingRequest = shift.reopenRequests.find(item => item.status === "pending");
  if (pendingRequest) return res.status(409).json({ error: "Já existe uma solicitação de reabertura aguardando análise." });
  const request = {
    id: createRecordId(),
    reason,
    status: "pending",
    requestedAt: new Date().toISOString(),
    requestedBy: req.user.username
  };
  shift.reopenRequests.push(request);
  shift.reopenRequests = shift.reopenRequests.slice(-20);
  addUserAction(req.user, "SHIFT_REOPEN_REQUEST", "Solicitou reabertura de plantão encerrado", {
    shiftId: shift.id,
    wardId: shift.wardId,
    wardNome: shift.wardNome,
    reason
  });
  await persistState();
  res.status(201).json({ ok: true, request });
});

app.get("/api/shifts/authorization-requests", requireAuth, requireNursingCoordinator, (req, res) => {
  const requests = shiftAuthorizationRequests
    .filter(request => request.status === "pending")
    .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
    .map(request => ({ ...request }));
  res.json({ requests });
});

app.post("/api/shifts/authorization-requests", requireAuth, async (req, res) => {
  const wardId = Number(req.body?.wardId);
  const ward = wards.find(item => Number(item.id) === wardId && !isWardArchived(item));
  if (!Number.isInteger(wardId) || !ward) {
    return res.status(400).json({ error: "Selecione um setor válido para solicitar autorização." });
  }
  if (getUserActiveShifts(req.user).some(shift => Number(shift.wardId) === wardId && !shift.serviceType)) {
    return res.status(409).json({ error: "Você já tem um plantão aberto neste setor." });
  }
  const shiftDate = getCurrentIsoDate();
  const activeShiftOwner = findActiveShiftOwnerForDay(ward.id, shiftDate);
  if (!activeShiftOwner) {
    return res.status(409).json({ error: "Este setor não possui outro plantão aberto; tente abrir o plantão normalmente." });
  }
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 10) {
    return res.status(400).json({ error: "Informe o motivo da solicitação com pelo menos 10 caracteres." });
  }
  if (reason.length > 1000) {
    return res.status(400).json({ error: "O motivo da solicitação deve ter no máximo 1.000 caracteres." });
  }
  const pendingRequest = shiftAuthorizationRequests.find(request =>
    request.status === "pending"
    && request.requesterUsername === req.user.username
    && Number(request.wardId) === Number(ward.id)
    && request.shiftDate === shiftDate
  );
  if (pendingRequest) {
    return res.status(409).json({ error: "Sua solicitação para este setor já está aguardando o coordenador." });
  }
  let shiftLength = String(req.body?.shiftLength || "").trim().toUpperCase() === "24H" ? "24H" : "12H";
  let shiftPeriod = String(req.body?.shiftPeriod || "").trim().toUpperCase();
  if (shiftLength === "24H") shiftPeriod = "COMPLETO";
  if (!["DIA", "NOITE", "COMPLETO"].includes(shiftPeriod)) shiftPeriod = "DIA";
  const request = {
    id: createRecordId(),
    status: "pending",
    requesterUsername: req.user.username,
    requesterName: req.user.nome || req.user.username,
    wardId: ward.id,
    wardName: ward.nome,
    shiftDate,
    shiftLength,
    shiftPeriod,
    reason,
    requestedAt: new Date().toISOString(),
    decidedAt: "",
    decidedBy: "",
    decisionNote: "",
    usedAt: "",
    shiftId: null
  };
  shiftAuthorizationRequests.push(request);
  addUserAction(req.user, "SHIFT_AUTHORIZATION_REQUEST", `Solicitou autorização para abrir plantão em ${ward.nome}`, {
    requestId: request.id,
    wardId: ward.id,
    wardNome: ward.nome,
    reason
  });
  await persistState();
  res.status(201).json({ ok: true, request });
});

app.post("/api/shifts/authorization-requests/:requestId/decision", requireAuth, requireNursingCoordinator, async (req, res) => {
  const decision = String(req.body?.decision || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(decision)) {
    return res.status(400).json({ error: "Decisão inválida." });
  }
  const request = shiftAuthorizationRequests.find(item =>
    item.id === String(req.params.requestId)
    && item.status === "pending"
  );
  if (!request) {
    return res.status(404).json({ error: "Solicitação pendente não encontrada." });
  }
  const requester = users.find(user => user.username === request.requesterUsername);
  if (!requester) {
    return res.status(404).json({ error: "O profissional que solicitou autorização não está mais cadastrado." });
  }
  request.status = decision === "approve" ? "approved" : "rejected";
  request.decidedAt = new Date().toISOString();
  request.decidedBy = req.user.nome || req.user.username;
  request.decisionNote = String(req.body?.note || "").trim().slice(0, 500);
  addUserAction(requester, decision === "approve" ? "SHIFT_AUTHORIZATION_APPROVED" : "SHIFT_AUTHORIZATION_REJECTED",
    decision === "approve"
      ? `O coordenador autorizou a abertura de plantão em ${request.wardName}`
      : `O coordenador negou a abertura de plantão em ${request.wardName}`, {
      requestId: request.id,
      wardId: request.wardId,
      wardNome: request.wardName,
      decidedBy: request.decidedBy,
      decisionNote: request.decisionNote
    });
  await persistState();
  res.json({ ok: true, request: { ...request } });
});

app.get("/api/shifts/reopen-requests", requireAuth, requireAdmin, (req, res) => {
  const requests = [];
  for (const owner of users) {
    for (const shift of Array.isArray(owner.shifts) ? owner.shifts : []) {
      for (const request of Array.isArray(shift.reopenRequests) ? shift.reopenRequests : []) {
        if (request.status !== "pending") continue;
        requests.push({
          id: request.id,
          shiftId: shift.id,
          requestedAt: request.requestedAt || "",
          reason: request.reason || "",
          ownerUsername: owner.username,
          ownerName: owner.nome || owner.username,
          shiftDate: shift.shiftDate || "",
          serviceType: shift.serviceType || "",
          wardNome: shift.wardNome || "",
          shiftLength: shift.shiftLength || "12H",
          shiftPeriod: shift.shiftPeriod || "DIA",
          openedAt: shift.openedAt || "",
          closedAt: shift.closedAt || ""
        });
      }
    }
  }
  requests.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  res.json({ requests });
});

app.post("/api/shifts/reopen-requests/:requestId/decision", requireAuth, requireAdmin, async (req, res) => {
  const decision = String(req.body?.decision || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "Decisão inválida." });
  let match = null;
  for (const owner of users) {
    for (const shift of Array.isArray(owner.shifts) ? owner.shifts : []) {
      const request = (Array.isArray(shift.reopenRequests) ? shift.reopenRequests : [])
        .find(item => String(item.id) === String(req.params.requestId));
      if (request) {
        match = { owner, shift, request };
        break;
      }
    }
    if (match) break;
  }
  if (!match || match.request.status !== "pending" || !match.shift.closedAt) {
    return res.status(404).json({ error: "Solicitação pendente não encontrada." });
  }
  if (decision === "approve") {
    const activeShiftForSameService = getUserActiveShifts(match.owner).some(activeShift =>
      Number(activeShift.wardId) === Number(match.shift.wardId)
      && String(activeShift.serviceType || "").trim().toUpperCase() === String(match.shift.serviceType || "").trim().toUpperCase()
    );
    if (activeShiftForSameService) {
      return res.status(409).json({ error: "O profissional precisa fechar o plantão atual deste setor antes da reabertura." });
    }
    const conflict = findActiveShiftOwnerForDay(match.shift.wardId, match.shift.shiftDate, match.shift.serviceType || "");
    if (conflict) return res.status(409).json({ error: `Já existe um plantão aberto neste serviço por ${conflict.nome || conflict.username}.` });
  }
  const decidedAt = new Date().toISOString();
  match.request.status = decision === "approve" ? "approved" : "rejected";
  match.request.decidedAt = decidedAt;
  match.request.decidedBy = req.user.nome || req.user.username;
  match.request.decisionNote = String(req.body?.note || "").trim().slice(0, 500);
  if (!Array.isArray(match.shift.reopenHistory)) match.shift.reopenHistory = [];
  match.shift.reopenHistory.push({
    requestId: match.request.id,
    decision: match.request.status,
    decidedAt,
    decidedBy: match.request.decidedBy,
    note: match.request.decisionNote
  });
  match.shift.reopenHistory = match.shift.reopenHistory.slice(-50);
  if (decision === "approve") {
    const shift = match.shift;
    if (!Array.isArray(shift.workPeriods) || !shift.workPeriods.length) {
      shift.workPeriods = [{ openedAt: shift.openedAt || "", closedAt: shift.closedAt }];
    }
    shift.workPeriods.push({ openedAt: decidedAt, closedAt: null });
    shift.previousClosedAt = shift.closedAt;
    shift.closedAt = null;
    shift.reopenedAt = decidedAt;
    shift.reopenedBy = match.request.decidedBy;
    match.owner.shifts = match.owner.shifts.filter(item => item !== shift);
    if (!Array.isArray(match.owner.activeShifts)) match.owner.activeShifts = [];
    match.owner.activeShifts.push(shift);
    match.owner.activeShift = shift;
    const action = {
      id: createRecordId(),
      at: decidedAt,
      username: req.user.username,
      authorName: req.user.nome || req.user.username,
      type: "SHIFT_REOPEN_APPROVED",
      description: `Autorizou a reabertura do plantão de ${match.owner.nome || match.owner.username}`,
      meta: { shiftId: shift.id, wardId: shift.wardId, wardNome: shift.wardNome },
      shiftId: shift.id
    };
    if (!Array.isArray(shift.actions)) shift.actions = [];
    shift.actions.push(action);
    if (!Array.isArray(match.owner.actions)) match.owner.actions = [];
    match.owner.actions.unshift(action);
    match.owner.actions = match.owner.actions.slice(0, 300);
  }
  await persistState();
  res.json({ ok: true, decision: match.request.status, user: sanitizeUser(match.owner) });
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
  const periodStart = period.from ? parseDashboardDate(period.from) : null;
  const now = new Date();
  let periodEnd = period.to ? parseDashboardDate(period.to, true) : now;
  if (periodEnd > now) periodEnd = now;
  const asOf = periodEnd || now;
  const allBeds = sourceWards.flatMap(ward => ward.beds.map(bed => ({ ...bed, setor: ward.nome })));
  const currentCounts = computeCounts(allBeds);
  const totalBeds = currentCounts.TOTAL || 0;
  const admissions = getDashboardAdmissions(sourceWards);
  const activeAdmissions = admissions
    .map(admission => ({ admission, segment: dashboardSegmentAt(admission, asOf) }))
    .filter(item => item.segment && (!selectedWard || Number(item.segment.wardId) === Number(selectedWard.id)));
  const activeByBed = new Map();
  for (const item of activeAdmissions) {
    const key = `${item.segment.wardId}:${item.segment.bedId}`;
    const previous = activeByBed.get(key);
    if (!previous || String(item.admission.admittedAt || "") > String(previous.admission.admittedAt || "")) {
      activeByBed.set(key, item);
    }
  }
  const currentPatients = Array.from(activeByBed.values());
  const uniquePatients = new Set(currentPatients.map(({ admission }) => admission.patientId || admission.id));
  const periodAdmissionEvents = admissions.flatMap(admission => admission.segments
    .filter((segment, index) => selectedWard
      ? Number(segment.wardId) === Number(selectedWard.id)
      : index === 0)
    .filter(segment => dashboardEventInPeriod(segment.startAt, periodStart, periodEnd))
    .map(segment => ({ admission, segment })));

  const outcomes = admissions
    .filter(admission => dashboardEventInPeriod(admission.dischargedAt, periodStart, periodEnd))
    .map(admission => ({
      admission,
      outcome: dashboardAdmissionOutcome(admission),
      segment: admission.segments[admission.segments.length - 1]
    }))
    .filter(item => item.outcome && item.segment
      && (!selectedWard || Number(item.segment.wardId) === Number(selectedWard.id)));

  const outcomeKeys = new Set(outcomes.map(({ admission, outcome, segment }) =>
    `${segment.wardId}:${segment.bedId}:${outcome}:${String(admission.dischargedAt).slice(0, 10)}`
  ));
  for (const ward of sourceWards) {
    for (const outcome of Array.isArray(ward.desfechosCenso) ? ward.desfechosCenso : []) {
      const type = String(outcome?.tipo || "").trim().toUpperCase();
      if (!["ALTA", "OBITO", "EVASAO", "TRANSFERENCIA_EXTERNA"].includes(type)) continue;
      if (!dashboardEventInPeriod(outcome.createdAt, periodStart, periodEnd)) continue;
      const key = `${ward.id}:${outcome.bedId}:${type}:${String(outcome.createdAt).slice(0, 10)}`;
      if (outcomeKeys.has(key)) continue;
      outcomeKeys.add(key);
      outcomes.push({ outcome: type, segment: { wardId: ward.id } });
    }
  }

  const outcomeCounts = outcomes.reduce((counts, item) => {
    counts[item.outcome] = (counts[item.outcome] || 0) + 1;
    return counts;
  }, {});
  const altasAcumuladas = outcomeCounts.ALTA || 0;
  const obitosAcumulados = outcomeCounts.OBITO || 0;
  const evasoesNoPeriodo = outcomeCounts.EVASAO || 0;
  const movementCount = Object.values(outcomeCounts).reduce((sum, count) => sum + count, 0);

  const pathologyRecord = {};
  for (const { admission } of periodAdmissionEvents) {
    const diagnosis = String(admission.diagnosis || "").trim() || "Não informado";
    pathologyRecord[diagnosis] = (pathologyRecord[diagnosis] || 0) + 1;
  }

  const procedureRecord = {};
  const proceduresById = new Set();
  for (const ward of sourceWards) {
    const procedures = [
      ...(Array.isArray(ward.procedimentosCenso) ? ward.procedimentosCenso : []),
      ...(ward.beds || []).flatMap(bed => Array.isArray(bed.procedimentosHistorico) ? bed.procedimentosHistorico : [])
    ];
    for (const procedure of procedures) {
      const procedureDate = procedure?.createdAt || procedure?.at || "";
      if (!dashboardEventInPeriod(procedureDate, periodStart, periodEnd)) continue;
      const key = String(procedure?.id || `${ward.id}:${procedureDate}:${procedure?.tipo || procedure?.procedure || ""}`);
      if (proceduresById.has(key)) continue;
      proceduresById.add(key);
      const name = String(procedure?.tipo || procedure?.procedure || procedure?.name || "").trim();
      if (name) procedureRecord[name] = (procedureRecord[name] || 0) + 1;
    }
  }

  const staySamples = admissions.filter(admission => {
    const segments = selectedWard
      ? admission.segments.filter(segment => Number(segment.wardId) === Number(selectedWard.id))
      : admission.segments.slice(0, 1);
    return segments.some(segment => dashboardSegmentOverlapsPeriod(segment, periodStart, periodEnd))
      && (!periodEnd || !parseDashboardDate(admission.admittedAt) || parseDashboardDate(admission.admittedAt) <= periodEnd);
  }).map(admission => {
    const start = parseDashboardDate(admission.admittedAt || admission.admissionEventAt);
    const discharge = parseDashboardDate(admission.dischargedAt);
    const end = discharge && discharge < asOf ? discharge : asOf;
    if (!start) return 0;
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.floor((endDay - startDay) / (24 * 60 * 60 * 1000)));
  });
  const permanenceBands = { "0-3 dias": 0, "4-7 dias": 0, "8-15 dias": 0, "16+ dias": 0 };
  for (const stay of staySamples) {
    if (stay <= 3) permanenceBands["0-3 dias"] += 1;
    else if (stay <= 7) permanenceBands["4-7 dias"] += 1;
    else if (stay <= 15) permanenceBands["8-15 dias"] += 1;
    else permanenceBands["16+ dias"] += 1;
  }

  const setorChart = sourceWards.map(ward => {
    const wardBeds = ward.beds || [];
    const counts = computeCounts(wardBeds);
    const occupiedCount = Array.from(activeByBed.keys()).filter(key => key.startsWith(`${ward.id}:`)).length;
    const taxa = counts.TOTAL ? Math.round((occupiedCount / counts.TOTAL) * 1000) / 10 : 0;
    return {
      label: ward.nome,
      ocupados: occupiedCount,
      leitos: counts.TOTAL,
      taxa
    };
  }).sort((a, b) => b.taxa - a.taxa || a.label.localeCompare(b.label, "pt-BR"));

  const bedActionHistory = getDashboardBedActionHistory();
  let blockedBedsAtSnapshot = 0;
  for (const ward of sourceWards) {
    for (const bed of ward.beds || []) {
      const key = `${ward.id}:${bed.id}`;
      const historicalStatus = activeByBed.has(key)
        ? "OCUPADO"
        : getDashboardBedStatusAt(ward, bed, asOf, bedActionHistory);
      if (historicalStatus === "BLOQUEADO") blockedBedsAtSnapshot += 1;
    }
  }
  const taxaOcupacao = totalBeds ? Math.round((currentPatients.length / totalBeds) * 1000) / 10 : 0;
  const taxaBloqueio = totalBeds ? Math.round((blockedBedsAtSnapshot / totalBeds) * 1000) / 10 : 0;
  const taxaRotatividade = totalBeds
    ? Math.round((movementCount / totalBeds) * 1000) / 10
    : 0;
  const taxaEvasao = periodAdmissionEvents.length
    ? Math.round((evasoesNoPeriodo / periodAdmissionEvents.length) * 1000) / 10
    : 0;

  const matchesServiceWard = (wardIdValue, wardNameValue) => {
    if (!selectedWard) return true;
    const scopedWardId = Number(wardIdValue);
    if (Number.isInteger(scopedWardId) && scopedWardId > 0) {
      return scopedWardId === Number(selectedWard.id);
    }
    return normalizePersonName(wardNameValue) === normalizePersonName(selectedWard.nome);
  };
  const isActiveServiceRequest = request => {
    const status = String(request?.status || "").trim().toUpperCase();
    return status !== "BAIXA"
      && !request?.closedAt
      && Boolean(request?.requested || request?.requestedAt || request?.viewedAt || request?.startedAt);
  };
  const activePsychologyPatients = new Set();
  const activeSocialServicePatients = new Set();
  for (const patient of patientRegistry) {
    if (patient?.deletedAt) continue;
    const admission = patient.currentAdmission || patient.lastAdmission;
    if (!admission) continue;
    if (!matchesServiceWard(admission.wardId, admission.wardNome)) continue;
    const psychologyRequest = patient.currentAdmission?.psychologyRequest || admission.psychologyRequest;
    const socialRequest = patient.currentAdmission?.serviceSocialRequest || admission.serviceSocialRequest;
    if (isActiveServiceRequest(psychologyRequest)) {
      activePsychologyPatients.add(Number(patient.id) || String(patient.nome || ""));
    }
    if (isActiveServiceRequest(socialRequest)) {
      activeSocialServicePatients.add(Number(patient.id) || String(patient.nome || ""));
    }
  }
  const countActiveManualRequests = requests => requests.filter(entry => {
    if (String(entry?.status || "SOLICITADO").trim().toUpperCase() === "BAIXA" || entry?.closedAt) return false;
    return matchesServiceWard(entry?.wardId, entry?.sectorOrReason || "");
  }).length;
  const activePsychologyCount = activePsychologyPatients.size
    + countActiveManualRequests(psychologyManualRequests);
  const activeSocialServiceCount = activeSocialServicePatients.size
    + countActiveManualRequests(socialServiceManualRequests);

  const psychologyProduction = new Map();
  const openPsychologyShiftIds = new Set(users.flatMap(user =>
    getUserActiveShifts(user)
      .filter(shift => String(shift.serviceType || "").trim().toUpperCase() === "PSICOLOGIA")
      .map(shift => Number(shift.id))
  ));
  for (const rawEntry of psychologyAttendanceEntries) {
    const entry = psychologyAttendanceEntryForClient(rawEntry);
    if (
      entry.status === "EM_ACOMPANHAMENTO"
      && entry.shiftId
      && openPsychologyShiftIds.has(entry.shiftId)
    ) continue;
    if (!dashboardEventInPeriod(entry.createdAt, periodStart, periodEnd)) continue;
    if (!matchesServiceWard(entry.wardId, entry.wardName)) continue;
    psychologyProduction.set(getPsychologyAttendanceKey(entry), entry);
  }

  const socialServiceProduction = new Map();
  const includeSocialProduction = rawEntry => {
    const entry = socialServiceAttendanceEntryForClient(rawEntry);
    if (["observacao_plantao", "acompanhamento"].includes(entry.entryType)) return;
    const entryDate = entry.closedAt || entry.shiftDate;
    if (!dashboardEventInPeriod(entryDate, periodStart, periodEnd)) return;
    if (!matchesServiceWard(entry.wardId, entry.wardName)) return;
    const key = [
      entry.entryType || "",
      entry.shiftId || "",
      entry.patientId || "",
      entry.patientName || "",
      entry.bedId || "",
      entry.category || "",
      entry.entryLabel || "",
      entry.closedAt || "",
      entry.observation || ""
    ].join("|");
    socialServiceProduction.set(key, entry);
  };
  for (const patient of patientRegistry) {
    if (patient?.deletedAt) continue;
    for (const entry of buildPatientSocialSupportHistory(patient.socialSupportHistory)) {
      includeSocialProduction(entry);
    }
  }
  for (const user of users) {
    for (const shift of Array.isArray(user?.shifts) ? user.shifts : []) {
      for (const entry of buildSocialServiceShiftHistoryEntries(shift, user)) {
        includeSocialProduction(entry);
      }
    }
  }
  for (const entry of socialServiceManualAttendanceEntries) {
    includeSocialProduction(entry);
  }

  const nirAcceptedPatients = new Set();
  for (const patient of patientRegistry) {
    if (patient?.deletedAt) continue;
    const admission = patient.currentAdmission || patient.lastAdmission || {};
    if (!matchesServiceWard(admission.wardId, admission.wardNome)) continue;
    for (const [index, event] of (Array.isArray(patient.nirHistory) ? patient.nirHistory : []).entries()) {
      if (String(event?.status || "").trim().toUpperCase() !== "ACEITO") continue;
      if (!dashboardEventInPeriod(event.at, periodStart, periodEnd)) continue;
      nirAcceptedPatients.add(`${Number(patient.id) || patient.nome || "patient"}:${event.at || index}`);
    }
  }
  const nirExternalRegulations = new Set();
  for (const user of users) {
    for (const shift of [
      ...getUserActiveShifts(user),
      ...(Array.isArray(user.shifts) ? user.shifts : [])
    ]) {
      if (String(shift?.serviceType || "").trim().toUpperCase() !== "NIR") continue;
      const regulations = Array.isArray(shift.nirExternalRegulationsSnapshot)
        ? shift.nirExternalRegulationsSnapshot
        : (Array.isArray(shift.nirExternalRegulations) ? shift.nirExternalRegulations : []);
      for (const [index, item] of regulations.entries()) {
        const eventAt = item?.closedAt || item?.endedAt || item?.startedAt || shift.closedAt;
        if (!dashboardEventInPeriod(eventAt, periodStart, periodEnd)) continue;
        nirExternalRegulations.add(`${shift.id || "nir"}:${item?.id || index}`);
      }
    }
  }
  const nirCensusReports = censusDailyReports.filter(report =>
    dashboardEventInPeriod(`${report.periodStartDate}T12:00:00`, periodStart, periodEnd)
    && matchesServiceWard(report.wardId, report.wardName)
  ).length;

  res.json({
    period,
    scope: {
      wardId: selectedWard?.id || null,
      label: selectedWard ? selectedWard.nome : "Todos os setores"
    },
    overview: {
      pacientesInternados: uniquePatients.size,
      leitosTotais: totalBeds,
      admissoesNoPeriodo: periodAdmissionEvents.length,
      mediaPermanencia: average(staySamples),
      taxaOcupacao,
      taxaBloqueio,
      taxaRotatividade,
      taxaEvasao,
      altasAcumuladas,
      obitosAcumulados,
      obitosAcumuladas: obitosAcumulados
    },
    services: {
      nir: {
        activeAttendances: patientRegistry.filter(patient => {
          if (patient?.deletedAt) return false;
          const admission = patient.currentAdmission || patient.lastAdmission;
          if (!admission) return false;
          const request = patient.currentAdmission?.nirRequest || admission.nirRequest || {};
          return isActiveServiceRequest(request)
            && matchesServiceWard(admission.wardId, admission.wardNome);
        }).length,
        production: {
          censusReports: nirCensusReports,
          acceptedPatients: nirAcceptedPatients.size,
          externalRegulations: nirExternalRegulations.size
        }
      },
      socialService: {
        activeAttendances: activeSocialServiceCount,
        production: socialServiceProduction.size
      },
      psychology: {
        activeAttendances: activePsychologyCount,
        production: psychologyProduction.size
      }
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
  const activeShiftUser = users.find(user =>
    getUserActiveShifts(user).some(shift => Number(shift.wardId) === Number(ward.id))
  );

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

  const activeShiftUser = users.find(user =>
    getUserActiveShifts(user).some(shift => Number(shift.wardId) === Number(ward.id))
  );
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
  const censusPeriod = getCensusPeriodBounds();
  const censusPeriodStartDate = getOperationalDayKey(censusPeriod.start);
  const censusReport = censusDailyReports.find(report =>
    Number(report.wardId) === Number(ward.id)
    && report.periodStartDate === censusPeriodStartDate
  );
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
    censusValues: getCensusValuesForPeriod(
      ward,
      censusPeriodStartDate,
      getOperationalDayKey(censusPeriod.end)
    ),
    censusSubmission: censusReport?.sentAt
      ? { sentAt: censusReport.sentAt, sentBy: censusReport.sentBy || "" }
      : null,
    equipe: ward.equipe,
    censusShiftOpen: Boolean(getActiveWardCensusShift(ward.id)),
    procedimentosCenso: getWardCensusProcedures(ward),
    desfechosCenso: getWardCensusOutcomes(ward),
    beds: ward.beds.map(bedForClient)
  });
});

app.post("/api/wards/:wardId/census/send", requireAuth, async (req, res) => {
  const ward = getWardOr404(req, res);
  if (!ward) return;
  const activeShift = req.user.activeShift;
  if (
    !activeShift
    || activeShift.closedAt
    || activeShift.serviceType
    || Number(activeShift.wardId) !== Number(ward.id)
  ) {
    return res.status(403).json({ error: "Assuma o plantão deste setor antes de enviar o censo ao NIR." });
  }

  const period = getCensusPeriodBounds();
  const periodStartDate = getOperationalDayKey(period.start);
  const periodEndDate = getOperationalDayKey(period.end);
  const values = getCensusValuesForPeriod(ward, periodStartDate, periodEndDate);
  const fullValues = Object.fromEntries(censusFieldNames.map(field => [field, 0]));
  Object.assign(fullValues, values);
  const sentAt = new Date().toISOString();
  let report = censusDailyReports.find(item =>
    Number(item.wardId) === Number(ward.id) && item.periodStartDate === periodStartDate
  );
  if (!report) {
    report = {
      id: createRecordId(),
      wardId: Number(ward.id),
      periodStartDate,
      createdAt: sentAt
    };
    censusDailyReports.unshift(report);
  }
  report.wardName = ward.nome;
  report.periodEndDate = periodEndDate;
  report.authorUsername = req.user.username;
  report.authorName = req.user.nome || req.user.username;
  report.shiftId = activeShift.id;
  report.values = fullValues;
  report.submittedAt = sentAt;
  report.automated = false;
  report.sentAt = sentAt;
  report.sentBy = req.user.nome || req.user.username;
  await persistState();
  res.json({
    ok: true,
    censusSubmission: { sentAt: report.sentAt, sentBy: report.sentBy }
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
    fromPreviousStatus: sourceSnapshot.status,
    toPreviousStatus: targetBed.status,
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
  let nirRequestSubmission = null;
  let resetNirWorkflow = false;
  if (Object.prototype.hasOwnProperty.call(payload, "nirRequest")) {
    const incomingRequest = payload.nirRequest;
    if (!incomingRequest || typeof incomingRequest !== "object" || Array.isArray(incomingRequest)) {
      return res.status(400).json({ error: "Solicitação ao NIR inválida." });
    }
    const currentRequest = buildBedRequestState(bed.nirRequest);
    const proposedRequest = buildBedRequestState(incomingRequest);
    const isNewSubmission = proposedRequest.requested && !currentRequest.requested;
    if (isNewSubmission) {
      if (!isBedOccupiedByPatient(bed)) {
        return res.status(409).json({ error: "Só é possível solicitar o NIR para um paciente em leito ocupado." });
      }
      const now = new Date().toISOString();
      const actor = req.user.nome || req.user.username || "";
      nirRequestSubmission = {
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
      };
      payload.nirRequest = nirRequestSubmission;
      resetNirWorkflow = true;
    } else if (!hasActiveServiceShift(req.user, "NIR")) {
      return res.status(403).json({ error: "Abra o plantão NIR antes de alterar os dados dos pacientes aceitos." });
    }
  }
  if (payload.status && !statuses.includes(payload.status)) return res.status(400).json({ error: "Status inválido" });
  if (payload.procedimentos && !Array.isArray(payload.procedimentos)) return res.status(400).json({ error: "Procedimentos inválidos" });
  if (payload.pendenciasStatus && !Array.isArray(payload.pendenciasStatus)) return res.status(400).json({ error: "Pendências inválidas" });
  if (payload.cpf !== undefined) payload.cpf = String(payload.cpf || "").replace(/\D/g, "");

  const nextBedState = normalizeBedData({ ...bed, ...payload });
  if (isBedOccupiedByPatient(nextBedState)) {
    const conflict = findOtherOccupiedBedByIdentity(nextBedState, ward.id, bed.id);
    if (conflict) {
      return res.status(400).json({
        error: `Paciente já internado em ${conflict.ward.nome || "outro setor"}, leito ${conflict.bed.id}. Use a transferência de setor/leito.`
      });
    }
  }

  if (Array.isArray(payload.procedimentos)) {
    const createdBy = req.user.nome || req.user.username;
    const censusShift = getActiveWardCensusShift(ward.id);
    const novosProcedimentos = Array.from(new Set(payload.procedimentos.filter(p => procedureOptions.includes(p))));
    if (novosProcedimentos.length && !censusShift) {
      return res.status(409).json({ error: "Abra o plantão do setor antes de registrar procedimentos." });
    }
    const period = getCensusPeriodBounds();
    const procedimentosVinculadosDoLeito = getWardCensusProcedures(ward).filter(item => Number(item.bedId) === bedId);
    const jaRegistradosNoPeriodo = novosProcedimentos.filter(procedimento =>
      procedimentosVinculadosDoLeito.some(item => {
        const createdAt = new Date(item.createdAt);
        return String(item.tipo || "").toUpperCase() === procedimento
          && !Number.isNaN(createdAt.getTime())
          && createdAt >= period.start
          && createdAt < period.end;
      })
    );
    if (jaRegistradosNoPeriodo.length) {
      return res.status(409).json({
        error: `Já registrado neste período de 24 horas: ${jaRegistradosNoPeriodo.join(", ")}. Consulte o histórico do paciente.`
      });
    }
    for (const procedimento of novosProcedimentos) {
      const registro = {
        id: createRecordId(),
        tipo: procedimento,
        createdAt: new Date().toISOString(),
        createdBy,
        wardId: ward.id,
        bedId: bed.id,
        shiftId: censusShift?.id || null,
        recordedByUsername: req.user.username,
        recordedByName: createdBy
      };
      bed.procedimentosHistorico.push(registro);
      if (!Array.isArray(ward.procedimentosCenso)) ward.procedimentosCenso = [];
      ward.procedimentosCenso.push(registro);
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
  const syncedPatient = syncPatientRegistryWithBed(previous, bed, ward, req.user.nome || req.user.username);
  if (resetNirWorkflow && syncedPatient) {
    syncedPatient.regulationAcceptedAt = "";
    syncedPatient.nirWorkflowStatus = "SOLICITADO";
    syncedPatient.nirAcceptedLocation = "";
    syncedPatient.nirActionReason = "";
    syncedPatient.nirStatusUpdatedAt = nirRequestSubmission.requestedAt;
    syncedPatient.nirStatusUpdatedBy = nirRequestSubmission.requestedBy;
    syncedPatient.nirDischargePending = false;
    syncedPatient.nirDischargeNote = "";
    syncedPatient.nirDischargeAt = "";
    syncedPatient.nirDischargeBy = "";
  }
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
  if (!isBedOccupiedByPatient(bed)) {
    return res.status(409).json({ error: "Não há paciente ocupado neste leito para registrar uma baixa." });
  }
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
  const actor = req.user.nome || req.user.username;
  let patient = findPatientByCurrentLocation(ward.id, bed.id);
  if (!patient) {
    const registeredPatient = findPatientRegistryEntry(bed);
    patient = registeredPatient && !registeredPatient.currentAdmission
      ? registeredPatient
      : createPatientRecordFromBed(bed);
    if (patient !== registeredPatient) patientRegistry.push(patient);
  }
  if (!patient.currentAdmission) ensurePatientAdmissionRecord(patient, ward, bed, actor);
  const outcomeReasonMap = {
    ALTA: "Desfecho da internação",
    OBITO: "Desfecho da internação",
    EVASAO: "Paciente evadiu da unidade",
    TRANSFERENCIA_EXTERNA: note
  };
  closePatientAdmissionByBedSnapshot(bed, ward, type, actor, outcomeReasonMap[type] || "Desfecho da internação");
  clearBedPatientData(bed, "LIVRE");
  const actionLabelMap = {
    ALTA: "Registrou alta",
    OBITO: "Registrou óbito",
    EVASAO: "Registrou evasão",
    TRANSFERENCIA_EXTERNA: "Registrou transferência externa"
  };
  const action = addUserAction(req.user, type, `${actionLabelMap[type] || "Registrou desfecho"} no leito ${bed.id}`, {
    wardId: ward.id,
    wardNome: ward.nome,
    bedId: bed.id,
    patientId: patient.id,
    patientName,
    patient: patientName,
    note
  });
  if (!Array.isArray(ward.desfechosCenso)) ward.desfechosCenso = [];
  const censusShift = getActiveWardCensusShift(ward.id);
  ward.desfechosCenso.push({
    id: action.id,
    tipo: type,
    createdAt: action.at,
    wardId: ward.id,
    bedId: bed.id,
    patientId: patient.id,
    patientName,
    note,
    shiftId: censusShift?.id || null,
    recordedByUsername: req.user.username,
    recordedByName: actor
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
    url: isLocalStorageProvider ? null : supabaseUrl,
    table: isLocalStorageProvider ? null : supabaseTable
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
