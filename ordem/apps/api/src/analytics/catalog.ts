type EventCatalogEntry = {
  name: string;
  ownerArea: string;
  description: string;
  piiLevel: "none" | "low" | "high";
  requiredPurposes: string[];
  schemaVersion: number;
  schemaJson: Record<string, unknown>;
  sampleEventJson: Record<string, unknown>;
};

const schema = (
  properties: Record<string, unknown>,
  required: string[]
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required
});

export const eventCatalog: EventCatalogEntry[] = [
  {
    name: "auth.session_started",
    ownerArea: "auth",
    description: "Sessao iniciada no fluxo de autenticacao.",
    piiLevel: "none",
    requiredPurposes: [],
    schemaVersion: 1,
    schemaJson: schema(
      {
        method: { type: "string" },
        is_new_user: { type: "boolean" }
      },
      ["method", "is_new_user"]
    ),
    sampleEventJson: { method: "telegram", is_new_user: true }
  },
  {
    name: "auth.signup_completed",
    ownerArea: "auth",
    description: "Cadastro finalizado com sucesso.",
    piiLevel: "none",
    requiredPurposes: [],
    schemaVersion: 1,
    schemaJson: schema(
      {
        method: { type: "string" },
        plan_intent: { type: "string" }
      },
      ["method"]
    ),
    sampleEventJson: { method: "telegram", plan_intent: "premium" }
  },
  {
    name: "auth.login_completed",
    ownerArea: "auth",
    description: "Login concluido.",
    piiLevel: "none",
    requiredPurposes: [],
    schemaVersion: 1,
    schemaJson: schema({ method: { type: "string" } }, ["method"]),
    sampleEventJson: { method: "telegram" }
  },
  {
    name: "auth.logout",
    ownerArea: "auth",
    description: "Logout realizado.",
    piiLevel: "none",
    requiredPurposes: [],
    schemaVersion: 1,
    schemaJson: schema({}, []),
    sampleEventJson: {}
  },
  {
    name: "consent.viewed",
    ownerArea: "consent",
    description: "Aviso de consentimento exibido.",
    piiLevel: "none",
    requiredPurposes: [],
    schemaVersion: 1,
    schemaJson: schema({ version: { type: "string" } }, ["version"]),
    sampleEventJson: { version: "2026-01-07" }
  },
  {
    name: "consent.updated",
    ownerArea: "consent",
    description: "Consentimento atualizado.",
    piiLevel: "low",
    requiredPurposes: [],
    schemaVersion: 1,
    schemaJson: schema(
      {
        version: { type: "string" },
        granted: { type: "boolean" },
        purposes: { type: "array", items: { type: "string" } }
      },
      ["version", "granted", "purposes"]
    ),
    sampleEventJson: {
      version: "2026-01-07",
      granted: true,
      purposes: ["analytics", "personalization"]
    }
  },
  {
    name: "system.attribution_captured",
    ownerArea: "system",
    description: "Toque de atribuicao capturado.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        touch: { type: "string", enum: ["first", "last"] },
        utm_source: { type: "string" },
        utm_medium: { type: "string" },
        utm_campaign: { type: "string" },
        utm_term: { type: "string" },
        utm_content: { type: "string" },
        referrer: { type: "string" },
        landing_page: { type: "string" }
      },
      ["touch"]
    ),
    sampleEventJson: {
      touch: "first",
      utm_source: "telegram",
      utm_campaign: "imperium-launch",
      referrer: "https://t.me",
      landing_page: "/ordem"
    }
  },
  {
    name: "atlas.feed_viewed",
    ownerArea: "atlas",
    description: "Feed do Atlas visualizado.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        feed_type: { type: "string" },
        sort: { type: "string" },
        filters: { type: "array", items: { type: "string" } }
      },
      ["feed_type", "sort"]
    ),
    sampleEventJson: {
      feed_type: "curated",
      sort: "recent",
      filters: ["imperium"]
    }
  },
  {
    name: "atlas.item_opened",
    ownerArea: "atlas",
    description: "Item do Atlas aberto.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        item_id: { type: "string" },
        item_type: { type: "string" },
        source: { type: "string" }
      },
      ["item_id", "item_type"]
    ),
    sampleEventJson: {
      item_id: "atlas-001",
      item_type: "article",
      source: "feed"
    }
  },
  {
    name: "atlas.item_saved",
    ownerArea: "atlas",
    description: "Item salvo no Atlas.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema({ item_id: { type: "string" } }, ["item_id"]),
    sampleEventJson: { item_id: "atlas-001" }
  },
  {
    name: "atlas.search",
    ownerArea: "atlas",
    description: "Busca realizada no Atlas.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        query: { type: "string" },
        results_count: { type: "number" }
      },
      ["query", "results_count"]
    ),
    sampleEventJson: { query: "imperium", results_count: 12 }
  },
  {
    name: "academia.lesson_started",
    ownerArea: "academia",
    description: "Aula iniciada na Academia.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        module_id: { type: "string" },
        lesson_id: { type: "string" },
        entry_point: { type: "string" }
      },
      ["module_id", "lesson_id", "entry_point"]
    ),
    sampleEventJson: {
      module_id: "mod-1",
      lesson_id: "lesson-3",
      entry_point: "dashboard"
    }
  },
  {
    name: "academia.lesson_completed",
    ownerArea: "academia",
    description: "Aula concluida na Academia.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        module_id: { type: "string" },
        lesson_id: { type: "string" },
        duration_sec: { type: "number" },
        score: { type: "number" }
      },
      ["module_id", "lesson_id", "duration_sec"]
    ),
    sampleEventJson: {
      module_id: "mod-1",
      lesson_id: "lesson-3",
      duration_sec: 540,
      score: 92
    }
  },
  {
    name: "academia.quiz_answered",
    ownerArea: "academia",
    description: "Questao respondida na Academia.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        module_id: { type: "string" },
        lesson_id: { type: "string" },
        question_id: { type: "string" },
        is_correct: { type: "boolean" },
        option_id: { type: "string" }
      },
      ["module_id", "lesson_id", "question_id", "is_correct", "option_id"]
    ),
    sampleEventJson: {
      module_id: "mod-1",
      lesson_id: "lesson-3",
      question_id: "q5",
      is_correct: true,
      option_id: "a"
    }
  },
  {
    name: "academia.paywall_hit",
    ownerArea: "academia",
    description: "Paywall exibido na Academia.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        surface: { type: "string" },
        reason: { type: "string" }
      },
      ["surface", "reason"]
    ),
    sampleEventJson: { surface: "lesson", reason: "trial_end" }
  },
  {
    name: "ordem.room_viewed",
    ownerArea: "ordem",
    description: "Sala visualizada no Ordem.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        room_id: { type: "string" },
        required_rank: { type: "string" }
      },
      ["room_id", "required_rank"]
    ),
    sampleEventJson: { room_id: "general", required_rank: "bronze" }
  },
  {
    name: "ordem.rank_gate_hit",
    ownerArea: "ordem",
    description: "Gate de rank acionado no Ordem.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        room_id: { type: "string" },
        user_rank: { type: "string" },
        required_rank: { type: "string" }
      },
      ["room_id", "user_rank", "required_rank"]
    ),
    sampleEventJson: {
      room_id: "vip",
      user_rank: "bronze",
      required_rank: "gold"
    }
  },
  {
    name: "ordem.post_created",
    ownerArea: "ordem",
    description: "Post criado no Ordem.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        room_id: { type: "string" },
        post_id: { type: "string" },
        length: { type: "number" }
      },
      ["room_id", "post_id", "length"]
    ),
    sampleEventJson: { room_id: "general", post_id: "post-22", length: 380 }
  },
  {
    name: "alexandria.series_viewed",
    ownerArea: "alexandria",
    description: "Serie visualizada no Alexandria.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema({ series_id: { type: "string" } }, ["series_id"]),
    sampleEventJson: { series_id: "ser-10" }
  },
  {
    name: "alexandria.episode_started",
    ownerArea: "alexandria",
    description: "Episodio iniciado no Alexandria.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      { series_id: { type: "string" }, episode_id: { type: "string" } },
      ["series_id", "episode_id"]
    ),
    sampleEventJson: { series_id: "ser-10", episode_id: "ep-2" }
  },
  {
    name: "alexandria.episode_completed",
    ownerArea: "alexandria",
    description: "Episodio concluido no Alexandria.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        series_id: { type: "string" },
        episode_id: { type: "string" },
        watch_time_sec: { type: "number" }
      },
      ["series_id", "episode_id", "watch_time_sec"]
    ),
    sampleEventJson: {
      series_id: "ser-10",
      episode_id: "ep-2",
      watch_time_sec: 1440
    }
  },
  {
    name: "billing.checkout_started",
    ownerArea: "billing",
    description: "Checkout iniciado.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        plan_id: { type: "string" },
        price_cents: { type: "number" },
        currency: { type: "string" }
      },
      ["plan_id", "price_cents", "currency"]
    ),
    sampleEventJson: {
      plan_id: "premium",
      price_cents: 9900,
      currency: "BRL"
    }
  },
  {
    name: "billing.checkout_completed",
    ownerArea: "billing",
    description: "Checkout concluido.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        plan_id: { type: "string" },
        price_cents: { type: "number" },
        currency: { type: "string" },
        provider: { type: "string" }
      },
      ["plan_id", "price_cents", "currency", "provider"]
    ),
    sampleEventJson: {
      plan_id: "premium",
      price_cents: 9900,
      currency: "BRL",
      provider: "stripe"
    }
  },
  {
    name: "billing.subscription_started",
    ownerArea: "billing",
    description: "Assinatura iniciada.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        plan_id: { type: "string" },
        provider: { type: "string" }
      },
      ["plan_id", "provider"]
    ),
    sampleEventJson: { plan_id: "premium", provider: "stripe" }
  },
  {
    name: "billing.subscription_canceled",
    ownerArea: "billing",
    description: "Assinatura cancelada.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        plan_id: { type: "string" },
        provider: { type: "string" },
        reason: { type: "string" }
      },
      ["plan_id", "provider"]
    ),
    sampleEventJson: {
      plan_id: "premium",
      provider: "stripe",
      reason: "paused"
    }
  },
  {
    name: "system.error",
    ownerArea: "system",
    description: "Erro de sistema capturado.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        code: { type: "string" },
        message: { type: "string" },
        area: { type: "string" }
      },
      ["code", "message", "area"]
    ),
    sampleEventJson: {
      code: "500",
      message: "Unexpected error",
      area: "ordem"
    }
  },
  {
    name: "system.performance",
    ownerArea: "system",
    description: "Indicadores de performance capturados.",
    piiLevel: "none",
    requiredPurposes: ["analytics"],
    schemaVersion: 1,
    schemaJson: schema(
      {
        route: { type: "string" },
        ttfb_ms: { type: "number" },
        lcp_ms: { type: "number" }
      },
      ["route"]
    ),
    sampleEventJson: { route: "/ordem", ttfb_ms: 210, lcp_ms: 1200 }
  }
];

export type { EventCatalogEntry };
