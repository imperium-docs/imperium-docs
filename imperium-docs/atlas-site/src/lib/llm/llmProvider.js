const OPENROUTER_MODEL = "meta-llama/llama-3.2-3b-instruct:free";
const OPENROUTER_PROVIDER = "openrouter";
const MAX_OUTPUT_TOKENS = 700;
const MAX_INPUT_TOKENS = 1200;

function isLlmEnabled() {
  return process.env.ATLAS_LLM_ENABLED === "true";
}

function assertProviderAllowed() {
  const provider = (process.env.ATLAS_LLM_PROVIDER || "").toLowerCase();
  if (provider !== OPENROUTER_PROVIDER) {
    throw new Error("Only OpenRouter is allowed as LLM provider.");
  }
}

function assertModelAllowed() {
  const override =
    process.env.ATLAS_LLM_MODEL || process.env.OPENROUTER_MODEL || "";
  if (override && override !== OPENROUTER_MODEL) {
    throw new Error("Paid or unsupported model blocked by policy.");
  }
}

function truncateToMaxInputTokens(text) {
  const maxChars = MAX_INPUT_TOKENS * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

async function callOpenRouter(messages) {
  assertProviderAllowed();
  assertModelAllowed();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required when LLM is enabled.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Atlas",
      "HTTP-Referer": "https://atlas.local"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned empty content.");
  }

  return content.trim();
}

async function generateCompletion(systemPrompt, userPrompt) {
  if (!isLlmEnabled()) {
    return null;
  }

  const safeUserPrompt = truncateToMaxInputTokens(userPrompt);

  return callOpenRouter([
    { role: "system", content: systemPrompt },
    { role: "user", content: safeUserPrompt }
  ]);
}

module.exports = {
  OPENROUTER_MODEL,
  OPENROUTER_PROVIDER,
  MAX_OUTPUT_TOKENS,
  MAX_INPUT_TOKENS,
  isLlmEnabled,
  generateCompletion
};
