// Based on https://github.com/Polyconseil/easygettext/blob/master/src/compile.js

import Pofile from "pofile";
import fsPromises from "fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { GettextConfig, LanguageData, MessageContext, Translations } from "../src/typeDefs.js";

/**
 * Returns a sanitized po data dictionary where:
 * - no fuzzy or obsolete strings are returned
 * - no empty translations are returned
 *
 * @param poItems items from the PO catalog
 * @returns jsonData: sanitized PO data
 */
export const sanitizePoData = (poItems: InstanceType<typeof Pofile.Item>[]) => {
  const messages: LanguageData = {};

  for (let item of poItems) {
    const ctx = item.msgctxt || "";
    if (item.msgstr[0] && item.msgstr[0].length > 0 && !item.flags.fuzzy && !(item as any).obsolete) {
      if (!messages[item.msgid]) {
        messages[item.msgid] = {};
      }
      // Add an array for plural, a single string for singular.
      (messages[item.msgid] as MessageContext)[ctx] = item.msgstr.length === 1 ? item.msgstr[0] : item.msgstr;
    }
  }

  // Strip context from messages that have no context.
  for (let key in messages) {
    if (Object.keys(messages[key]).length === 1 && (messages[key] as MessageContext)[""]) {
      messages[key] = (messages[key] as MessageContext)[""];
    }
  }

  return messages;
};

export const po2json = (poContent: string) => {
  const catalog = Pofile.parse(poContent);
  if (!catalog.headers.Language) {
    throw new Error("No Language headers found!");
  }
  return {
    headers: catalog.headers,
    messages: sanitizePoData(catalog.items),
  };
};

// Arrays are left alone: plural forms are positional.
const sortKeys = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((key) => [key, sortKeys(obj[key])]),
  );
};

/**
 * Serializes compiled translations for writing to disk.
 *
 * When `pretty` is set, keys are sorted and each entry gets its own line so that
 * unrelated translation changes on different branches merge cleanly in git.
 */
export const serializeTranslations = (translations: Translations, pretty = false) =>
  pretty ? `${JSON.stringify(sortKeys(translations), null, 2)}\n` : JSON.stringify(translations);

export const compilePoFiles = async (localesPaths: string[]) => {
  const translations: Translations = {};

  await Promise.all(
    localesPaths.map(async (lp) => {
      const fileContent = await fsPromises.readFile(lp, { encoding: "utf-8" });
      const data = po2json(fileContent);
      const lang = data.headers.Language;
      if (lang && !translations[lang]) {
        translations[lang] = data.messages;
      } else {
        Object.assign(translations[data.headers.Language!], data.messages);
      }
    }),
  );

  return translations;
};

export const getPoPaths = (config: GettextConfig) =>
  config.output.locales.map((loc) =>
    config.output.flat ? path.join(config.output.path, `${loc}.po`) : path.join(config.output.path, `${loc}/app.po`),
  );

const writeIfChanged = async (filePath: string, content: string) => {
  const existing = await fsPromises.readFile(filePath, { encoding: "utf-8" }).catch(() => undefined);
  if (existing === content) {
    return false;
  }
  // The json may go to its own directory, which won't exist on a clean checkout if it isn't committed.
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  // Write to a temp file and rename it into place, so watchers never see a partially written file.
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fsPromises.writeFile(tmpPath, content);
    await fsPromises.rename(tmpPath, filePath);
  } catch (e) {
    await fsPromises.rm(tmpPath, { force: true });
    throw e;
  }
  return true;
};

/**
 * Compiles the configured locales' `.po` files and writes the json output.
 *
 * Files whose content is unchanged are not rewritten, so file watchers
 * (e.g. a Vite dev server) aren't triggered needlessly.
 */
export const compileTranslations = async (config: GettextConfig) => {
  const translations = await compilePoFiles(getPoPaths(config));
  const outputs = config.output.splitJson
    ? config.output.locales.map((locale) => ({
        path: path.join(config.output.jsonPath, `${locale}.json`),
        content: serializeTranslations({ [locale]: translations[locale] }, config.output.prettyJson),
      }))
    : [{ path: config.output.jsonPath, content: serializeTranslations(translations, config.output.prettyJson) }];

  const files = await Promise.all(
    outputs.map(async (output) => ({ path: output.path, changed: await writeIfChanged(output.path, output.content) })),
  );
  return { localeCount: Object.keys(translations).length, files };
};
