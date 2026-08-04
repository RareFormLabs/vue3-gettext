import { lilconfig } from "lilconfig";
import path from "node:path";
import { GettextConfig, GettextConfigOptions } from "../src/typeDefs.js";

export type LoadedGettextConfig = GettextConfig & {
  configPath?: string;
};

const legacyTranslateConfigError = () =>
  new Error(
    [
      "The v4 translation configuration is not supported in vue3-gettext v5.",
      'Replace translate.provider and the string translate.model with translate.model: { provider: "openai", id: "gpt-4.1-mini" }.',
      'For ChatGPT/Codex OAuth use provider: "openai-codex", then run vue-gettext-auth login openai-codex --type oauth.',
    ].join(" "),
  );

const validateTranslateConfig = (translate: unknown) => {
  if (!translate || typeof translate !== "object") {
    return;
  }

  const value = translate as Record<string, unknown>;
  if ("provider" in value || "openai" in value || typeof value.model === "string") {
    throw legacyTranslateConfigError();
  }

  if (value.model !== undefined) {
    if (!value.model || typeof value.model !== "object") {
      throw new Error("translate.model must be an object with non-empty provider and id strings.");
    }
    const model = value.model as Record<string, unknown>;
    if (
      typeof model.provider !== "string" ||
      model.provider.trim().length === 0 ||
      typeof model.id !== "string" ||
      model.id.trim().length === 0
    ) {
      throw new Error("translate.model must include non-empty provider and id strings.");
    }
    if (model.baseUrl !== undefined && typeof model.baseUrl !== "string") {
      throw new Error("translate.model.baseUrl must be a string when provided.");
    }
  }
};

export const loadConfig = async (cliArgs?: { config?: string }): Promise<LoadedGettextConfig> => {
  const configSearcher = lilconfig("gettext", {
    searchPlaces: ["gettext.config.js", "gettext.config.cjs", "gettext.config.mjs", "package.json"],
  });

  let configRes;
  if (cliArgs?.config) {
    configRes = await configSearcher.load(cliArgs.config);
    if (!configRes) {
      throw new Error(`Config not found: ${cliArgs.config}`);
    }
  } else {
    configRes = await configSearcher.search();
  }

  const config: GettextConfigOptions = configRes?.config ?? {};
  validateTranslateConfig(config.translate);

  const languagePath = config.output?.path || "./src/language";
  const joinPath = (inputPath: string) => path.join(languagePath, inputPath);
  const joinPathIfRelative = (inputPath?: string) => {
    if (!inputPath) {
      return undefined;
    }
    return path.isAbsolute(inputPath) ? inputPath : path.join(languagePath, inputPath);
  };
  return {
    input: {
      path: config.input?.path || "./src",
      include: config.input?.include || ["**/*.js", "**/*.ts", "**/*.vue"],
      exclude: config.input?.exclude || [],
      parserOptions: config.input?.parserOptions,
    },
    output: {
      path: languagePath,
      potPath: joinPathIfRelative(config.output?.potPath) || joinPath("./messages.pot"),
      jsonPath:
        joinPathIfRelative(config.output?.jsonPath) ||
        (config.output?.splitJson ? joinPath("./") : joinPath("./translations.json")),
      locales: config.output?.locales || ["en"],
      flat: config.output?.flat === undefined ? true : config.output.flat,
      linguas: config.output?.linguas === undefined ? true : config.output.linguas,
      splitJson: config.output?.splitJson === undefined ? false : config.output.splitJson,
      fuzzyMatching: config.output?.fuzzyMatching === undefined ? true : config.output.fuzzyMatching,
      locations: config.output?.locations === undefined ? true : config.output.locations,
      addLocation: config.output?.addLocation,
      autoFill: config.output?.autoFill,
    },
    translate: {
      model: config.translate?.model
        ? {
            provider: config.translate.model.provider.trim(),
            id: config.translate.model.id.trim(),
            baseUrl: config.translate.model.baseUrl?.trim() || undefined,
          }
        : undefined,
      locales: config.translate?.locales,
      includeTranslated: config.translate?.includeTranslated === undefined ? false : config.translate.includeTranslated,
    },
    configPath: configRes?.filepath,
  };
};
