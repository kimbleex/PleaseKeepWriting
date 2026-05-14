export type AIConfig = {
  apiKey: string;
  baseUrl: string;
  modelName: string;
};

export const AI_REQUEST_TIMEOUT_MS = 45_000;

export function getAIConfig(): AIConfig {
  const env = import.meta.env ? import.meta.env : process.env;
  const apiKey = env.AI_API_KEY;
  const baseUrl = (env.AI_BASE_URL || '').replace(/\/+$/, '');
  const modelName = env.AI_MODEL_NAME;

  if (!apiKey || !baseUrl || !modelName) {
    throw new Error('AI 配置不完整，请在 .env 中配置 AI_API_KEY、AI_BASE_URL、AI_MODEL_NAME');
  }

  return { apiKey, baseUrl, modelName };
}
