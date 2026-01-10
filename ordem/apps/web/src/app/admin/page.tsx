"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type AdminUser = {
  userId: string;
  email: string;
  role: "admin" | "analyst" | "support";
  workspaceId: string;
};

type OverviewCard = {
  key: string;
  label: string;
  value: number;
  delta: number;
};

type FunnelStep = {
  name: string;
  count: number;
};

type Audience = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  members: number;
};

type UserRow = {
  id: string;
  email: string | null;
  status: string;
  created_at: string;
  last_login_at: string | null;
  providers: string[];
};

type EventRow = {
  id: string;
  event_name: string;
  event_time: string;
  user_id: string | null;
  session_id: string | null;
  source: string;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
};

type UserDetail = {
  user: UserRow;
  identities: Array<Record<string, unknown>>;
  consents: Array<Record<string, unknown>>;
  attribution: Array<Record<string, unknown>>;
  ledger: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

async function fetchJson<T>(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "include"
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.message || "Request failed");
  }
  return res.json() as Promise<T>;
}

export default function AdminPage() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [range, setRange] = useState("7d");
  const [overview, setOverview] = useState<OverviewCard[]>([]);
  const [whatsChanged, setWhatsChanged] = useState<string[]>([]);
  const [topCampaigns, setTopCampaigns] = useState<any[]>([]);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [preset, setPreset] = useState("academia");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [conversions, setConversions] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [audiencePreview, setAudiencePreview] = useState<Record<string, any[]>>(
    {}
  );
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [newAudienceName, setNewAudienceName] = useState("");
  const [newAudienceDescription, setNewAudienceDescription] = useState("");
  const [newAudienceJson, setNewAudienceJson] = useState("{\n  \"event\": {\n    \"name\": \"auth.login_completed\",\n    \"within_days\": 7\n  }\n}");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ user: AdminUser }>("/api/admin/me")
      .then((payload) => {
        setUser(payload.user);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const rangeQuery = useMemo(() => `?range=${range}`, [range]);

  const loadSummary = async () => {
    const [overviewData, whatsChangedData, campaignsData, funnelData] =
      await Promise.all([
        fetchJson<{ cards: OverviewCard[] }>(`/api/admin/overview${rangeQuery}`),
        fetchJson<string[]>(`/api/admin/whats-changed${rangeQuery}`),
        fetchJson<any[]>(`/api/admin/top-campaigns${rangeQuery}`),
        fetchJson<{ steps: FunnelStep[] }>(
          `/api/admin/funnel${rangeQuery}&preset=${preset}`
        )
      ]);
    setOverview(overviewData.cards);
    setWhatsChanged(whatsChangedData);
    setTopCampaigns(campaignsData);
    setFunnel(funnelData.steps);
  };

  const loadAdvanced = async () => {
    const [eventsData, usersData, audiencesData, conversionsData, auditData] =
      await Promise.all([
        fetchJson<EventRow[]>(`/api/admin/events${rangeQuery}`),
        fetchJson<UserRow[]>("/api/admin/users"),
        fetchJson<Audience[]>("/api/admin/audiences"),
        fetchJson<any[]>(`/api/admin/conversions${rangeQuery}`),
        fetchJson<any[]>("/api/admin/audit")
      ]);
    setEvents(eventsData);
    setUsers(usersData);
    setAudiences(audiencesData);
    setConversions(conversionsData);
    setAudit(auditData);
  };

  useEffect(() => {
    if (!user) return;
    loadSummary().catch(() => null);
    if (mode === "advanced") {
      loadAdvanced().catch(() => null);
    }
  }, [user, range, mode, preset]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    try {
      const payload = await fetchJson<{ user: AdminUser }>(
        "/api/admin/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password })
        }
      );
      setUser(payload.user);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = async () => {
    await fetchJson("/api/admin/logout", { method: "POST" });
    setUser(null);
  };

  const handleAudiencePreview = async (id: string) => {
    const preview = await fetchJson<any[]>(`/api/admin/audiences/${id}/preview`);
    setAudiencePreview((prev) => ({ ...prev, [id]: preview }));
  };

  const handleAudienceRecompute = async (id: string) => {
    await fetchJson(`/api/admin/audiences/${id}/recompute`, {
      method: "POST"
    });
    loadAdvanced().catch(() => null);
  };

  const handleAudienceExport = async (id: string) => {
    await fetchJson(`/api/admin/audiences/${id}/exports`, {
      method: "POST",
      body: JSON.stringify({ export_type: "hash_email_sha256" })
    });
  };

  const handleAudienceCreate = async () => {
    setActionError(null);
    try {
      const definition = JSON.parse(newAudienceJson);
      await fetchJson("/api/admin/audiences", {
        method: "POST",
        body: JSON.stringify({
          name: newAudienceName,
          description: newAudienceDescription,
          definition_json: definition
        })
      });
      setNewAudienceName("");
      setNewAudienceDescription("");
      loadAdvanced().catch(() => null);
    } catch (err: any) {
      setActionError(err.message || "Invalid audience JSON");
    }
  };

  const handleUserDetail = async (id: string) => {
    const detail = await fetchJson<UserDetail>(`/api/admin/users/${id}`);
    setSelectedUser(detail);
    setMergeTargetId("");
  };

  const handleMerge = async () => {
    if (!selectedUser) return;
    await fetchJson("/api/admin/users/merge", {
      method: "POST",
      body: JSON.stringify({
        source_user_id: selectedUser.user.id,
        target_user_id: mergeTargetId
      })
    });
    setSelectedUser(null);
    loadAdvanced().catch(() => null);
  };

  if (loading) {
    return (
      <div className="admin-shell">
        <div className="admin-card">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="admin-login">
        <h2>Imperium Admin</h2>
        <p>Login institucional para analytics e auditoria.</p>
        <form onSubmit={handleLogin}>
          <input
            className="admin-input"
            placeholder="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="admin-input"
            type="password"
            placeholder="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {authError && <span className="admin-subtitle">{authError}</span>}
          <button className="admin-button" type="submit">
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div>
          <div className="admin-title">Imperium Admin</div>
          <div className="admin-subtitle">
            {user.email} · {user.role}
          </div>
        </div>
        <div className="admin-toolbar">
          <select
            className="admin-select"
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
          </select>
          <div className="admin-toggle">
            <button
              className={mode === "simple" ? "active" : ""}
              onClick={() => setMode("simple")}
            >
              Simples
            </button>
            <button
              className={mode === "advanced" ? "active" : ""}
              onClick={() => setMode("advanced")}
            >
              Avancado
            </button>
          </div>
          <button className="admin-button secondary" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <section className="admin-card">
        <div className="admin-section-title">Overview</div>
        <div className="admin-grid cards">
          {overview.map((card) => (
            <div className="admin-card" key={card.key}>
              <h3>{card.label}</h3>
              <div className="admin-metric">{card.value}</div>
              <div className="admin-delta">
                {card.delta >= 0 ? "+" : ""}
                {card.delta}% vs periodo anterior
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-columns">
        <div className="admin-card">
          <div className="admin-section-title">O que mudou</div>
          <div className="admin-list">
            {whatsChanged.map((item, index) => (
              <div className="admin-list-item" key={`${item}-${index}`}>
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="admin-card">
          <div className="admin-section-title">Top Campaigns</div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>utm_source</th>
                <th>utm_campaign</th>
                <th>signups</th>
                <th>subs</th>
                <th>conv_rate</th>
              </tr>
            </thead>
            <tbody>
              {topCampaigns.map((row) => (
                <tr key={`${row.utm_source}-${row.utm_campaign}`}>
                  <td>{row.utm_source}</td>
                  <td>{row.utm_campaign}</td>
                  <td>{row.signups}</td>
                  <td>{row.subs}</td>
                  <td>{row.conv_rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-row" style={{ justifyContent: "space-between" }}>
          <div className="admin-section-title">Funnel</div>
          <select
            className="admin-select"
            value={preset}
            onChange={(event) => setPreset(event.target.value)}
          >
            <option value="academia">Academia</option>
            <option value="atlas">Atlas</option>
            <option value="alexandria">Alexandria</option>
          </select>
        </div>
        <div className="admin-grid">
          {funnel.map((step, index) => (
            <div className="admin-list-item" key={step.name}>
              <span>{`${index + 1}. ${step.name}`}</span>
              <strong>{step.count}</strong>
            </div>
          ))}
        </div>
      </section>

      {mode === "advanced" && (
        <>
          <section className="admin-panel-grid">
            <div className="admin-card">
              <div className="admin-section-title">Users</div>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>email</th>
                    <th>status</th>
                    <th>created</th>
                    <th>providers</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <tr key={row.id}>
                      <td>{row.email || "anon"}</td>
                      <td>{row.status}</td>
                      <td>{new Date(row.created_at).toLocaleDateString()}</td>
                      <td>{row.providers.join(", ")}</td>
                      <td>
                        <button
                          className="admin-button ghost"
                          onClick={() => handleUserDetail(row.id)}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-side">
              <h4>User Detail</h4>
              {!selectedUser && (
                <div className="admin-subtitle">Selecione um usuario.</div>
              )}
              {selectedUser && (
                <div className="admin-grid">
                  <div>
                    <div className="admin-pill">{selectedUser.user.id}</div>
                    <div className="admin-subtitle">
                      {selectedUser.user.email || "anon"}
                    </div>
                  </div>
                  <div className="admin-code">
                    {JSON.stringify(
                      {
                        identities: selectedUser.identities,
                        consents: selectedUser.consents,
                        attribution: selectedUser.attribution,
                        ledger: selectedUser.ledger
                      },
                      null,
                      2
                    )}
                  </div>
                  <div>
                    <div className="admin-subtitle">Merge into</div>
                    <input
                      className="admin-input"
                      placeholder="target user id"
                      value={mergeTargetId}
                      onChange={(event) => setMergeTargetId(event.target.value)}
                    />
                    <button
                      className="admin-button"
                      disabled={!mergeTargetId}
                      onClick={handleMerge}
                    >
                      Merge
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="admin-card">
            <div className="admin-section-title">Events</div>
            <div className="admin-grid">
              {events.map((event) => (
                <div className="admin-list-item" key={event.id}>
                  <div>
                    <div>{event.event_name}</div>
                    <div className="admin-subtitle">
                      {new Date(event.event_time).toLocaleString()}
                    </div>
                  </div>
                  <div className="admin-pill">{event.source}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card">
            <div className="admin-section-title">Audiences</div>
            <div className="admin-row">
              <input
                className="admin-input"
                placeholder="Nome"
                value={newAudienceName}
                onChange={(event) => setNewAudienceName(event.target.value)}
              />
              <input
                className="admin-input"
                placeholder="Descricao"
                value={newAudienceDescription}
                onChange={(event) => setNewAudienceDescription(event.target.value)}
              />
              <button className="admin-button" onClick={handleAudienceCreate}>
                Criar
              </button>
            </div>
            {actionError && (
              <div className="admin-subtitle">{actionError}</div>
            )}
            <div className="admin-divider" />
            <textarea
              className="admin-textarea"
              rows={6}
              value={newAudienceJson}
              onChange={(event) => setNewAudienceJson(event.target.value)}
            />
            <div className="admin-divider" />
            <div className="admin-grid">
              {audiences.map((audience) => (
                <div className="admin-card" key={audience.id}>
                  <div className="admin-row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <strong>{audience.name}</strong>
                      <div className="admin-subtitle">{audience.description}</div>
                    </div>
                    <div className="admin-pill">{audience.members} membros</div>
                  </div>
                  <div className="admin-row">
                    <button
                      className="admin-button secondary"
                      onClick={() => handleAudiencePreview(audience.id)}
                    >
                      Preview
                    </button>
                    <button
                      className="admin-button secondary"
                      onClick={() => handleAudienceRecompute(audience.id)}
                    >
                      Recompute
                    </button>
                    <button
                      className="admin-button"
                      onClick={() => handleAudienceExport(audience.id)}
                    >
                      Export Hash
                    </button>
                  </div>
                  {audiencePreview[audience.id] && (
                    <div className="admin-code">
                      {JSON.stringify(audiencePreview[audience.id], null, 2)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="admin-card">
            <div className="admin-section-title">Conversions</div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>name</th>
                  <th>value</th>
                  <th>currency</th>
                  <th>time</th>
                </tr>
              </thead>
              <tbody>
                {conversions.map((row, index) => (
                  <tr key={`${row.conversion_name}-${index}`}>
                    <td>{row.conversion_name}</td>
                    <td>{row.value_cents ?? "-"}</td>
                    <td>{row.currency ?? "-"}</td>
                    <td>{new Date(row.occurred_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="admin-card">
            <div className="admin-section-title">Audit Log</div>
            <div className="admin-grid">
              {audit.map((row, index) => (
                <div className="admin-list-item" key={`${row.action}-${index}`}>
                  <div>
                    <div>{row.action}</div>
                    <div className="admin-subtitle">
                      {row.resource_type} {row.resource_id}
                    </div>
                  </div>
                  <div className="admin-subtitle">
                    {new Date(row.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
