type ConsentState = {
  version: string;
  granted: boolean;
  purposes: string[];
};

type TrackerOptions = {
  apiBase: string;
  source?: "web" | "app" | "api";
};

type TrackPayload = {
  event_name: string;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

const STORAGE_KEYS = {
  deviceId: "imperium_device_id",
  userId: "imperium_user_id",
  sessionId: "imperium_session_id",
  sessionLast: "imperium_session_last",
  consent: "imperium_consent",
  queue: "imperium_event_queue",
  firstTouch: "imperium_first_touch",
  lastTouch: "imperium_last_touch"
};

const forbiddenKeys = [
  "email",
  "e-mail",
  "phone",
  "telefone",
  "cpf",
  "rg",
  "address",
  "endereco",
  "first_name",
  "last_name",
  "nome",
  "full_name",
  "user_name"
];

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function hasPII(payload?: Record<string, unknown>) {
  if (!payload) return false;
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase().replace(/\s+/g, "_");
    if (forbiddenKeys.includes(normalizedKey)) return true;
    if (typeof value === "string" && emailPattern.test(value)) return true;
  }
  return false;
}

function loadJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getOrCreateId(key: string) {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(key, id);
  return id;
}

function getSessionId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const last = Number(window.localStorage.getItem(STORAGE_KEYS.sessionLast));
  const now = Date.now();
  const thirtyMinutes = 30 * 60 * 1000;
  const existing = window.localStorage.getItem(STORAGE_KEYS.sessionId);
  if (!existing || !last || now - last > thirtyMinutes) {
    const id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEYS.sessionId, id);
    window.localStorage.setItem(STORAGE_KEYS.sessionLast, String(now));
    return id;
  }
  window.localStorage.setItem(STORAGE_KEYS.sessionLast, String(now));
  return existing;
}

function extractAttribution() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const utm = {
    utm_source: url.searchParams.get("utm_source") || undefined,
    utm_medium: url.searchParams.get("utm_medium") || undefined,
    utm_campaign: url.searchParams.get("utm_campaign") || undefined,
    utm_term: url.searchParams.get("utm_term") || undefined,
    utm_content: url.searchParams.get("utm_content") || undefined,
    referrer: document.referrer || undefined,
    landing_page: url.pathname
  };
  const hasAny =
    utm.utm_source ||
    utm.utm_campaign ||
    utm.utm_medium ||
    utm.referrer ||
    utm.landing_page;
  return hasAny ? utm : null;
}

async function sendEvents(apiBase: string, payloads: any[]) {
  const response = await fetch(`${apiBase}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ events: payloads })
  });
  if (!response.ok) {
    throw new Error("Failed to send events");
  }
}

export function initTracker(options: TrackerOptions) {
  const apiBase = options.apiBase;
  const source = options.source || "web";

  const deviceId = getOrCreateId(STORAGE_KEYS.deviceId);
  const userId = getOrCreateId(STORAGE_KEYS.userId);
  const sessionId = getSessionId();

  const queue = loadJson<any[]>(STORAGE_KEYS.queue) || [];

  const flushQueue = async (force = false) => {
    const consent = loadJson<ConsentState>(STORAGE_KEYS.consent);
    const allowed = consent?.granted && consent.purposes.includes("analytics");
    const sendable = queue.filter((item) => {
      if (force) return true;
      if (item.event_name.startsWith("consent.")) return true;
      return allowed;
    });
    if (!sendable.length) return;
    await sendEvents(apiBase, sendable);
    const remaining = queue.filter((item) => !sendable.includes(item));
    saveJson(STORAGE_KEYS.queue, remaining);
    queue.length = 0;
    queue.push(...remaining);
  };

  const track = async (payload: TrackPayload) => {
    if (hasPII(payload.properties) || hasPII(payload.context)) return;
    const event = {
      event_id: crypto.randomUUID(),
      event_name: payload.event_name,
      schema_version: 1,
      event_time: new Date().toISOString(),
      user_id: userId,
      session_id: sessionId,
      device_id: deviceId,
      source,
      properties: payload.properties || {},
      context: payload.context || {}
    };
    queue.push(event);
    saveJson(STORAGE_KEYS.queue, queue);
    await flushQueue(false).catch(() => null);
  };

  const syncAttribution = async () => {
    const attr = extractAttribution();
    if (!attr) return;
    const firstTouch = loadJson(STORAGE_KEYS.firstTouch);
    if (!firstTouch) {
      saveJson(STORAGE_KEYS.firstTouch, attr);
      queue.push({
        event_id: crypto.randomUUID(),
        event_name: "system.attribution_captured",
        schema_version: 1,
        event_time: new Date().toISOString(),
        user_id: userId,
        session_id: sessionId,
        device_id: deviceId,
        source,
        properties: { ...attr, touch: "first" }
      });
    }
    saveJson(STORAGE_KEYS.lastTouch, attr);
    queue.push({
      event_id: crypto.randomUUID(),
      event_name: "system.attribution_captured",
      schema_version: 1,
      event_time: new Date().toISOString(),
      user_id: userId,
      session_id: sessionId,
      device_id: deviceId,
      source,
      properties: { ...attr, touch: "last" }
    });
    saveJson(STORAGE_KEYS.queue, queue);
    await flushQueue(false).catch(() => null);
  };

  const fetchConsentVersion = async () => {
    const res = await fetch(`${apiBase}/api/consent/version/current`, {
      credentials: "include"
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ version: string }>;
  };

  const submitConsent = async (granted: boolean, purposes: string[]) => {
    const versionPayload = await fetchConsentVersion();
    if (!versionPayload) return null;
    const consentState = {
      version: versionPayload.version,
      granted,
      purposes
    };
    saveJson(STORAGE_KEYS.consent, consentState);
    await fetch(`${apiBase}/api/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        user_id: userId,
        version: versionPayload.version,
        granted,
        purposes,
        source
      })
    });
    await track({
      event_name: "consent.viewed",
      properties: { version: versionPayload.version }
    });
    await flushQueue(true).catch(() => null);
    return consentState;
  };

  syncAttribution().catch(() => null);

  return {
    track,
    flushQueue,
    getConsent: () => loadJson<ConsentState>(STORAGE_KEYS.consent),
    submitConsent
  };
}
