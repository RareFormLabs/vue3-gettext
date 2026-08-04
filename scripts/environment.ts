import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import type { TranslationModelConfig } from "../src/typeDefs.js";

export const DEFAULT_CREDENTIALS_PATH = path.join(os.homedir(), ".vue-gettext", "auth.json");
export const LOCAL_ENV_FILENAME = ".env.gettext";

export type ModelSelectionLayer = "cli" | "environment" | "local environment file" | "project config";

export type ModelSelection = TranslationModelConfig & {
  source: ModelSelectionLayer;
};

export type ModelSelectionOptions = {
  cliProvider?: string;
  cliModel?: string;
  cliBaseUrl?: string;
  shellProvider?: string;
  shellModel?: string;
  shellBaseUrl?: string;
  environmentProvider?: string;
  environmentModel?: string;
  environmentBaseUrl?: string;
  configModel?: TranslationModelConfig;
};

export type LoadLocalEnvironmentOptions = {
  configPath?: string;
  envFile?: string;
};

const normalizeValue = (value: string | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const resolvePair = (
  providerValue: string | undefined,
  modelValue: string | undefined,
  source: ModelSelectionLayer,
  baseUrl?: string,
): ModelSelection | undefined => {
  const provider = normalizeValue(providerValue);
  const id = normalizeValue(modelValue);
  if (!provider && !id) {
    return undefined;
  }
  if (!provider || !id) {
    throw new Error(
      `${source} model selection is incomplete. Set both provider and model together; values are never mixed across configuration layers.`,
    );
  }
  return { provider, id, baseUrl: normalizeValue(baseUrl), source };
};

export const resolveModelSelection = (options: ModelSelectionOptions): ModelSelection => {
  const cli = resolvePair(options.cliProvider, options.cliModel, "cli", options.cliBaseUrl);
  if (cli) {
    return cli;
  }

  const shell = resolvePair(options.shellProvider, options.shellModel, "environment", options.shellBaseUrl);
  if (shell) {
    return { ...shell, baseUrl: normalizeValue(options.cliBaseUrl) || shell.baseUrl };
  }

  const localEnvironment = resolvePair(
    options.environmentProvider,
    options.environmentModel,
    "local environment file",
    options.environmentBaseUrl,
  );
  if (localEnvironment) {
    return { ...localEnvironment, baseUrl: normalizeValue(options.cliBaseUrl) || localEnvironment.baseUrl };
  }

  if (options.configModel) {
    return {
      ...options.configModel,
      baseUrl: normalizeValue(options.cliBaseUrl) || options.configModel.baseUrl,
      source: "project config",
    };
  }

  throw new Error(
    [
      "No translation provider and model are configured.",
      "Pass --provider and --model together, set VUE_GETTEXT_PROVIDER and VUE_GETTEXT_MODEL in your shell or .env.gettext,",
      "or add translate.model: { provider, id } to gettext.config.js.",
    ].join(" "),
  );
};

export const expandHomePath = (value: string) => {
  if (value === "~") {
    return os.homedir();
  }
  if (/^~[\\/]/.test(value)) {
    return path.join(os.homedir(), ...value.slice(2).split(/[\\/]+/));
  }
  return value;
};

const configDirectory = (configPath?: string) => (configPath ? path.dirname(path.resolve(configPath)) : process.cwd());

export const resolveLocalEnvPath = ({ configPath, envFile }: LoadLocalEnvironmentOptions) => {
  if (envFile) {
    const expanded = expandHomePath(envFile);
    return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
  }
  return path.join(configDirectory(configPath), LOCAL_ENV_FILENAME);
};

const warnIfTracked = (envPath: string, configPath?: string) => {
  const cwd = configDirectory(configPath);
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", envPath], { cwd, stdio: "ignore" });
    console.warn(
      `Security warning: ${envPath} is tracked by Git. Remove it from version control and add ${LOCAL_ENV_FILENAME} to .gitignore.`,
    );
  } catch {
    // Not in a Git checkout or not tracked.
  }
};

export const loadLocalEnvironment = (options: LoadLocalEnvironmentOptions) => {
  const envPath = resolveLocalEnvPath(options);
  if (!existsSync(envPath)) {
    if (options.envFile) {
      throw new Error(`Environment file not found: ${envPath}`);
    }
    return undefined;
  }

  loadEnvFile(envPath);
  warnIfTracked(envPath, options.configPath);
  return envPath;
};

export const resolveCredentialsPath = (cliPath?: string) => {
  const selected = normalizeValue(cliPath) || normalizeValue(process.env.VUE_GETTEXT_CREDENTIALS_PATH);
  if (!selected) {
    return DEFAULT_CREDENTIALS_PATH;
  }
  const expanded = expandHomePath(selected);
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
};
