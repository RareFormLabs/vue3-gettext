import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLocalEnvironment, resolveLocalEnvPath, resolveModelSelection } from "../scripts/environment.js";

describe("translation environment", () => {
  it("resolves complete model pairs by layer without mixing them", () => {
    expect(
      resolveModelSelection({
        cliProvider: "anthropic",
        cliModel: "claude-sonnet-4-5",
        shellProvider: "openai",
        shellModel: "gpt-4.1-mini",
        configModel: { provider: "google", id: "gemini-2.5-flash" },
      }),
    ).toMatchObject({ provider: "anthropic", id: "claude-sonnet-4-5", source: "cli" });

    expect(
      resolveModelSelection({
        environmentProvider: "openai",
        environmentModel: "gpt-4.1-mini",
        configModel: { provider: "google", id: "gemini-2.5-flash" },
      }),
    ).toMatchObject({ provider: "openai", id: "gpt-4.1-mini", source: "local environment file" });
  });

  it("rejects incomplete higher-priority pairs", () => {
    expect(() =>
      resolveModelSelection({
        shellProvider: "anthropic",
        configModel: { provider: "openai", id: "gpt-4.1-mini" },
      }),
    ).toThrow("values are never mixed");
  });

  it("allows a CLI base URL to override a model pair from another layer", () => {
    expect(
      resolveModelSelection({
        cliBaseUrl: "http://localhost:11434/v1",
        configModel: { provider: "openai", id: "gpt-4.1-mini", baseUrl: "https://example.test/v1" },
      }),
    ).toMatchObject({
      provider: "openai",
      id: "gpt-4.1-mini",
      baseUrl: "http://localhost:11434/v1",
      source: "project config",
    });
  });

  it("resolves the automatic env file beside the config and tolerates a missing file", () => {
    const configPath = path.join(os.tmpdir(), "nested", "gettext.config.js");
    expect(resolveLocalEnvPath({ configPath })).toBe(path.join(os.tmpdir(), "nested", ".env.gettext"));
    expect(loadLocalEnvironment({ configPath })).toBeUndefined();
  });

  it("loads an explicit env file without replacing existing shell values", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-env-"));
    const envPath = path.join(tempDir, "translation.env");
    const previousProvider = process.env.VUE_GETTEXT_PROVIDER;
    const previousModel = process.env.VUE_GETTEXT_MODEL;
    process.env.VUE_GETTEXT_PROVIDER = "anthropic";
    delete process.env.VUE_GETTEXT_MODEL;
    try {
      await writeFile(envPath, "VUE_GETTEXT_PROVIDER=openai\nVUE_GETTEXT_MODEL=gpt-4.1-mini\n");
      expect(loadLocalEnvironment({ envFile: envPath })).toBe(envPath);
      expect(process.env.VUE_GETTEXT_PROVIDER).toBe("anthropic");
      expect(process.env.VUE_GETTEXT_MODEL).toBe("gpt-4.1-mini");
    } finally {
      if (previousProvider === undefined) delete process.env.VUE_GETTEXT_PROVIDER;
      else process.env.VUE_GETTEXT_PROVIDER = previousProvider;
      if (previousModel === undefined) delete process.env.VUE_GETTEXT_MODEL;
      else process.env.VUE_GETTEXT_MODEL = previousModel;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires an explicitly selected env file to exist", () => {
    expect(() => loadLocalEnvironment({ envFile: "/definitely/missing/vue-gettext.env" })).toThrow(
      "Environment file not found",
    );
  });
});
