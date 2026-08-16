import { realClock } from './core/clock';
import { d1Db, repo } from './db/repo';
import { CONFIG, type Env } from './env';
import { anthropicLlm } from './llm/anthropic';
import type { TickDeps } from './scheduler/tick';
import { graphSender, wrapSender } from './wa/client';
import { makeWeatherFacts } from './weather';

export async function buildDeps(env: Env): Promise<TickDeps> {
  const db = d1Db(env.DB);
  const [player, admin] = await Promise.all([repo.getPlayer(db), repo.getAdmin(db)]);
  const inner = graphSender({
    token: env.WA_TOKEN,
    phoneId: env.WA_PHONE_ID,
    version: env.GRAPH_VERSION || 'v23.0',
    templateLang: env.TEMPLATE_LANG || 'en',
  });
  const send = wrapSender(inner, {
    dryRun: env.DRY_RUN === '1',
    testMode: env.TEST_MODE === '1',
    playerWaId: player?.wa_id ?? null,
    adminWaId: admin?.wa_id ?? null,
  });
  const llm = env.ANTHROPIC_API_KEY ? anthropicLlm(env.ANTHROPIC_API_KEY, env.LLM_MODEL || CONFIG.DEFAULT_MODEL) : null;
  return {
    db,
    send,
    llm,
    clock: realClock,
    templateName: env.TEMPLATE_NAME || 'hello_world',
    publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    weatherFacts: makeWeatherFacts(env.WEATHER_LAT || '', env.WEATHER_LON || '', player?.tz || 'Asia/Kolkata'),
  };
}
