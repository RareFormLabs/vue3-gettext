import os from "node:os";
import { TranslationEntry, TranslationResult, Translator, TranslatorRequest } from "./translate.js";
import { resolveOpenAIOAuth } from "./openai-oauth.js";

type OpenAITranslatorOptions = {
  model: string;
  authMode?: "api-key" | "oauth";
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  credentialsPath?: string;
  accessTokenEnvVar?: string;
  refreshTokenEnvVar?: string;
  accountIdEnvVar?: string;
  persistRefresh?: boolean;
  originator?: string;
};

const translationResponseSchema = {
  name: "translation_results",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["translations"],
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "msgstr"],
          properties: {
            key: { type: "string" },
            msgstr: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  },
  strict: true,
};

const buildSystemPrompt = (locale: string) =>
  [
    `You translate gettext PO entries into locale ${locale}.`,
    "Return valid JSON only.",
    "Preserve placeholders, HTML, punctuation, whitespace intent, and line breaks.",
    "Never rewrite keys or omit entries.",
    "For plural entries, return one translation string per plural form requested.",
    "Use the provided context/comments/references only to disambiguate meaning.",
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

const decodeContent = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "type" in item && (item as { type?: string }).type === "output_text") {
          return (item as { text?: string }).text || "";
        }
        return "";
      })
      .join("");
  }
  return "";
};

const extractAccountId = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      throw new Error("Invalid token");
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };
    const accountId = decoded["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (!accountId) {
      throw new Error("No account ID in token");
    }
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
};

const createCodexHeaders = (token: string, accountId: string, originator = "pi") => {
  const userAgent = `vue3-gettext (${os.platform()} ${os.release()}; ${os.arch()})`;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "OpenAI-Beta": "responses=experimental",
    "chatgpt-account-id": accountId,
    originator,
    "User-Agent": userAgent,
  };
};

export class OpenAITranslator implements Translator {
  private readonly options: OpenAITranslatorOptions;

  constructor(options: OpenAITranslatorOptions) {
    this.options = options;
  }

  private async translateWithApiKey(request: TranslatorRequest): Promise<TranslationResult[]> {
    const response = await fetch(`${this.options.baseUrl || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        ...(this.options.organization ? { "OpenAI-Organization": this.options.organization } : {}),
        ...(this.options.project ? { "OpenAI-Project": this.options.project } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: "system", content: buildSystemPrompt(request.locale) },
          { role: "user", content: buildUserPrompt(request) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: translationResponseSchema,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return this.validateTranslations(request, data.choices?.[0]?.message?.content);
  }

  private async translateWithOAuth(request: TranslatorRequest): Promise<TranslationResult[]> {
    const resolved = await resolveOpenAIOAuth({
      credentialsPath: this.options.credentialsPath,
      accessTokenEnvVar: this.options.accessTokenEnvVar,
      refreshTokenEnvVar: this.options.refreshTokenEnvVar,
      accountIdEnvVar: this.options.accountIdEnvVar,
      persistRefresh: this.options.persistRefresh,
      originator: this.options.originator,
    });

    const accountId = resolved.accountId || extractAccountId(resolved.accessToken);
    const response = await fetch(`${this.options.baseUrl || "https://chatgpt.com/backend-api"}/codex/responses`, {
      method: "POST",
      headers: createCodexHeaders(resolved.accessToken, accountId, this.options.originator || "pi"),
      body: JSON.stringify({
        model: this.options.model,
        store: false,
        stream: false,
        instructions: buildSystemPrompt(request.locale),
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: buildUserPrompt(request) }],
          },
        ],
        text: { verbosity: "medium" },
        response_format: {
          type: "json_schema",
          json_schema: translationResponseSchema,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI OAuth request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      output?: Array<{ content?: unknown }>;
    };
    const content = decodeContent(data.output?.flatMap((item) => item.content || []) || []);
    return this.validateTranslations(request, content);
  }

  private validateTranslations(request: TranslatorRequest, content: string | undefined) {
    if (!content) {
      throw new Error("OpenAI response did not include any content.");
    }

    const parsed = JSON.parse(content) as { translations?: TranslationResult[] };
    if (!Array.isArray(parsed.translations)) {
      throw new Error("OpenAI response did not include a translations array.");
    }

    const entryMap = new Map(request.entries.map((entry) => [entry.key, entry]));
    if (parsed.translations.length !== request.entries.length) {
      throw new Error(
        `OpenAI returned ${parsed.translations.length} translations for ${request.entries.length} requested entries.`,
      );
    }

    const seenKeys = new Set<string>();
    return parsed.translations.map((translation) => {
      if (seenKeys.has(translation.key)) {
        throw new Error(`OpenAI returned a duplicate translation key: ${translation.key}`);
      }
      seenKeys.add(translation.key);
      const entry = entryMap.get(translation.key);
      if (!entry) {
        throw new Error(`OpenAI returned an unknown translation key: ${translation.key}`);
      }
      if (translation.msgstr.length !== entry.targetPluralCount) {
        throw new Error(
          `OpenAI returned ${translation.msgstr.length} forms for ${translation.key}, expected ${entry.targetPluralCount}.`,
        );
      }
      return translation;
    });
  }

  async translate(request: TranslatorRequest): Promise<TranslationResult[]> {
    if (this.options.authMode === "oauth") {
      return this.translateWithOAuth(request);
    }
    return this.translateWithApiKey(request);
  }
}
