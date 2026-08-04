import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileCredentialStore } from "../scripts/credential-store.js";
import { createPiTranslator, explicitEnvironmentAuthContext, PiTranslator } from "../scripts/pi.js";
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
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-pi-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

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

    const truncated = makeTranslator([], { stopReason: "length" });
    await expect(truncated.translate(request)).rejects.toThrow("stopped with reason length");
  });

  it("resolves any registered provider/model and applies a local base URL", async () => {
    const faux = fauxProvider({ provider: "google", models: [{ id: "gemini-test" }] });
    faux.setResponses([
      (_context, options, _state, model) => {
        expect(model.baseUrl).toBe("http://localhost:11434/v1");
        expect(options?.signal).toBeInstanceOf(AbortSignal);
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
      credentials: new FileCredentialStore(path.join(tempDir, "unused-auth.json")),
      createAmbientModels: () => ambient,
      createStoredModels: () => stored,
    });

    await expect(translator.translate(request)).resolves.toHaveLength(2);
  });

  it("rejects insecure remote base URLs", async () => {
    const faux = fauxProvider({ provider: "remote-provider", models: [{ id: "test-model" }] });
    const models = createModels();
    models.setProvider(faux.provider);

    await expect(
      createPiTranslator({
        selection: { provider: "remote-provider", id: "test-model", baseUrl: "http://api.example.test/v1" },
        credentials: new FileCredentialStore(path.join(tempDir, "remote-auth.json")),
        createAmbientModels: () => models,
        createStoredModels: () => models,
      }),
    ).rejects.toThrow("must use HTTPS");
  });

  it("reports unknown providers and models clearly", async () => {
    const faux = fauxProvider({ provider: "faux-provider", models: [{ id: "known-model" }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const credentials = new FileCredentialStore(path.join(tempDir, "unknown-auth.json"));

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
    let unrelatedRefreshes = 0;
    models.setProvider({
      ...faux.provider,
      getModels: () => (refreshed ? faux.models : []),
      refreshModels: async () => {
        refreshed = true;
      },
    });
    const unrelated = fauxProvider({ provider: "unrelated-provider", models: [] });
    models.setProvider({
      ...unrelated.provider,
      refreshModels: async () => {
        unrelatedRefreshes += 1;
      },
    });
    const credentials = new FileCredentialStore(path.join(tempDir, "dynamic-auth.json"));

    await expect(
      createPiTranslator({
        selection: { provider: "dynamic-provider", id: "dynamic-model" },
        credentials,
        createAmbientModels: () => models,
        createStoredModels: () => models,
      }),
    ).resolves.toBeInstanceOf(PiTranslator);
    expect(refreshed).toBe(true);
    expect(unrelatedRefreshes).toBe(0);
  });

  it("prefers saved credentials over profile-style ambient auth", async () => {
    const providerId = "credential-precedence";
    const modelId = "test-model";
    const ambientFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const storedFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const ambient = createModels();
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
    const credentials = new FileCredentialStore(path.join(tempDir, "saved-precedence.json"));
    await credentials.modify(providerId, async () => ({ type: "api_key", key: "saved-key" }));

    const translator = await createPiTranslator({
      selection: { provider: providerId, id: modelId },
      credentials,
      createAmbientModels: () => ambient,
      createStoredModels: () => stored,
    });

    await expect(translator.translate(request)).resolves.toHaveLength(2);
    expect(storedFaux.state.callCount).toBe(1);
    expect(ambientFaux.state.callCount).toBe(0);
  });

  it("prefers an explicit provider environment key over saved credentials", async () => {
    const providerId = "environment-precedence";
    const modelId = "test-model";
    const environmentFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const storedFaux = fauxProvider({ provider: providerId, models: [{ id: modelId }] });
    const environment = createModels({ authContext: explicitEnvironmentAuthContext });
    environment.setProvider({
      ...environmentFaux.provider,
      auth: {
        apiKey: {
          name: "Environment key",
          resolve: async ({ ctx }) => {
            const key = await ctx.env("VUE_GETTEXT_TEST_API_KEY");
            return key ? { auth: { apiKey: key }, source: "VUE_GETTEXT_TEST_API_KEY" } : undefined;
          },
        },
      },
    });
    const ambient = createModels();
    ambient.setProvider(environmentFaux.provider);
    const stored = createModels();
    stored.setProvider(storedFaux.provider);
    environmentFaux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("submit_translations", {
          translations: [
            { key: "hello-key", msgstr: ["Bonjour"] },
            { key: "cars-key", msgstr: ["voiture", "voitures"] },
          ],
        }),
      ),
    ]);
    const credentials = new FileCredentialStore(path.join(tempDir, "environment-precedence.json"));
    await credentials.modify(providerId, async () => ({ type: "api_key", key: "saved-key" }));
    const previousKey = process.env.VUE_GETTEXT_TEST_API_KEY;
    try {
      process.env.VUE_GETTEXT_TEST_API_KEY = "environment-key";
      const translator = await createPiTranslator({
        selection: { provider: providerId, id: modelId },
        credentials,
        createEnvironmentModels: () => environment,
        createAmbientModels: () => ambient,
        createStoredModels: () => stored,
      });

      await expect(translator.translate(request)).resolves.toHaveLength(2);
      expect(environmentFaux.state.callCount).toBe(1);
      expect(storedFaux.state.callCount).toBe(0);
    } finally {
      if (previousKey === undefined) delete process.env.VUE_GETTEXT_TEST_API_KEY;
      else process.env.VUE_GETTEXT_TEST_API_KEY = previousKey;
    }
  });

  it("separates explicit environment credentials from profile and file-based ambient auth", async () => {
    const names = ["ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_PROFILE", "GOOGLE_APPLICATION_CREDENTIALS"] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      Object.assign(process.env, {
        ANTHROPIC_API_KEY: "explicit-key",
        AWS_ACCESS_KEY_ID: "explicit-access-key",
        AWS_PROFILE: "ambient-profile",
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/ambient-adc.json",
      });
      await expect(explicitEnvironmentAuthContext.env("ANTHROPIC_API_KEY")).resolves.toBe("explicit-key");
      await expect(explicitEnvironmentAuthContext.env("AWS_ACCESS_KEY_ID")).resolves.toBe("explicit-access-key");
      await expect(explicitEnvironmentAuthContext.env("AWS_PROFILE")).resolves.toBeUndefined();
      await expect(explicitEnvironmentAuthContext.env("GOOGLE_APPLICATION_CREDENTIALS")).resolves.toBeUndefined();
      await expect(explicitEnvironmentAuthContext.fileExists("~/.aws/credentials")).resolves.toBe(false);
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
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
    const credentialPath = path.join(tempDir, "oauth-refresh.json");
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
