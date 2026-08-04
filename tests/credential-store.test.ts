import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileCredentialStore } from "../scripts/credential-store.js";

describe("FileCredentialStore", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-auth-"));
    filePath = path.join(tempDir, "nested", "auth.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores provider-keyed credentials without exposing secrets from list", async () => {
    const store = new FileCredentialStore(filePath);
    await store.modify("anthropic", async () => ({ type: "api_key", key: "secret-anthropic" }));
    await store.modify("openai-codex", async () => ({
      type: "oauth",
      access: "secret-access",
      refresh: "secret-refresh",
      expires: Date.now() + 60_000,
    }));

    expect(await store.list()).toEqual([
      { providerId: "anthropic", type: "api_key" },
      { providerId: "openai-codex", type: "oauth" },
    ]);
    expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "secret-anthropic" });
    expect(JSON.stringify(await store.list())).not.toContain("secret");
  });

  it("serializes concurrent provider updates and writes restrictive permissions", async () => {
    const first = new FileCredentialStore(filePath);
    const second = new FileCredentialStore(filePath);
    await Promise.all([
      first.modify("anthropic", async () => ({ type: "api_key", key: "one" })),
      second.modify("openai", async () => ({ type: "api_key", key: "two" })),
    ]);

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    expect(Object.keys(parsed).sort()).toEqual(["anthropic", "openai"]);
    if (process.platform !== "win32") {
      expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("leaves a credential unchanged when modify returns undefined", async () => {
    const store = new FileCredentialStore(filePath);
    await store.modify("anthropic", async () => ({ type: "api_key", key: "original" }));

    await expect(store.modify("anthropic", async () => undefined)).resolves.toEqual({
      type: "api_key",
      key: "original",
    });
    await expect(store.read("anthropic")).resolves.toEqual({ type: "api_key", key: "original" });
  });

  it("deletes one provider without disturbing others", async () => {
    const store = new FileCredentialStore(filePath);
    await store.modify("anthropic", async () => ({ type: "api_key", key: "one" }));
    await store.modify("openai", async () => ({ type: "api_key", key: "two" }));
    await store.delete("anthropic");

    expect(await store.read("anthropic")).toBeUndefined();
    expect(await store.read("openai")).toEqual({ type: "api_key", key: "two" });
  });

  it("rejects corrupt files without overwriting them", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not-json");
    const store = new FileCredentialStore(filePath);

    await expect(store.modify("anthropic", async () => ({ type: "api_key", key: "secret" }))).rejects.toThrow(
      "not valid JSON",
    );
    expect(await readFile(filePath, "utf8")).toBe("{not-json");
  });

  it("rejects structurally invalid credentials", async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{"anthropic":{"type":"oauth","access":"missing-fields"}}\n');
    const store = new FileCredentialStore(filePath);

    await expect(store.list()).rejects.toThrow("invalid credential for provider anthropic");
  });
});
