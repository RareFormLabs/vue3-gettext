import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getOAuthApiKey, loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";

type OpenAIOAuthConfig = {
  credentialsPath?: string;
  accessTokenEnvVar?: string;
  refreshTokenEnvVar?: string;
  accountIdEnvVar?: string;
  persistRefresh?: boolean;
  originator?: string;
};

type LoadedCredentials = {
  credentials: OAuthCredentials;
  source: "env" | "file";
  path?: string;
  format?: "plain" | "provider-map" | "credentials-wrapper";
};

const DEFAULT_CREDENTIALS_PATH = path.join(os.homedir(), ".vue-gettext", "openai-codex-oauth.json");
const PROVIDER_ID = "openai-codex";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

const expandHome = (inputPath: string) =>
  inputPath.startsWith("~/") ? path.join(os.homedir(), inputPath.slice(2)) : inputPath;

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return undefined;
    }
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const decodeJwtAccountId = (token: string): string | undefined => {
  const decoded = decodeJwtPayload(token) as { [JWT_CLAIM_PATH]?: { chatgpt_account_id?: string } } | undefined;
  return decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
};

const decodeJwtExpiry = (token: string): number | undefined => {
  const decoded = decodeJwtPayload(token) as { exp?: number } | undefined;
  return typeof decoded?.exp === "number" ? decoded.exp * 1000 : undefined;
};

const normalizeCredentials = (value: unknown): OAuthCredentials | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<OAuthCredentials>;
  if (
    typeof candidate.access !== "string" ||
    typeof candidate.refresh !== "string" ||
    typeof candidate.expires !== "number"
  ) {
    return undefined;
  }
  return candidate as OAuthCredentials;
};

const loadCredentialsFromFile = async (credentialsPath: string): Promise<LoadedCredentials | null> => {
  try {
    const raw = await fsPromises.readFile(credentialsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const plain = normalizeCredentials(parsed);
    if (plain) {
      return { credentials: plain, source: "file", path: credentialsPath, format: "plain" };
    }

    const providerMap = normalizeCredentials(parsed[PROVIDER_ID]);
    if (providerMap) {
      return { credentials: providerMap, source: "file", path: credentialsPath, format: "provider-map" };
    }

    const wrapped = normalizeCredentials(parsed.credentials);
    if (wrapped) {
      return { credentials: wrapped, source: "file", path: credentialsPath, format: "credentials-wrapper" };
    }

    throw new Error(`Unsupported OAuth credential file shape in ${credentialsPath}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const saveCredentialsToFile = async (
  credentialsPath: string,
  credentials: OAuthCredentials,
  format: LoadedCredentials["format"] = "plain",
) => {
  await fsPromises.mkdir(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });

  let content: Record<string, unknown> | OAuthCredentials;
  if (format === "provider-map") {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fsPromises.readFile(credentialsPath, "utf8")) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    content = { ...existing, [PROVIDER_ID]: credentials };
  } else if (format === "credentials-wrapper") {
    content = { provider: PROVIDER_ID, credentials };
  } else {
    content = credentials;
  }

  await fsPromises.writeFile(credentialsPath, `${JSON.stringify(content, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
};

export type ResolvedOpenAIOAuth = {
  accessToken: string;
  accountId: string;
  credentialsPath?: string;
  refreshed: boolean;
  source: "env" | "file";
};

export const resolveOpenAIOAuth = async (config: OpenAIOAuthConfig = {}): Promise<ResolvedOpenAIOAuth> => {
  const accessTokenEnvVar = config.accessTokenEnvVar || "OPENAI_OAUTH_ACCESS_TOKEN";
  const refreshTokenEnvVar = config.refreshTokenEnvVar || "OPENAI_OAUTH_REFRESH_TOKEN";
  const accountIdEnvVar = config.accountIdEnvVar || "OPENAI_OAUTH_ACCOUNT_ID";
  const credentialsPath = expandHome(config.credentialsPath || DEFAULT_CREDENTIALS_PATH);
  const persistRefresh = config.persistRefresh !== false;

  const envAccessToken = process.env[accessTokenEnvVar];
  const envRefreshToken = process.env[refreshTokenEnvVar];
  const envAccountId =
    process.env[accountIdEnvVar] || (envAccessToken ? decodeJwtAccountId(envAccessToken) : undefined);

  if (envAccessToken && envRefreshToken) {
    const expires =
      Number.parseInt(process.env.OPENAI_OAUTH_EXPIRES_AT || "0", 10) || decodeJwtExpiry(envAccessToken) || 0;
    const loaded: LoadedCredentials = {
      source: "env",
      credentials: {
        access: envAccessToken,
        refresh: envRefreshToken,
        expires,
        ...(envAccountId ? { accountId: envAccountId } : {}),
      },
    };

    const resolved = await getOAuthApiKey(PROVIDER_ID, { [PROVIDER_ID]: loaded.credentials });
    if (!resolved) {
      throw new Error("Unable to resolve OpenAI OAuth credentials from environment variables.");
    }
    const accountId =
      (resolved.newCredentials.accountId as string | undefined) || envAccountId || decodeJwtAccountId(resolved.apiKey);
    if (!accountId) {
      throw new Error(`Missing OpenAI OAuth account ID. Set ${accountIdEnvVar} or provide a token that contains it.`);
    }
    return {
      accessToken: resolved.apiKey,
      accountId,
      refreshed: resolved.newCredentials.access !== loaded.credentials.access,
      source: "env",
    };
  }

  const fileCredentials = await loadCredentialsFromFile(credentialsPath);
  if (!fileCredentials) {
    throw new Error(
      `OpenAI OAuth credentials not found. Set ${accessTokenEnvVar}/${refreshTokenEnvVar} or create ${credentialsPath}.`,
    );
  }

  const resolved = await getOAuthApiKey(PROVIDER_ID, { [PROVIDER_ID]: fileCredentials.credentials });
  if (!resolved) {
    throw new Error(`Unable to resolve OpenAI OAuth credentials from ${credentialsPath}.`);
  }

  const accountId =
    (resolved.newCredentials.accountId as string | undefined) ||
    (fileCredentials.credentials.accountId as string | undefined) ||
    decodeJwtAccountId(resolved.apiKey);
  if (!accountId) {
    throw new Error(
      `OAuth credentials in ${credentialsPath} are missing accountId and it could not be derived from the access token.`,
    );
  }

  if (persistRefresh && resolved.newCredentials.access !== fileCredentials.credentials.access) {
    await saveCredentialsToFile(credentialsPath, { ...resolved.newCredentials, accountId }, fileCredentials.format);
  }

  return {
    accessToken: resolved.apiKey,
    accountId,
    credentialsPath,
    refreshed: resolved.newCredentials.access !== fileCredentials.credentials.access,
    source: "file",
  };
};

export const loginAndSaveOpenAIOAuth = async (config: OpenAIOAuthConfig = {}) => {
  const credentialsPath = expandHome(config.credentialsPath || DEFAULT_CREDENTIALS_PATH);
  const credentials = await loginOpenAICodex({
    originator: config.originator,
    onAuth: ({ url, instructions }) => {
      console.info(instructions || "Open this URL to authenticate with ChatGPT/Codex:");
      console.info(url);
    },
    onPrompt: async ({ message }) => {
      process.stdout.write(`${message} `);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      return await new Promise<string>((resolve) => {
        process.stdin.once("data", (data) => resolve(String(data).trim()));
      });
    },
  });

  await saveCredentialsToFile(credentialsPath, credentials, "plain");
  return credentialsPath;
};
