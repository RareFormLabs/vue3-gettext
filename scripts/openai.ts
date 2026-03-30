import { TranslationEntry, TranslationResult, Translator, TranslatorRequest } from "./translate.js";

type OpenAITranslatorOptions = {
  model: string;
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
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
      translateOnlyMissingEntries: true,
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

export class OpenAITranslator implements Translator {
  private readonly options: OpenAITranslatorOptions;

  constructor(options: OpenAITranslatorOptions) {
    this.options = options;
  }

  async translate(request: TranslatorRequest): Promise<TranslationResult[]> {
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
    const content = data.choices?.[0]?.message?.content;
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

    return parsed.translations.map((translation) => {
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
}
