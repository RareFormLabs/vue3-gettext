import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import fsPromises from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

type CredentialFile = Record<string, Credential>;

const parseCredentialFile = (content: string, filePath: string): CredentialFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Credential file is not valid JSON: ${filePath}.${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Credential file must contain a provider-keyed JSON object: ${filePath}`);
  }
  for (const [providerId, credential] of Object.entries(parsed)) {
    const value = credential as Record<string, unknown> | null;
    const invalidBase = !value || typeof value !== "object" || !["api_key", "oauth"].includes(String(value.type));
    const invalidApiKey =
      value?.type === "api_key" &&
      ((value.key !== undefined && typeof value.key !== "string") ||
        (value.env !== undefined &&
          (!value.env ||
            typeof value.env !== "object" ||
            Array.isArray(value.env) ||
            Object.values(value.env).some((entry) => typeof entry !== "string"))));
    const invalidOAuth =
      value?.type === "oauth" &&
      (typeof value.access !== "string" || typeof value.refresh !== "string" || typeof value.expires !== "number");
    if (invalidBase || invalidApiKey || invalidOAuth) {
      throw new Error(`Credential file contains an invalid credential for provider ${providerId}: ${filePath}`);
    }
  }
  return parsed as CredentialFile;
};

export class FileCredentialStore implements CredentialStore {
  constructor(readonly filePath: string) {}

  private async ensureFile() {
    const directory = path.dirname(this.filePath);
    let createdDirectory = false;
    try {
      await fsPromises.stat(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 });
      createdDirectory = true;
    }
    if (createdDirectory) {
      await fsPromises.chmod(directory, 0o700);
    }
    let handle: fsPromises.FileHandle | undefined;
    try {
      handle = await fsPromises.open(this.filePath, "wx", 0o600);
      await handle.writeFile("{}\n", { encoding: "utf8" });
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    } finally {
      await handle?.close();
    }
    await fsPromises.chmod(this.filePath, 0o600);
  }

  private async readData(): Promise<CredentialFile> {
    try {
      const content = await fsPromises.readFile(this.filePath, "utf8");
      return parseCredentialFile(content, this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async writeData(data: CredentialFile) {
    const directory = path.dirname(this.filePath);
    const tempPath = path.join(directory, `.${path.basename(this.filePath)}.tmp-${process.pid}-${Date.now()}`);
    let handle: fsPromises.FileHandle | undefined;
    try {
      handle = await fsPromises.open(tempPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fsPromises.rename(tempPath, this.filePath);
      await fsPromises.chmod(this.filePath, 0o600);
    } catch (error) {
      if (handle) {
        await handle.close();
      }
      await fsPromises.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async withLock<T>(operation: (data: CredentialFile) => Promise<T>) {
    await this.ensureFile();
    const release = await lockfile.lock(this.filePath, {
      realpath: false,
      stale: 30_000,
      retries: {
        retries: 8,
        factor: 1.8,
        minTimeout: 50,
        maxTimeout: 2_000,
        randomize: true,
      },
    });
    try {
      return await operation(await this.readData());
    } finally {
      await release();
    }
  }

  async read(providerId: string) {
    return (await this.readData())[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const data = await this.readData();
    return Object.entries(data).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(providerId: string, update: (current: Credential | undefined) => Promise<Credential | undefined>) {
    return this.withLock(async (data) => {
      const current = data[providerId];
      const next = await update(current);
      if (next === undefined) {
        return current;
      }
      await this.writeData({ ...data, [providerId]: next });
      return next;
    });
  }

  async delete(providerId: string) {
    await this.withLock(async (data) => {
      if (!(providerId in data)) {
        return;
      }
      const next = { ...data };
      delete next[providerId];
      await this.writeData(next);
    });
  }
}
