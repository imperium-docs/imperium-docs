"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Conversation,
  ConversationRequest,
  Message,
  User
} from "@ordem/shared";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const ALLOW_BEARER = process.env.NODE_ENV === "development";

type StartTarget =
  | { type: "request"; id: number }
  | { type: "conversation"; id: number }
  | null;

function getStartTarget(): StartTarget {
  if (typeof window === "undefined") return null;
  const tg = (window as any).Telegram?.WebApp;
  const startParam =
    tg?.initDataUnsafe?.start_param ||
    new URLSearchParams(window.location.search).get("tgWebAppStartParam") ||
    new URLSearchParams(window.location.search).get("startapp");
  if (!startParam) return null;
  if (startParam.startsWith("req_")) {
    const id = Number(startParam.replace("req_", ""));
    return Number.isFinite(id) ? { type: "request", id } : null;
  }
  if (startParam.startsWith("conv_")) {
    const id = Number(startParam.replace("conv_", ""));
    return Number.isFinite(id) ? { type: "conversation", id } : null;
  }
  return null;
}

async function apiFetch<T>(
  path: string,
  token: string | null,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token && ALLOW_BEARER) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Request failed");
  }
  return response.json();
}

export default function OrdemPage() {
  const [isTelegram, setIsTelegram] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [requests, setRequests] = useState<ConversationRequest[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"conversations" | "requests">("conversations");
  const [focusedRequestId, setFocusedRequestId] = useState<number | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [newRequestTarget, setNewRequestTarget] = useState("");
  const [newRequestMessage, setNewRequestMessage] = useState("");
  const [composer, setComposer] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageAtRef = useRef<number>(0);
  const startTargetRef = useRef<StartTarget>(getStartTarget());

  const filteredConversations = useMemo(() => {
    const term = search.toLowerCase();
    return conversations.filter((conv) =>
      conv.title.toLowerCase().includes(term)
    );
  }, [conversations, search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      setIsTelegram(true);
      tg.ready();
      tg.expand();
      if (!tg.initData) {
        setError("Telegram initData not found.");
        return;
      }
      apiFetch<{ token: string; user: User }>(
        "/telegram/webapp/auth",
        null,
        {
          method: "POST",
          body: JSON.stringify({ initData: tg.initData })
        }
      )
        .then((payload) => {
          setAuthToken(payload.token);
          setMe(payload.user);
        })
        .catch((err) => setError(err.message));
    }
  }, []);

  useEffect(() => {
    if (!authToken) return;
    Promise.all([
      apiFetch<Conversation[]>("/ordem/conversations", authToken),
      apiFetch<ConversationRequest[]>("/ordem/requests/inbox", authToken),
      apiFetch<User>("/ordem/me", authToken)
    ])
      .then(([convs, inbox, mePayload]) => {
        setConversations(convs);
        setRequests(inbox);
        setMe(mePayload);
        setStatus("Online");
      })
      .catch((err) => setError(err.message));
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    const timer = setInterval(() => {
      apiFetch<Conversation[]>("/ordem/conversations", authToken)
        .then(setConversations)
        .catch(() => null);
      apiFetch<ConversationRequest[]>("/ordem/requests/inbox", authToken)
        .then(setRequests)
        .catch(() => null);
    }, 10000);
    return () => clearInterval(timer);
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !activeConversationId) return;
    if (pollingRef.current) clearInterval(pollingRef.current);
    setMessages([]);
    lastMessageAtRef.current = 0;

    const loadInitial = async () => {
      const initial = await apiFetch<Message[]>(
        `/ordem/conversations/${activeConversationId}/messages?limit=50`,
        authToken
      );
      setMessages(initial);
      lastMessageAtRef.current = initial.length
        ? initial[initial.length - 1].createdAt
        : 0;
    };

    loadInitial().catch((err) => setError(err.message));

    pollingRef.current = setInterval(async () => {
      const after = lastMessageAtRef.current;
      const fresh = await apiFetch<Message[]>(
        `/ordem/conversations/${activeConversationId}/messages?after=${after}&limit=50`,
        authToken
      );
      if (fresh.length) {
        setMessages((prev) => {
          const next = [...prev, ...fresh];
          lastMessageAtRef.current = next[next.length - 1].createdAt;
          return next;
        });
      }
    }, 3000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [authToken, activeConversationId]);

  useEffect(() => {
    const target = startTargetRef.current;
    if (!target || !authToken) return;
    if (target.type === "request") {
      setTab("requests");
      setFocusedRequestId(target.id);
    }
    if (target.type === "conversation") {
      setActiveConversationId(target.id);
    }
    startTargetRef.current = null;
  }, [authToken]);

  useEffect(() => {
    if (!focusedRequestId) return;
    const el = document.getElementById(`request-${focusedRequestId}`);
    if (el) el.scrollIntoView({ block: "center" });
  }, [focusedRequestId, requests]);

  const activeConversation = conversations.find(
    (conv) => conv.id === activeConversationId
  );

  const handleSendMessage = async () => {
    if (!composer.trim() || !activeConversationId || !authToken) return;
    const body = composer.trim();
    setComposer("");
    try {
      const created = await apiFetch<Message>(
        `/ordem/conversations/${activeConversationId}/messages`,
        authToken,
        {
          method: "POST",
          body: JSON.stringify({ body })
        }
      );
      setMessages((prev) => {
        const next = [...prev, created];
        lastMessageAtRef.current = created.createdAt;
        return next;
      });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateRequest = async () => {
    if (!newRequestTarget.trim() || !authToken) return;
    try {
      await apiFetch<{ id: number }>("/ordem/requests", authToken, {
        method: "POST",
        body: JSON.stringify({
          to: newRequestTarget.trim(),
          message: newRequestMessage.trim()
        })
      });
      setNewRequestTarget("");
      setNewRequestMessage("");
      setShowRequestModal(false);
      const inbox = await apiFetch<ConversationRequest[]>(
        "/ordem/requests/inbox",
        authToken
      );
      setRequests(inbox);
      setStatus("Request sent");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAccept = async (id: number) => {
    if (!authToken) return;
    try {
      const payload = await apiFetch<{ conversationId: number }>(
        `/ordem/requests/${id}/accept`,
        authToken,
        { method: "POST" }
      );
      setFocusedRequestId(null);
      setTab("conversations");
      setActiveConversationId(payload.conversationId);
      const convs = await apiFetch<Conversation[]>(
        "/ordem/conversations",
        authToken
      );
      setConversations(convs);
      const inbox = await apiFetch<ConversationRequest[]>(
        "/ordem/requests/inbox",
        authToken
      );
      setRequests(inbox);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async (id: number) => {
    if (!authToken) return;
    try {
      await apiFetch(`/ordem/requests/${id}/reject`, authToken, {
        method: "POST"
      });
      setFocusedRequestId(null);
      const inbox = await apiFetch<ConversationRequest[]>(
        "/ordem/requests/inbox",
        authToken
      );
      setRequests(inbox);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!isTelegram) {
    const botUsername =
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";
    const appShortName =
      process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME || "";
    const deepLink =
      botUsername && appShortName
        ? `https://t.me/${botUsername}/${appShortName}`
        : "";

    return (
      <main className="ordem-shell">
        <div className="ordem-card">
          <div className="ordem-login">
            <h2>Ordem</h2>
            <p>Open this Mini App inside Telegram.</p>
            {deepLink ? (
              <p>
                <a href={deepLink} target="_blank" rel="noreferrer">
                  Open in Telegram
                </a>
              </p>
            ) : (
              <p>Configure BOT_USERNAME and APP_SHORT_NAME to enable deep link.</p>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ordem-shell">
      <div className="ordem-card">
        <div className="ordem-layout">
          <aside className="ordem-sidebar">
            <header>
              <div className="ordem-brand">
                <h1>ORDEM</h1>
                <div className="ordem-actions">
                  <button
                    className="ordem-button"
                    onClick={() => setShowRequestModal(true)}
                  >
                    New
                  </button>
                  <button
                    className="ordem-button-outline"
                    onClick={() => setShowDrawer((prev) => !prev)}
                  >
                    Me
                  </button>
                </div>
              </div>
              <input
                className="ordem-search"
                placeholder="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="ordem-tabs">
                <button
                  className={`ordem-tab ${
                    tab === "conversations" ? "active" : ""
                  }`}
                  onClick={() => setTab("conversations")}
                >
                  Conversations
                </button>
                <button
                  className={`ordem-tab ${tab === "requests" ? "active" : ""}`}
                  onClick={() => setTab("requests")}
                >
                  Requests
                </button>
              </div>
            </header>
            <div className="ordem-list">
              {tab === "conversations" &&
                filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    className={`ordem-item ${
                      conv.id === activeConversationId ? "active" : ""
                    }`}
                    onClick={() => setActiveConversationId(conv.id)}
                  >
                    <div className="ordem-item-title">
                      <span>{conv.title}</span>
                      <span className="ordem-pill">
                        {new Date(conv.lastMessageAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="ordem-item-sub">
                      {conv.lastMessagePreview || "No messages yet"}
                    </div>
                  </button>
                ))}
              {tab === "requests" &&
                requests.map((req) => (
                  <div
                    key={req.id}
                    id={`request-${req.id}`}
                    className={`ordem-item ${
                      focusedRequestId === req.id ? "active" : ""
                    }`}
                  >
                    <div className="ordem-item-title">
                      <span>{req.from.username || req.from.firstName}</span>
                      <span className="ordem-pill">Pending</span>
                    </div>
                    <div className="ordem-item-sub">{req.message}</div>
                    <div className="ordem-request-actions">
                      <button
                        className="ordem-button"
                        onClick={() => handleAccept(req.id)}
                      >
                        Accept
                      </button>
                      <button
                        className="ordem-button-outline"
                        onClick={() => handleReject(req.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              {tab === "requests" && requests.length === 0 && (
                <div className="ordem-empty">No pending requests.</div>
              )}
            </div>
          </aside>

          <section className="ordem-main">
            <div className="ordem-topbar">
              <div>
                <h2>{activeConversation?.title || "Select a conversation"}</h2>
                <div className="ordem-status">
                  {status || "Waiting for auth"}
                </div>
              </div>
              <div className="ordem-status">
                {me ? `@${me.username || me.firstName}` : ""}
              </div>
            </div>

            {activeConversation ? (
              <>
                <div className="ordem-messages">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`ordem-message ${
                        message.senderUserId === me?.id ? "outgoing" : ""
                      }`}
                    >
                      {message.body}
                      <small>
                        {new Date(message.createdAt).toLocaleTimeString()} ·
                        {message.senderUserId === me?.id
                          ? " sent"
                          : " received"}
                      </small>
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <div className="ordem-empty">No messages yet.</div>
                  )}
                </div>
                <div className="ordem-composer">
                  <textarea
                    placeholder="Write a message"
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                  />
                  <button className="ordem-button" onClick={handleSendMessage}>
                    Send
                  </button>
                </div>
              </>
            ) : (
              <div className="ordem-empty">
                Choose a conversation or accept a request to start.
              </div>
            )}
          </section>
        </div>

        {showDrawer && (
          <div className="ordem-drawer">
            <strong>Profile</strong>
            <p>Honor: placeholder</p>
            <p>Block list: placeholder</p>
          </div>
        )}
      </div>

      {showRequestModal && (
        <div className="ordem-overlay">
          <div className="ordem-modal">
            <h3>New conversation request</h3>
            <input
              placeholder="Username or Telegram ID"
              value={newRequestTarget}
              onChange={(event) => setNewRequestTarget(event.target.value)}
            />
            <textarea
              placeholder="Short message"
              value={newRequestMessage}
              onChange={(event) => setNewRequestMessage(event.target.value)}
            />
            <div className="ordem-request-actions">
              <button className="ordem-button" onClick={handleCreateRequest}>
                Send request
              </button>
              <button
                className="ordem-button-outline"
                onClick={() => setShowRequestModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="ordem-overlay" onClick={() => setError(null)}>
          <div className="ordem-modal">
            <strong>Error</strong>
            <p>{error}</p>
            <button className="ordem-button" onClick={() => setError(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
