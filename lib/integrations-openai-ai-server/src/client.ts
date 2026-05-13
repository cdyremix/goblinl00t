import OpenAI from "openai";

function createClient(): OpenAI {
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

// Lazy singleton — validated and instantiated on first property access, not at
// import time. This lets the server start cleanly in self-hosted environments
// where AI_INTEGRATIONS_OPENAI_* are absent; the error only surfaces if an
// OpenAI-backed endpoint is actually called.
let _client: OpenAI | undefined;
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    if (!_client) _client = createClient();
    return Reflect.get(_client, prop, receiver);
  },
});
