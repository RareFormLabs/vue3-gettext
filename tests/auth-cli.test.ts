import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("vue-gettext-auth CLI", () => {
  it("logs in, lists redacted metadata, and logs out", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vue-gettext-auth-cli-"));
    const configPath = path.join(tempDir, "gettext.config.mjs");
    const credentialsPath = path.join(tempDir, "credentials", "auth.json");
    const scriptPath = path.resolve("scripts/gettext_auth.ts");
    await writeFile(configPath, "export default {};\n");

    const run = (args: string[], input?: string) =>
      spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
        input,
      });

    try {
      const login = run(
        ["login", "openai", "--type", "api-key", "--config", configPath, "--credentials", credentialsPath],
        "super-secret-test-key\n",
      );
      expect(login.status, login.stderr).toBe(0);
      expect(`${login.stdout}${login.stderr}`).not.toContain("super-secret-test-key");

      const list = run(["list", "--config", configPath, "--credentials", credentialsPath]);
      expect(list.status, list.stderr).toBe(0);
      expect(list.stdout).toContain("openai\tapi_key");
      expect(list.stdout).not.toContain("super-secret-test-key");

      const logout = run(["logout", "openai", "--config", configPath, "--credentials", credentialsPath]);
      expect(logout.status, logout.stderr).toBe(0);
      expect(JSON.parse(await readFile(credentialsPath, "utf8"))).toEqual({});
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
