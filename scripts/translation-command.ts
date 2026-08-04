import chalk from "chalk";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { FileCredentialStore } from "./credential-store.js";
import {
  loadLocalEnvironment,
  resolveCredentialsPath,
  resolveModelSelection,
  type ModelSelection,
} from "./environment.js";
import { createPiTranslator } from "./pi.js";
import {
  applyTranslations,
  collectTranslationEntries,
  getPoFilePath,
  loadPoFile,
  savePoFile,
  type TranslateCliOptions,
  type Translator,
} from "./translate.js";

export type TranslationCommandOptions = TranslateCliOptions & {
  config?: string;
  envFile?: string;
  credentials?: string;
  baseUrl?: string;
};

type TranslatorFactory = (options: Parameters<typeof createPiTranslator>[0]) => Promise<Translator>;

type TranslationCommandDependencies = {
  createTranslator?: TranslatorFactory;
};

const resolveSelection = (
  options: TranslationCommandOptions,
  configPath: string | undefined,
  configModel: Parameters<typeof resolveModelSelection>[0]["configModel"],
) => {
  const shellProvider = process.env.VUE_GETTEXT_PROVIDER;
  const shellModel = process.env.VUE_GETTEXT_MODEL;
  loadLocalEnvironment({ configPath, envFile: options.envFile });

  return resolveModelSelection({
    cliProvider: options.provider,
    cliModel: options.model,
    cliBaseUrl: options.baseUrl,
    shellProvider,
    shellModel,
    environmentProvider: shellProvider || shellModel ? undefined : process.env.VUE_GETTEXT_PROVIDER,
    environmentModel: shellProvider || shellModel ? undefined : process.env.VUE_GETTEXT_MODEL,
    environmentBaseUrl: process.env.VUE_GETTEXT_BASE_URL,
    configModel,
  });
};

export const runTranslationCommand = async (
  options: TranslationCommandOptions,
  { createTranslator = createPiTranslator }: TranslationCommandDependencies = {},
) => {
  const config = await loadConfig(options);
  const selection: ModelSelection = resolveSelection(options, config.configPath, config.translate.model);
  const includeTranslated = options.includeTranslated ?? config.translate.includeTranslated;
  const targetLocales = options.locale?.length
    ? options.locale
    : config.translate.locales?.length
      ? config.translate.locales
      : config.output.locales;
  const credentials = new FileCredentialStore(resolveCredentialsPath(options.credentials));
  const translator = await createTranslator({ selection, credentials });

  console.info(`Language directory: ${chalk.blueBright(config.output.path)}`);
  console.info(`Provider: ${chalk.blueBright(selection.provider)}`);
  console.info(`Model: ${chalk.blueBright(selection.id)}`);
  console.info(`Model source: ${chalk.blueBright(selection.source)}`);
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

    const translations = await translator.translate({ locale, entries, includeTranslated });
    const changedEntries = applyTranslations(po, translations, { includeTranslated });

    if (options.dryRun) {
      console.info(`${chalk.green("Translated")}: ${chalk.blueBright(locale)} (${changedEntries} entries, dry run)`);
      continue;
    }

    await savePoFile(poFilePath, po);
    console.info(`${chalk.green("Translated")}: ${chalk.blueBright(locale)} (${changedEntries} entries written)`);
  }
};
