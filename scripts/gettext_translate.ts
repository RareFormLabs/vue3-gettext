#!/usr/bin/env node

import chalk from "chalk";
import commandLineArgs, { OptionDefinition } from "command-line-args";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { OpenAITranslator } from "./openai.js";
import { GettextConfig } from "../src/typeDefs.js";
import {
  applyTranslations,
  collectTranslationEntries,
  getPoFilePath,
  loadPoFile,
  savePoFile,
  TranslateCliOptions,
  Translator,
} from "./translate.js";

const optionDefinitions: OptionDefinition[] = [
  { name: "config", alias: "c", type: String },
  { name: "locale", alias: "l", type: String, multiple: true },
  { name: "provider", type: String },
  { name: "model", type: String },
  { name: "include-translated", type: Boolean },
  { name: "dry-run", type: Boolean },
];

let options;
try {
  options = commandLineArgs(optionDefinitions, {
    camelCase: true,
  }) as {
    config?: string;
  } & TranslateCliOptions;
} catch (e) {
  console.error(e);
  process.exit(1);
}

const resolveTranslator = (
  options: TranslateCliOptions & { configTranslate?: GettextConfig["translate"] },
): Translator => {
  const provider = options.provider || options.configTranslate?.provider || "openai";

  if (provider !== "openai") {
    throw new Error(`Unsupported translation provider: ${provider}`);
  }

  const openaiConfig = options.configTranslate?.openai;
  const authMode = openaiConfig?.authMode || "api-key";
  const model = options.model || options.configTranslate?.model || openaiConfig?.model || "gpt-4.1-mini";

  if (authMode === "oauth") {
    return new OpenAITranslator({
      model,
      authMode,
      baseUrl: openaiConfig?.baseUrl,
      credentialsPath: openaiConfig?.credentialsPath,
      accessTokenEnvVar: openaiConfig?.accessTokenEnvVar,
      refreshTokenEnvVar: openaiConfig?.refreshTokenEnvVar,
      accountIdEnvVar: openaiConfig?.accountIdEnvVar,
      persistRefresh: openaiConfig?.persistRefresh,
      originator: openaiConfig?.originator,
    });
  }

  const apiKeyEnvVar = openaiConfig?.apiKeyEnvVar || "OPENAI_API_KEY";
  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Missing OpenAI API key. Set ${apiKeyEnvVar} in your environment.`);
  }

  return new OpenAITranslator({
    model,
    authMode,
    apiKey,
    baseUrl: openaiConfig?.baseUrl,
    organization: openaiConfig?.organization || process.env.OPENAI_ORG_ID,
    project: openaiConfig?.project || process.env.OPENAI_PROJECT_ID,
  });
};

(async () => {
  const config = await loadConfig(options);
  const translateConfig = config.translate || {};
  const includeTranslated = options.includeTranslated ?? translateConfig.includeTranslated ?? false;
  const targetLocales = options.locale?.length
    ? options.locale
    : translateConfig.locales?.length
      ? translateConfig.locales
      : config.output.locales;
  const translator = resolveTranslator({ ...options, configTranslate: translateConfig });

  console.info(`Language directory: ${chalk.blueBright(config.output.path)}`);
  console.info(`Provider: ${chalk.blueBright(options.provider || translateConfig.provider || "openai")}`);
  console.info(`Locales: ${chalk.blueBright(targetLocales.join(", "))}`);
  console.info(`Mode: ${chalk.blueBright(includeTranslated ? "all entries" : "untranslated only")}`);
  console.info();

  for (const locale of targetLocales) {
    const poFilePath = getPoFilePath(config, locale);
    if (!existsSync(poFilePath)) {
      throw new Error(`PO file not found for locale ${locale}: ${poFilePath}. Run extraction first.`);
    }

    const po = await loadPoFile(poFilePath);
    const entries = collectTranslationEntries(po, includeTranslated);
    if (entries.length === 0) {
      console.info(`${chalk.yellow("Skipped")}: ${chalk.blueBright(locale)} has no matching entries.`);
      continue;
    }

    const translations = await translator.translate({ locale, entries });
    const changedEntries = applyTranslations(po, translations);

    if (options.dryRun) {
      console.info(`${chalk.green("Translated")}: ${chalk.blueBright(locale)} (${changedEntries} entries, dry run)`);
      continue;
    }

    await savePoFile(poFilePath, po);
    console.info(`${chalk.green("Translated")}: ${chalk.blueBright(locale)} (${changedEntries} entries written)`);
  }
})();
