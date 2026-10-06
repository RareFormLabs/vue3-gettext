import path from "node:path";
import { normalizePath, type Logger, type Plugin } from "vite";
import { compileTranslations, getPoPaths } from "./compile.js";
import { loadConfig } from "./config.js";

export interface GettextPluginOptions {
  /** Path to the gettext config file. By default it is searched for from the current working directory. */
  config?: string;
}

/**
 * Compiles `.po` files to json when Vite starts and whenever a `.po` file changes,
 * so the compiled json doesn't need to be committed.
 */
export default function gettext(options: GettextPluginOptions = {}): Plugin {
  let logger: Logger | undefined;
  // Fail on compile errors except in the interactive dev server, which logs them and recovers on the next .po change.
  let failOnError = true;
  let poPaths = new Set<string>();

  // Vite may call buildStart once per environment; run compiles one at a time.
  let pending: Promise<unknown> = Promise.resolve();
  const compile = () => {
    const run = pending.then(async () => {
      const config = await loadConfig({ config: options.config });
      poPaths = new Set(getPoPaths(config).map((p) => normalizePath(path.resolve(p))));
      return compileTranslations(config);
    });
    pending = run.catch(() => {});
    return run;
  };

  return {
    name: "vue3-gettext",

    configResolved(config) {
      logger = config.logger;
      // Vitest runs Vite with command "serve"; failing there keeps tests from running against stale json.
      failOnError = config.command === "build" || !!process.env.VITEST;
    },

    async buildStart() {
      try {
        await compile();
      } catch (e) {
        if (failOnError) {
          throw e;
        }
        logger?.error(`vue3-gettext: failed to compile translations\n${e instanceof Error ? e.message : e}`, {
          timestamp: true,
        });
      }
      // Also makes the dev server watch .po files that live outside the Vite root.
      for (const poPath of poPaths) {
        this.addWatchFile(poPath);
      }
    },

    configureServer(server) {
      const onPoChange = async (file: string) => {
        if (!poPaths.has(normalizePath(file))) {
          return;
        }
        try {
          const { files } = await compile();
          if (files.some((f) => f.changed)) {
            logger?.info("vue3-gettext: recompiled translations", { timestamp: true });
          }
        } catch (e) {
          // Keep the dev server running, e.g. while a .po file has unresolved merge conflicts.
          logger?.error(`vue3-gettext: failed to compile translations\n${e instanceof Error ? e.message : e}`, {
            timestamp: true,
          });
        }
      };
      server.watcher.on("change", onPoChange);
      server.watcher.on("add", onPoChange);
    },
  };
}
