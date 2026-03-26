import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { cwd } from "process";
import { execSync } from "child_process";
import { describe, it, expect } from "vitest";

describe("Improved Extractor Options Tests", () => {
  type WithTempDirTest = (tmpDir: string) => Promise<any>;

  const withTempDir = async (testFunc: WithTempDirTest) => {
    let tmpDir;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "vue3-gettext-improved-extract-"));
      await testFunc(tmpDir);
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }
  };

  it("should support addLocation: 'file'", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', addLocation: 'file' } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      const potContent = (await readFile(join(tmpDir, "srctest", "lang", "messages.pot"))).toString();
      expect(potContent).toContain("#: srctest/test.js\n");
      expect(potContent).not.toContain("#: srctest/test.js:1");
    });
  });

  it("should support addLocation: 'never'", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', addLocation: 'never' } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Hello')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      const potContent = (await readFile(join(tmpDir, "srctest", "lang", "messages.pot"))).toString();
      expect(potContent).not.toContain("#:");
    });
  });

  it("should support autoFill: true", async () => {
    await withTempDir(async (tmpDir) => {
      for (const d of ["src", "scripts", "node_modules"]) {
        await symlink(join(cwd(), d), join(tmpDir, d));
      }
      await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      // We only test with 'en' locale for auto-filling
      await writeFile(
        join(tmpDir, "gettext.config.js"),
        `export default { 
          input: { path: './srctest', include: ['*.js'] }, 
          output: { path: './srctest/lang', locales: ['en'], autoFill: true } 
        };`,
      );

      await mkdir(join(tmpDir, "srctest", "lang"), { recursive: true });
      await writeFile(join(tmpDir, "srctest", "test.js"), `$gettext('Auto me')`);

      execSync(`sh -c 'cd ${tmpDir}; npx tsx ./scripts/gettext_extract.ts'`);

      // Check en.po (flat: true default means path/en.po)
      const poContent = (await readFile(join(tmpDir, "srctest", "lang", "en.po"))).toString();
      expect(poContent).toContain('msgid "Auto me"\nmsgstr "Auto me"');
    });
  });
});
