import fsPromises from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";

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
const OPENAI_AUTH_BASE_URL = "https://auth.openai.com";
const OPENAI_AUTHORIZE_URL = `${OPENAI_AUTH_BASE_URL}/oauth/authorize`;
const OPENAI_TOKEN_URL = `${OPENAI_AUTH_BASE_URL}/oauth/token`;
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_SCOPE = "openid profile email offline_access";

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

const toOAuthCredentials = (access: string, refresh: string, expiresInSeconds: number): OAuthCredentials => {
  const accountId = decodeJwtAccountId(access);
  return {
    access,
    refresh,
    expires: Date.now() + expiresInSeconds * 1000,
    ...(accountId ? { accountId } : {}),
  };
};

const parseAuthorizationInput = (input: string): { code?: string; state?: string } => {
  const value = input.trim();
  if (!value) {
    return {};
  }
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") || undefined,
      state: url.searchParams.get("state") || undefined,
    };
  } catch {
    // Not a URL. Fall back to looser formats below.
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") || undefined,
      state: params.get("state") || undefined,
    };
  }
  return { code: value };
};

const readOpenAITokenResponse = async (response: Response, operation: string): Promise<OAuthCredentials> => {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI Codex token ${operation} failed (${response.status}): ${text || response.statusText}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string" ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error(`OpenAI Codex token ${operation} response missing fields: ${JSON.stringify(json)}`);
  }

  return toOAuthCredentials(json.access_token, json.refresh_token, json.expires_in);
};

const exchangeAuthorizationCode = async (
  code: string,
  verifier: string,
  originator?: string,
): Promise<OAuthCredentials> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: OPENAI_REDIRECT_URI,
  });
  if (originator) {
    body.set("originator", originator);
  }

  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  return readOpenAITokenResponse(response, "exchange");
};

const refreshOpenAICodexToken = async (credentials: OAuthCredentials): Promise<OAuthCredentials> => {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh,
      client_id: OPENAI_CLIENT_ID,
    }),
  });

  return readOpenAITokenResponse(response, "refresh");
};

const createPkcePair = async () => {
  const verifier = randomBytes(32).toString("base64url");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  return { verifier, challenge };
};

const createAuthorizationUrl = async (originator?: string) => {
  const { verifier, challenge } = await createPkcePair();
  const state = randomBytes(16).toString("hex");
  const url = new URL(OPENAI_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
  url.searchParams.set("scope", OPENAI_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", originator || "pi");
  return { verifier, state, url: url.toString() };
};

const startLocalOAuthServer = async (expectedState: string) =>
  await new Promise<{
    close: () => void;
    cancelWait: () => void;
    waitForCode: () => Promise<{ code: string } | null>;
  }>((resolve) => {
    let settled = false;
    let settleWait: ((value: { code: string } | null) => void) | undefined;

    const waitForCode = new Promise<{ code: string } | null>((resolveWait) => {
      settleWait = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolveWait(value);
      };
    });

    const server: Server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || "", "http://localhost");
        if (requestUrl.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end("Callback route not found.");
          return;
        }
        if (requestUrl.searchParams.get("state") !== expectedState) {
          res.statusCode = 400;
          res.end("State mismatch.");
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          res.statusCode = 400;
          res.end("Missing authorization code.");
          return;
        }
        res.statusCode = 200;
        res.end("OpenAI authentication completed. You can close this window.");
        settleWait?.({ code });
      } catch {
        res.statusCode = 500;
        res.end("Internal error while processing OAuth callback.");
      }
    });

    server
      .listen(1455, "127.0.0.1", () => {
        resolve({
          close: () => server.close(),
          cancelWait: () => settleWait?.(null),
          waitForCode: async () => await waitForCode,
        });
      })
      .on("error", () => {
        settleWait?.(null);
        resolve({
          close: () => {
            try {
              server.close();
            } catch {
              // ignore close errors on failed startup
            }
          },
          cancelWait: () => undefined,
          waitForCode: async () => null,
        });
      });
  });

const loginOpenAICodex = async (config: {
  originator?: string;
  onAuth: (details: { url: string; instructions?: string }) => void;
  onPrompt: (details: { message: string; signal?: AbortSignal }) => Promise<string>;
}): Promise<OAuthCredentials> => {
  const { verifier, state, url } = await createAuthorizationUrl(config.originator);
  const server = await startLocalOAuthServer(state);
  const manualAbort = new AbortController();
  let manualInput: string | undefined;
  let manualError: Error | undefined;

  config.onAuth({
    url,
    instructions: "A browser window should open. Complete login to finish.",
  });

  const manualPromise = config
    .onPrompt({
      message: "Complete login in your browser, or paste the authorization code / redirect URL here:",
      signal: manualAbort.signal,
    })
    .then((value) => {
      manualInput = value;
      server.cancelWait();
    })
    .catch((error: unknown) => {
      if (manualAbort.signal.aborted) {
        return;
      }
      manualError = error instanceof Error ? error : new Error(String(error));
      server.cancelWait();
    });

  try {
    const result = await server.waitForCode();
    manualAbort.abort();
    await manualPromise;

    if (manualError) {
      throw manualError;
    }

    if (result?.code) {
      return await exchangeAuthorizationCode(result.code, verifier, config.originator);
    }

    const parsed = parseAuthorizationInput(manualInput || "");
    if (parsed.state && parsed.state !== state) {
      throw new Error("State mismatch.");
    }
    if (!parsed.code) {
      throw new Error("Missing authorization code.");
    }

    return await exchangeAuthorizationCode(parsed.code, verifier, config.originator);
  } finally {
    server.close();
  }
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
      if (parsed.provider && parsed.provider !== PROVIDER_ID) {
        throw new Error(
          `OAuth credential wrapper in ${credentialsPath} is for provider ${String(parsed.provider)}, expected ${PROVIDER_ID}.`,
        );
      }
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
  const dir = path.dirname(credentialsPath);
  await fsPromises.mkdir(dir, { recursive: true, mode: 0o700 });

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

  const tempPath = path.join(dir, `.${path.basename(credentialsPath)}.tmp-${process.pid}-${Date.now()}`);
  let handle: fsPromises.FileHandle | undefined;
  try {
    handle = await fsPromises.open(tempPath, "w", 0o600);
    await handle.writeFile(`${JSON.stringify(content, null, 2)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsPromises.rename(tempPath, credentialsPath);
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    await fsPromises.unlink(tempPath).catch(() => undefined);
    throw error;
  }
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

    const newCredentials =
      Date.now() >= loaded.credentials.expires ? await refreshOpenAICodexToken(loaded.credentials) : loaded.credentials;
    const accountId =
      (newCredentials.accountId as string | undefined) || envAccountId || decodeJwtAccountId(newCredentials.access);
    if (!accountId) {
      throw new Error(`Missing OpenAI OAuth account ID. Set ${accountIdEnvVar} or provide a token that contains it.`);
    }
    return {
      accessToken: newCredentials.access,
      accountId,
      refreshed: newCredentials.access !== loaded.credentials.access,
      source: "env",
    };
  }

  const fileCredentials = await loadCredentialsFromFile(credentialsPath);
  if (!fileCredentials) {
    throw new Error(
      `OpenAI OAuth credentials not found. Set ${accessTokenEnvVar}/${refreshTokenEnvVar} or create ${credentialsPath}.`,
    );
  }

  const newCredentials =
    Date.now() >= fileCredentials.credentials.expires
      ? await refreshOpenAICodexToken(fileCredentials.credentials)
      : fileCredentials.credentials;

  const accountId =
    (newCredentials.accountId as string | undefined) ||
    (fileCredentials.credentials.accountId as string | undefined) ||
    decodeJwtAccountId(newCredentials.access);
  if (!accountId) {
    throw new Error(
      `OAuth credentials in ${credentialsPath} are missing accountId and it could not be derived from the access token.`,
    );
  }

  if (persistRefresh && newCredentials.access !== fileCredentials.credentials.access) {
    await saveCredentialsToFile(credentialsPath, { ...newCredentials, accountId }, fileCredentials.format);
  }

  return {
    accessToken: newCredentials.access,
    accountId,
    credentialsPath,
    refreshed: newCredentials.access !== fileCredentials.credentials.access,
    source: "file",
  };
};

export const loginAndSaveOpenAIOAuth = async (config: OpenAIOAuthConfig = {}) => {
  const credentialsPath = expandHome(config.credentialsPath || DEFAULT_CREDENTIALS_PATH);
  const existingCredentials = await loadCredentialsFromFile(credentialsPath);
  const credentials = await loginOpenAICodex({
    originator: config.originator,
    onAuth: ({ url, instructions }) => {
      console.info(instructions || "Open this URL to authenticate with ChatGPT/Codex:");
      console.info(url);
    },
    onPrompt: async ({ message, signal }) => {
      process.stdout.write(`${message} `);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      return await new Promise<string>((resolve) => {
        const cleanup = () => {
          process.stdin.removeListener("data", onData);
          signal?.removeEventListener("abort", onAbort);
          process.stdin.pause();
        };

        const onData = (data: string | Buffer) => {
          cleanup();
          resolve(String(data).trim());
        };

        const onAbort = () => {
          cleanup();
          resolve("");
        };

        process.stdin.once("data", onData);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  });

  await saveCredentialsToFile(credentialsPath, credentials, existingCredentials?.format || "plain");
  return credentialsPath;
};
