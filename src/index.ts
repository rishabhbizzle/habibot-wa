import { buildDeps } from './deps';
import type { Env } from './env';
import { app } from './router';
import { runTick } from './scheduler/tick';

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const deps = await buildDeps(env);
          const report = await runTick(deps);
          console.log('tick', JSON.stringify(report));
        } catch (e) {
          console.error('tick failed', e);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
