import {
  Type,
  validateToolCall,
  type Api,
  type AuthContext,
  type Model,
  type Models,
  type MutableModels,
  type Tool,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { TranslationModelConfig } from "../src/typeDefs.js";
import type { FileCredentialStore } from "./credential-store.js";
import type { TranslationEntry, TranslationResult, Translator, TranslatorRequest } from "./translate.js";

const TRANSLATION_TOOL_NAME = "submit_translations";
const TRANSLATION_TIMEOUT_MS = 10 * 60 * 1000;

const translationTool: Tool = {
  name: TRANSLATION_TOOL_NAME,
  description: "Submit the complete set of translated gettext entries.",
  parameters: Type.Object(
    {
      translations: Type.Array(
        Type.Object(
          {
            key: Type.String(),
            msgstr: Type.Array(Type.String()),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
};

const buildSystemPrompt = (locale: string) =>
  [
    `You translate gettext PO entries into locale ${locale}.`,
    `Call ${TRANSLATION_TOOL_NAME} exactly once with every requested translation.`,
    "Preserve placeholders, HTML, punctuation, whitespace intent, and line breaks.",
    "Never rewrite keys or omit entries.",
    "For plural entries, return one translation string per requested plural form.",
    "Use context, comments, references, and previous translations only to disambiguate meaning.",
  ].join(" ");

const buildUserPrompt = (request: TranslatorRequest) =>
  JSON.stringify({
    locale: request.locale,
    instructions: {
      preserveFormatting: true,
      preservePlaceholders: true,
      translateOnlyMissingEntries: !request.includeTranslated,
    },
    entries: request.entries.map((entry: TranslationEntry) => ({
      key: entry.key,
      msgctxt: entry.msgctxt || null,
      msgid: entry.msgid,
      msgid_plural: entry.msgidPlural || null,
      references: entry.references,
      extractedComments: entry.extractedComments,
      translatorComments: entry.translatorComments,
      previousTranslations: entry.previousTranslations,
      targetPluralCount: entry.targetPluralCount,
    })),
  });

const validateTranslations = (request: TranslatorRequest, value: unknown): TranslationResult[] => {
  const translations = (value as { translations?: unknown } | undefined)?.translations;
  if (!Array.isArray(translations)) {
    throw new Error("The translation tool call did not include a translations array.");
  }
  if (translations.length !== request.entries.length) {
    throw new Error(
      `The model returned ${translations.length} translations for ${request.entries.length} requested entries.`,
    );
  }

  const entryMap = new Map(request.entries.map((entry) => [entry.key, entry]));
  const seenKeys = new Set<string>();
  return translations.map((translation) => {
    if (!translation || typeof translation !== "object") {
      throw new Error("The model returned a malformed translation object.");
    }
    const { key, msgstr } = translation as { key?: unknown; msgstr?: unknown };
    if (typeof key !== "string" || !Array.isArray(msgstr) || !msgstr.every((entry) => typeof entry === "string")) {
      throw new Error("The model returned a translation without a string key and string-array msgstr.");
    }
    if (seenKeys.has(key)) {
      throw new Error(`The model returned a duplicate translation key: ${key}`);
    }
    seenKeys.add(key);
    const entry = entryMap.get(key);
    if (!entry) {
      throw new Error(`The model returned an unknown translation key: ${key}`);
    }
    if (msgstr.length !== entry.targetPluralCount) {
      throw new Error(`The model returned ${msgstr.length} forms for ${key}, expected ${entry.targetPluralCount}.`);
    }
    return { key, msgstr };
  });
};

export class PiTranslator implements Translator {
  constructor(
    private readonly models: Models,
    private readonly model: Model<Api>,
  ) {}

  async translate(request: TranslatorRequest): Promise<TranslationResult[]> {
    const response = await this.models.completeSimple(
      this.model,
      {
        systemPrompt: buildSystemPrompt(request.locale),
        messages: [{ role: "user", content: buildUserPrompt(request), timestamp: Date.now() }],
        tools: [translationTool],
      },
      { signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS) },
    );

    if (response.stopReason !== "stop" && response.stopReason !== "toolUse") {
      const detail = response.errorMessage ? ` ${response.errorMessage}` : "";
      throw new Error(`Translation request stopped with reason ${response.stopReason}.${detail}`);
    }
    const toolCalls = response.content.filter((block) => block.type === "toolCall");
    if (toolCalls.length !== 1 || toolCalls[0].name !== TRANSLATION_TOOL_NAME) {
      throw new Error(`The model must call ${TRANSLATION_TOOL_NAME} exactly once.`);
    }

    validateToolCall([translationTool], toolCalls[0]);
    // pi-ai converts schema values during validation. Validate the raw arguments too
    // so values such as a string msgstr cannot be silently coerced to an array.
    return validateTranslations(request, toolCalls[0].arguments);
  }
}

type CreatePiTranslatorOptions = {
  selection: TranslationModelConfig;
  credentials: FileCredentialStore;
  createEnvironmentModels?: () => MutableModels;
  createAmbientModels?: () => MutableModels;
  createStoredModels?: (credentials: FileCredentialStore) => MutableModels;
};

const refreshModels = async (models: MutableModels, provider: string) => {
  for (const entry of models.getProviders()) {
    if (entry.id !== provider) {
      models.deleteProvider(entry.id);
    }
  }
  const result = await models.refresh();
  const error = result.errors.get(provider);
  if (error) {
    throw new Error(`Failed to refresh models for provider ${provider}: ${error.message}`);
  }
};

const AMBIENT_AUTH_ENVIRONMENT_VARIABLES = new Set([
  "AWS_PROFILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
]);

export const explicitEnvironmentAuthContext: AuthContext = {
  env: async (name) => (AMBIENT_AUTH_ENVIRONMENT_VARIABLES.has(name) ? undefined : process.env[name]),
  fileExists: async () => false,
};

const validateBaseUrl = (value: string | undefined) => {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid model base URL: ${value}`);
  }
  if (parsed.protocol === "https:") return value;

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (parsed.protocol === "http:" && isLoopback) return value;
  throw new Error("Model base URL must use HTTPS, except for HTTP loopback addresses such as localhost.");
};

export const createPiTranslator = async ({
  selection,
  credentials,
  createEnvironmentModels = () => builtinModels({ authContext: explicitEnvironmentAuthContext }),
  createAmbientModels = () => builtinModels(),
  createStoredModels = (store) => builtinModels({ credentials: store }),
}: CreatePiTranslatorOptions) => {
  const baseUrl = validateBaseUrl(selection.baseUrl);
  const environmentModels = createEnvironmentModels();
  const ambientModels = createAmbientModels();
  const storedModels = createStoredModels(credentials);
  const provider = ambientModels.getProvider(selection.provider);
  if (!provider) {
    const available = ambientModels
      .getProviders()
      .map((entry) => entry.id)
      .sort()
      .join(", ");
    throw new Error(`Unknown translation provider: ${selection.provider}. Available providers: ${available}`);
  }

  const environmentAuth = await environmentModels.checkAuth(selection.provider);
  const savedCredential = await credentials.read(selection.provider);
  const models = environmentAuth ? environmentModels : savedCredential ? storedModels : ambientModels;
  await refreshModels(models, selection.provider);
  const resolvedModel = models.getModel(selection.provider, selection.id);
  if (!resolvedModel) {
    const available = models
      .getModels(selection.provider)
      .map((entry) => entry.id)
      .sort()
      .join(", ");
    const suffix = available ? ` Available models: ${available}` : "";
    throw new Error(`Unknown model ${selection.id} for provider ${selection.provider}.${suffix}`);
  }

  const model = baseUrl ? { ...resolvedModel, baseUrl } : resolvedModel;
  return new PiTranslator(models, model);
};
