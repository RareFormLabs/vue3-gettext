import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import os from "node:os";
import path from "node:path";
import { FileCredentialStore } from "../scripts/credential-store.js";
import { createPiTranslator, PiTranslator } from "../scripts/pi.js";
import type { TranslatorRequest } from "../scripts/translate.js";

const request: TranslatorRequest = {
  locale: "fr",
  entries: [
    {
      key: "hello-key",
      msgid: "Hello",
      references: [],
      extractedComments: [],
      translatorComments: [],
      previousTranslations: [""],
      targetPluralCount: 1,
    },
    {
      key: "cars-key",
      msgid: "car",
      msgidPlural: "cars",
      references: [],
      extractedComments: [],
      translatorComments: [],
      previousTranslations: ["", ""],
      targetPluralCount: 2,
    },
  ],
};

const makeTranslator = (
  content: Parameters<typeof fauxAssistantMessage>[0],
  options?: Parameters<typeof fauxAssistantMessage>[1],
  provider = "anthropic",
) => {
  const faux = fauxProvider({ provider, models: [{ id: "test-model" }] });
  faux.setResponses([fauxAssistantMessage(content, options)]);
  const models = createModels();
  models.setProvider(faux.provider);
  return new PiTranslator(models, faux.getModel());
};

describe("PiTranslator", () => {
  it.each(["anthropic", "openai", "faux-third"])(
    "translates through the provider-neutral tool contract for %s",
    async (provider) => {
      const translator = makeTranslator(
        fauxToolCall("submit_translations", {
          translations: [
            { key: "hello-key", msgstr: ["Bonjour"] },
            { key: "cars-key", msgstr: ["voiture", "voitures"] },
          ],
        }),
        undefined,
        provider,
      );

      await expect(translator.translate(request)).resolves.toEqual([
        { key: "hello-key", msgstr: ["Bonjour"] },
        { key: "cars-key", msgstr: ["voiture", "voitures"] },
      ]);
    },
  );

  it("requires exactly one translation tool call", async () => {
    const translator = makeTranslator(fauxText("Here are your translations."));
    await expect(translator.translate(request)).rejects.toThrow("exactly once");
  });

  it("rejects duplicate, unknown, and incorrectly pluralized results", async () => {
    const duplicate = makeTranslator(
      fauxToolCall("submit_translations", {
        translations: [
          { key: "hello-key", msgstr: ["Bonjour"] },
          { key: "hello-key", msgstr: ["Encore"] },
        ],
      }),
    );
    await expect(duplicate.translate(request)).rejects.toThrow("duplicate translation key");

    const unknown = makeTranslator(
      fauxToolCall("submit_translations", {
        translations: [
          { key: "hello-key", msgstr: ["Bonjour"] },
          { key: "unknown-key", msgstr: ["Inconnu", "Inconnus"] },
        ],
      }),
    );
    await expect(unknown.translate(request)).rejects.toThrow("unknown translation key");

    const wrongPlural = makeTranslator(
      fauxToolCall("submit_translations", {
        translations: [
          { key: "hello-key", msgstr: ["Bonjour"] },
          { key: "cars-key", msgstr: ["voiture"] },
        ],
      }),
    );
    await expect(wrongPlural.translate(request)).rejects.toThrow("expected 2");
  });

  it("rejects malformed tool arguments and provider failures", async () => {
    const malformed = makeTranslator(
      fauxToolCall("submit_translations", {
        translations: [
          { key: "hello-key", msgstr: "Bonjour" },
          { key: "cars-key", msgstr: ["voiture", "voitures"] },
        ],
      }),
    );
    await expect(malformed.translate(request)).rejects.toThrow();

    const failed = makeTranslator([], { stopReason: "error", errorMessage: "Provider unavailable" });
    await expect(failed.translate(request)).rejects.toThrow("Provider unavailable");
  });

  it("resolves any registered provider/model and applies a local base URL", async () => {
    const faux = fauxProvider({ provider: "google", models: [{ id: "gemini-test" }] });
    faux.setResponses([
      (_context, _options, _state, model) => {
        expect(model.baseUrl).toBe("http://localhost:11434/v1");
        return fauxAssistantMessage(
          fauxToolCall("submit_translations", {
            translations: [
              { key: "hello-key", msgstr: ["Bonjour"] },
              { key: "cars-key", msgstr: ["voiture", "voitures"] },
            ],
          }),
        );
      },
    ]);
    const ambient = createModels();
    ambient.setProvider(faux.provider);
    const stored = createModels();
    stored.setProvider(faux.provider);
    const translator = await createPiTranslator({
      selection: { provider: "google", id: "gemini-test", baseUrl: "http://localhost:11434/v1" },
      credentials: new FileCredentialStore(path.join(os.tmpdir(), "unused-vue-gettext-auth.json")),
      createAmbientModels: () => ambient,
      createStoredModels: () => stored,
    });

    await expect(translator.translate(request)).resolves.toHaveLength(2);
  });

  it("reports unknown providers and models clearly", async () => {
    const faux = fauxProvider({ provider: "faux-provider", models: [{ id: "known-model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const credentials = new FileCredentialStore(path.join(os.tmpdir(), "unused-vue-gettext-auth.json"));

    await expect(
      createPiTranslator({
        selection: { provider: "missing-provider", id: "known-model" },
        credentials,
        createAmbientModels: () => models,
        createStoredModels: () => models,
      }),
    ).rejects.toThrow("Unknown translation provider");

    await expect(
      createPiTranslator({
        selection: { provider: "faux-provider", id: "missing-model" },
        credentials,
        createAmbientModels: () => models,
        createStoredModels: () => models,
      }),
    ).rejects.toThrow("Unknown model missing-model for provider faux-provider");
  });

  it("refreshes a dynamic provider before resolving its model", async () => {
    const faux = fauxProvider({ provider: "dynamic-provider", models: [{ id: "dynamic-model" }] });
    const models = createModels();
    let refreshed = false;
    models.setProvider({
      ...faux.provider,
      getModels: () => (refreshed ? faux.models : []),
      refreshModels: async () => {
        refreshed = true;
      },
    });
    const credentials = new FileCredentialStore(
      path.join(os.tmpdir(), `vue-gettext-dynamic-provider-${process.pid}.json`),
    );

    await expect(
      createPiTranslator({
        selection: { provider: "dynamic-provider", id: "dynamic-model" },
        credentials,
        createAmbientModels: () => models,
        createStoredModels: () => models,
      }),
    ).resolves.toBeInstanceOf(PiTranslator);
    expect(refreshed).toBe(true);
  });

  it("prefers saved credentials over profile-style ambient auth", async () => {
    const providerId = "credential-precedence";
    const modelId = "test-model";
    const ambientFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const storedFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const ambient = createModels();
    process.env.AWS_PROFILE = "test-profile";
    ambient.setProvider({
      ...ambientFaux.provider,
      auth: {
        apiKey: {
          name: "Ambient profile",
          resolve: async () => ({ auth: {}, source: "AWS_PROFILE" }),
        },
      },
    });
    const stored = createModels();
    stored.setProvider(storedFaux.provider);
    storedFaux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("submit_translations", {
          translations: [
            { key: "hello-key", msgstr: ["Bonjour"] },
            { key: "cars-key", msgstr: ["voiture", "voitures"] },
          ],
        }),
      ),
    ]);
    const credentials = new FileCredentialStore(
      path.join(os.tmpdir(), `vue-gettext-saved-precedence-${process.pid}.json`),
    );
    await credentials.modify(providerId, async () => ({ type: "api_key", key: "saved-key" }));

    try {
      const translator = await createPiTranslator({
        selection: { provider: providerId, id: modelId },
        credentials,
        createAmbientModels: () => ambient,
        createStoredModels: () => stored,
      });

      await expect(translator.translate(request)).resolves.toHaveLength(2);
      expect(storedFaux.state.callCount).toBe(1);
      expect(ambientFaux.state.callCount).toBe(0);
    } finally {
      delete process.env.AWS_PROFILE;
    }
  });

  it("prefers an explicit provider environment key over saved credentials", async () => {
    const providerId = "environment-precedence";
    const modelId = "test-model";
    const ambientFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const storedFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const ambient = createModels();
    ambient.setProvider({
      ...ambientFaux.provider,
      auth: {
        apiKey: {
          name: "Environment key",
          resolve: async () => ({ auth: {}, source: "VUE_GETTEXT_TEST_API_KEY" }),
        },
      },
    });
    const stored = createModels();
    stored.setProvider(storedFaux.provider);
    ambientFaux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("submit_translations", {
          translations: [
            { key: "hello-key", msgstr: ["Bonjour"] },
            { key: "cars-key", msgstr: ["voiture", "voitures"] },
          ],
        }),
      ),
    ]);
    const credentials = new FileCredentialStore(
      path.join(os.tmpdir(), `vue-gettext-environment-precedence-${process.pid}.json`),
    );
    await credentials.modify(providerId, async () => ({ type: "api_key", key: "saved-key" }));
    process.env.VUE_GETTEXT_TEST_API_KEY = "environment-key";
    try {
      const translator = await createPiTranslator({
        selection: { provider: providerId, id: modelId },
        credentials,
        createAmbientModels: () => ambient,
        createStoredModels: () => stored,
      });

      await expect(translator.translate(request)).resolves.toHaveLength(2);
      expect(ambientFaux.state.callCount).toBe(1);
      expect(storedFaux.state.callCount).toBe(0);
    } finally {
      delete process.env.VUE_GETTEXT_TEST_API_KEY;
    }
  });

  it("persists refreshed OAuth credentials under the store lock", async () => {
    const providerId = "oauth-refresh";
    const modelId = "test-model";
    const faux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const provider = {
      ...faux.provider,
      auth: {
        oauth: {
          name: "Test OAuth",
          login: async () => {
            throw new Error("not used");
          },
          refresh: async (credential: { type: "oauth"; access: string; refresh: string; expires: number }) => ({
            ...credential,
            access: "refreshed-access",
            expires: Date.now() + 3_600_000,
          }),
          toAuth: async (credential: { access: string }) => ({
            headers: { Authorization: `Bearer ${credential.access}` },
          }),
        },
      },
    };
    const credentialPath = path.join(os.tmpdir(), `vue-gettext-oauth-refresh-${process.pid}.json`);
    const credentials = new FileCredentialStore(credentialPath);
    await credentials.modify(providerId, async () => ({
      type: "oauth",
      access: "expired-access",
      refresh: "refresh-token",
      expires: Date.now() - 1,
    }));
    const ambient = createModels();
    ambient.setProvider(provider);
    const stored = createModels({ credentials });
    stored.setProvider(provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("submit_translations", {
          translations: [
            { key: "hello-key", msgstr: ["Bonjour"] },
            { key: "cars-key", msgstr: ["voiture", "voitures"] },
          ],
        }),
      ),
    ]);

    const translator = await createPiTranslator({
      selection: { provider: providerId, id: modelId },
      credentials,
      createAmbientModels: () => ambient,
      createStoredModels: () => stored,
    });
    await expect(translator.translate(request)).resolves.toHaveLength(2);
    expect(await credentials.read(providerId)).toMatchObject({
      type: "oauth",
      access: "refreshed-access",
      refresh: "refresh-token",
    });
  });
});
