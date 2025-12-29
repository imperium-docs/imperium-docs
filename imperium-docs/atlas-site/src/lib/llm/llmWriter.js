const fs = require("fs");
const path = require("path");
const { generateCompletion, isLlmEnabled } = require("./llmProvider");

const TEMPLATE_PATH = path.join(__dirname, "..", "..", "..", "templates", "document-b.imperial.mdx");

let cachedTemplate = null;

function loadTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
  }
  return cachedTemplate;
}

function deterministicTemplate(payload) {
  const template = loadTemplate();

  const opening = `${payload.title}. ${payload.summary}`.trim();
  const historical = `Published on ${payload.publishedAt} by ${payload.sourceName}. Source: ${payload.url}.`;
  const mechanism =
    "The record reflects institutional disclosure through formal release channels.";
  const agents =
    `Primary agent: ${payload.entityName}. Gatekeeper: ${payload.sourceName}.`;
  const structural =
    "What institutional sequence does this disclosure continue to shape?";

  return template
    .replace("{{OPENING_PHENOMENON}}", opening)
    .replace("{{HISTORICAL_POSITIONING}}", historical)
    .replace("{{MECHANISM_OF_POWER}}", mechanism)
    .replace("{{AGENTS_INVOLVED}}", agents)
    .replace("{{STRUCTURAL_QUESTION}}", structural);
}

function buildPrompts(payload) {
  const template = loadTemplate();

  const systemPrompt =
    "You are Atlas, producing institutional summaries without fluff. Follow the template exactly and keep it concise.";

  const userPrompt = `Fill the placeholders in this template using the provided record details. Do not add extra headings.

TEMPLATE:
${template}

RECORD:
Title: ${payload.title}
Summary: ${payload.summary}
Source: ${payload.sourceName}
URL: ${payload.url}
Published: ${payload.publishedAt}
Entity: ${payload.entityName}
`;

  return { systemPrompt, userPrompt };
}

async function writeDocument(payload, logger) {
  if (!isLlmEnabled()) {
    return deterministicTemplate(payload);
  }

  try {
    const { systemPrompt, userPrompt } = buildPrompts(payload);
    const completion = await generateCompletion(systemPrompt, userPrompt);

    if (!completion) {
      return deterministicTemplate(payload);
    }

    return completion.trim();
  } catch (error) {
    if (logger) {
      logger(`LLM fallback engaged: ${error.message}`);
    }
    return deterministicTemplate(payload);
  }
}

module.exports = {
  writeDocument
};
