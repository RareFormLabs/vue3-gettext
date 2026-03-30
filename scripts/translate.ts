import fsPromises from "node:fs/promises";
import path from "node:path";
import PO from "pofile";
import { GettextConfig } from "../src/typeDefs.js";

export type TranslationEntry = {
  key: string;
  msgid: string;
  msgidPlural?: string;
  msgctxt?: string;
  references: string[];
  extractedComments: string[];
  translatorComments: string[];
  previousTranslations: string[];
  targetPluralCount: number;
};

export type TranslationResult = {
  key: string;
  msgstr: string[];
};

export type TranslatorRequest = {
  locale: string;
  entries: TranslationEntry[];
  includeTranslated?: boolean;
};

export type Translator = {
  translate(request: TranslatorRequest): Promise<TranslationResult[]>;
};

export type TranslateCliOptions = {
  locale?: string[];
  provider?: string;
  model?: string;
  includeTranslated?: boolean;
  dryRun?: boolean;
};

export const getPoFilePath = (config: GettextConfig, locale: string) =>
  config.output.flat ? path.join(config.output.path, `${locale}.po`) : path.join(config.output.path, locale, "app.po");

export const parsePluralCount = (po: PO) => {
  const match = po.headers["Plural-Forms"]?.match(/nplurals\s*=\s*(\d+)/i);
  return Number.parseInt(match?.[1] || "1", 10) || 1;
};

export const buildItemKey = (item: InstanceType<typeof PO.Item>) =>
  JSON.stringify({
    msgctxt: item.msgctxt || "",
    msgid: item.msgid,
    msgidPlural: item.msgid_plural || "",
  });

const hasAnyTranslation = (item: InstanceType<typeof PO.Item>) =>
  item.msgstr.some((value) => value && value.trim().length > 0);

const hasCompleteTranslation = (item: InstanceType<typeof PO.Item>, pluralCount: number) => {
  const expectedCount = item.msgid_plural ? Math.max(pluralCount, item.msgstr.length || 0, 2) : 1;
  return Array.from({ length: expectedCount }).every((_, index) => {
    const value = item.msgstr[index];
    return Boolean(value && value.trim().length > 0);
  });
};

export const collectTranslationEntries = (po: PO, includeTranslated = false): TranslationEntry[] => {
  const pluralCount = parsePluralCount(po);

  return po.items
    .filter((item) => !(item as { obsolete?: boolean }).obsolete)
    .filter((item) => includeTranslated || !hasCompleteTranslation(item, pluralCount))
    .map((item) => ({
      key: buildItemKey(item),
      msgid: item.msgid,
      msgidPlural: item.msgid_plural || undefined,
      msgctxt: item.msgctxt || undefined,
      references: [...item.references],
      extractedComments: [...item.extractedComments],
      translatorComments: [...item.comments],
      previousTranslations: [...item.msgstr],
      targetPluralCount: item.msgid_plural ? Math.max(pluralCount, item.msgstr.length || 0, 2) : 1,
    }));
};

export const applyTranslations = (po: PO, translations: TranslationResult[]) => {
  const translationMap = new Map(translations.map((translation) => [translation.key, translation.msgstr]));
  let changed = 0;

  for (const item of po.items) {
    const translated = translationMap.get(buildItemKey(item));
    if (!translated) {
      continue;
    }

    const nextMsgstr = item.msgid_plural ? [...translated] : [translated[0] || ""];
    if (JSON.stringify(item.msgstr) === JSON.stringify(nextMsgstr)) {
      continue;
    }

    item.msgstr = nextMsgstr;
    changed += 1;
  }

  return changed;
};

export const loadPoFile = async (filePath: string) => {
  const fileContent = await fsPromises.readFile(filePath, { encoding: "utf-8" });
  return PO.parse(fileContent);
};

export const savePoFile = async (filePath: string, po: PO) => {
  await fsPromises.writeFile(filePath, po.toString());
};
