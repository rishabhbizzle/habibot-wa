import Anthropic from '@anthropic-ai/sdk';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCallResult {
  name: string;
  input: Record<string, unknown>;
}

export interface Llm {
  complete(system: string, user: string, maxTokens: number): Promise<string>;
  toolCall(system: string, user: string, tools: ToolDef[], maxTokens: number): Promise<ToolCallResult | null>;
}

/**
 * Thin wrapper over @anthropic-ai/sdk (fetch-based; runs on Workers).
 * Failures throw — callers land in the canned-fallback path, so a reminder
 * never silently drops because the LLM was down.
 */
export function anthropicLlm(apiKey: string, model: string): Llm {
  // 6s timeout x 2 attempts keeps worst-case (intent parse + compose + sends)
  // inside the Worker's 30s waitUntil budget.
  const client = new Anthropic({ apiKey, timeout: 6_000, maxRetries: 1 });
  // Opus 5 thinks by default; effort low keeps short persona messages fast+cheap.
  // Haiku 4.5 rejects output_config.effort, so only send it on effort-capable models.
  const supportsEffort = /^claude-(opus-5|sonnet-5|opus-4-[678]|sonnet-4-6|fable|mythos)/.test(model);

  function baseParams(system: string, user: string, maxTokens: number): Record<string, unknown> {
    const p: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    };
    if (supportsEffort) p.output_config = { effort: 'low' };
    return p;
  }

  return {
    async complete(system, user, maxTokens) {
      const res = (await client.messages.create(
        baseParams(system, user, maxTokens) as unknown as Anthropic.MessageCreateParamsNonStreaming,
      )) as Anthropic.Message;
      if (res.stop_reason === 'refusal') throw new Error('llm_refusal');
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (!text) throw new Error('llm_empty');
      return text;
    },

    async toolCall(system, user, tools, maxTokens) {
      const params = baseParams(system, user, maxTokens);
      params.tools = tools;
      params.tool_choice = { type: 'any', disable_parallel_tool_use: true };
      const res = (await client.messages.create(
        params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      )) as Anthropic.Message;
      if (res.stop_reason === 'refusal') throw new Error('llm_refusal');
      const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!block) return null;
      return { name: block.name, input: (block.input ?? {}) as Record<string, unknown> };
    },
  };
}
