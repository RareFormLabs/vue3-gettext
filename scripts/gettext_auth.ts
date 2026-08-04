#!/usr/bin/env node

import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import commandLineArgs, { type OptionDefinition } from "command-line-args";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config.js";
import { FileCredentialStore } from "./credential-store.js";
import { loadLocalEnvironment, resolveCredentialsPath, resolveModelSelection } from "./environment.js";
import { processSecretInputChunk } from "./secret-input.js";

const optionDefinitions: OptionDefinition[] = [
  { name: "positionals", defaultOption: true, type: String, multiple: true },
  { name: "config", alias: "c", type: String },
  { name: "env-file", type: String },
  { name: "credentials", type: String },
  { name: "type", type: String },
];

type CliOptions = {
  positionals?: string[];
  config?: string;
  envFile?: string;
  credentials?: string;
  type?: string;
};

const parseOptions = () => commandLineArgs(optionDefinitions, { camelCase: true }) as CliOptions;

const promptHidden = (message: string, signal?: AbortSignal) => {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    const rl = createInterface({ input: stdin, output: stdout });
    return rl.question(`${message}: `, { signal }).finally(() => rl.close());
  }

  return new Promise<string>((resolve, reject) => {
    let value = "";
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      stdin.off("data", onData);
      signal?.removeEventListener("abort", onAbort);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onAbort = () => finish(signal?.reason || new Error("Prompt aborted."));
    const onData = (chunk: Buffer) => {
      const result = processSecretInputChunk(value, chunk.toString("utf8"));
      value = result.value;
      stdout.write(result.output);
      if (result.action === "cancel") {
        finish(new Error("Login cancelled."));
        return;
      }
      if (result.action === "submit") {
        finish();
      }
    };

    stdout.write(`${message}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const answerPrompt = async (prompt: AuthPrompt) => {
  if (prompt.type === "secret") {
    return promptHidden(prompt.message, prompt.signal);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (prompt.type === "select") {
      console.info(prompt.message);
      prompt.options.forEach((option, index) => console.info(`  ${index + 1}. ${option.label}`));
      const answer = await rl.question(`Enter number (1-${prompt.options.length}): `, { signal: prompt.signal });
      const selected = prompt.options[Number.parseInt(answer, 10) - 1];
      if (!selected) {
        throw new Error("Invalid selection.");
      }
      return selected.id;
    }
    return rl.question(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `, {
      signal: prompt.signal,
    });
  } finally {
    rl.close();
  }
};

const notify = (event: AuthEvent) => {
  switch (event.type) {
    case "auth_url":
      console.info(`Open this URL in your browser:\n${event.url}`);
      if (event.instructions) console.info(event.instructions);
      break;
    case "device_code":
      console.info(`Open ${event.verificationUri} and enter code ${event.userCode}.`);
      break;
    case "info":
    case "progress":
      console.info(event.message);
      break;
  }
};

const normalizeAuthType = (value: string | undefined): AuthType | undefined => {
  if (!value) return undefined;
  if (value === "api-key" || value === "api_key") return "api_key";
  if (value === "oauth") return "oauth";
  throw new Error('--type must be "api-key" or "oauth".');
};

const selectAuthType = async (models: ReturnType<typeof builtinModels>, providerId: string, requested?: string) => {
  const provider = models.getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  const supported = (["api_key", "oauth"] as const).filter((type) => {
    const method = type === "api_key" ? provider.auth.apiKey : provider.auth.oauth;
    return Boolean(method?.login);
  });
  const normalized = normalizeAuthType(requested);
  if (normalized) {
    if (!supported.includes(normalized)) {
      throw new Error(
        `${provider.name} does not support interactive ${normalized === "api_key" ? "API-key" : "OAuth"} login.`,
      );
    }
    return normalized;
  }
  if (supported.length === 1) {
    return supported[0];
  }
  if (supported.length === 0) {
    throw new Error(`${provider.name} has no interactive login flow; configure its ambient environment credentials.`);
  }
  if (!stdin.isTTY) {
    throw new Error("This provider supports multiple auth types. Pass --type api-key or --type oauth.");
  }

  const selected = await answerPrompt({
    type: "select",
    message: `Choose authentication for ${provider.name}`,
    options: [
      { id: "api_key", label: "API key" },
      { id: "oauth", label: "OAuth" },
    ],
  });
  return selected as AuthType;
};

const run = async (options: CliOptions) => {
  const [command, positionalProvider, ...extra] = options.positionals || [];
  if (!command || extra.length > 0 || !["login", "logout", "list"].includes(command)) {
    throw new Error(
      "Usage: vue-gettext-auth <login|logout|list> [provider] [--type api-key|oauth] [--config path] [--env-file path] [--credentials path]",
    );
  }
  if (command === "list" && positionalProvider) {
    throw new Error("Usage: vue-gettext-auth list [--config path] [--env-file path] [--credentials path]");
  }
  if (command !== "login" && options.type) {
    throw new Error("--type is only valid with vue-gettext-auth login.");
  }

  const shellProvider = process.env.VUE_GETTEXT_PROVIDER;
  const shellModel = process.env.VUE_GETTEXT_MODEL;
  const config = await loadConfig(options);
  loadLocalEnvironment({ configPath: config.configPath, envFile: options.envFile });
  const credentials = new FileCredentialStore(resolveCredentialsPath(options.credentials));

  if (command === "list") {
    const entries = await credentials.list();
    if (entries.length === 0) {
      console.info("No saved vue3-gettext credentials.");
      return;
    }
    entries.forEach((entry) => console.info(`${entry.providerId}\t${entry.type}`));
    return;
  }

  let providerId = positionalProvider;
  if (!providerId) {
    try {
      providerId = resolveModelSelection({
        shellProvider,
        shellModel,
        environmentProvider: shellProvider || shellModel ? undefined : process.env.VUE_GETTEXT_PROVIDER,
        environmentModel: shellProvider || shellModel ? undefined : process.env.VUE_GETTEXT_MODEL,
        configModel: config.translate.model,
      }).provider;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No translation provider and model are configured.")) {
        throw new Error(
          "No authentication provider is configured. Pass [provider], set VUE_GETTEXT_PROVIDER and VUE_GETTEXT_MODEL together, or configure translate.model.",
        );
      }
      throw error;
    }
  }
  const models = builtinModels({ credentials });

  if (command === "logout") {
    await models.logout(providerId);
    console.info(`Removed saved credentials for ${providerId}.`);
    return;
  }

  const type = await selectAuthType(models, providerId, options.type);
  await models.login(providerId, type, { prompt: answerPrompt, notify });
  console.info(`Saved ${type === "api_key" ? "API-key" : "OAuth"} credentials for ${providerId}.`);
};

Promise.resolve()
  .then(parseOptions)
  .then(run)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
