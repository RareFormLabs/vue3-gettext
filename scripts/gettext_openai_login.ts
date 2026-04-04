#!/usr/bin/env node

import chalk from "chalk";
import commandLineArgs, { OptionDefinition } from "command-line-args";
import { loginAndSaveOpenAIOAuth } from "./openai-oauth.js";
import { loadConfig } from "./config.js";

const optionDefinitions: OptionDefinition[] = [
  { name: "config", alias: "c", type: String },
  { name: "credentials-path", type: String },
  { name: "originator", type: String },
];

let options;
try {
  options = commandLineArgs(optionDefinitions, { camelCase: true }) as {
    config?: string;
    credentialsPath?: string;
    originator?: string;
  };
} catch (e) {
  console.error(e);
  process.exit(1);
}

void (async () => {
  try {
    const config = await loadConfig(options);
    const openaiConfig = config.translate?.openai;
    const credentialsPath = await loginAndSaveOpenAIOAuth({
      credentialsPath: options.credentialsPath ?? openaiConfig?.credentialsPath,
      originator: options.originator ?? openaiConfig?.originator,
    });

    console.info(`${chalk.green("Saved OpenAI OAuth credentials")}: ${chalk.blueBright(credentialsPath)}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
