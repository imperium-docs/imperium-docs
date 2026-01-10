const normalizeBase = (base: string) => {
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
};

export const getAuthApiBase = () => {
  return normalizeBase(import.meta.env.VITE_AUTH_API_BASE ?? "");
};

export const buildAuthUrl = (path: string) => {
  const base = getAuthApiBase();
  if (!base) return path;
  return new URL(path, base).toString();
};

export const sendAuthEvent = async (event: string, provider?: string) => {
  const base = getAuthApiBase();
  if (!base) return;
  const payload = JSON.stringify({ event, provider });
  const endpoint = buildAuthUrl("/analytics/event");

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(endpoint, blob);
    return;
  }

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
  } catch (error) {
    // Ignore analytics errors.
  }
};

export const fetchProviderStats = async () => {
  const base = getAuthApiBase();
  if (!base) return [] as Array<{ provider: string; clicks: number; success: number }>;
  const response = await fetch(buildAuthUrl("/analytics/providers"));
  if (!response.ok) return [];
  const data = await response.json();
  return (data?.providers ?? []) as Array<{
    provider: string;
    clicks: number;
    success: number;
  }>;
};

