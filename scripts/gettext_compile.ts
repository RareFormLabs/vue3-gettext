#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";
import { compileTranslations } from "./compile.js";
import { loadConfig } from "./config.js";
import { colorize } from "./utils.js";

const optionDefinitions: OptionDefinition[] = [{ name: "config", alias: "c", type: String }];
let options;
try {
  options = commandLineArgs(optionDefinitions) as {
    config?: string;
  };
} catch (e) {
  console.error(e);
  process.exit(1);
}

(async () => {
  const config = await loadConfig(options);
  console.info(`Language directory: ${colorize("blue", config.output.path)}`);
  console.info(`Locales: ${colorize("blue", config.output.locales.join(", "))}`);
  console.info();
  const { localeCount, files } = await compileTranslations(config);
  console.info(`${colorize("green", "Compiled json")}: ${colorize("grey", `${localeCount} locale(s)`)}`);
  console.info();
  for (const file of files) {
    console.info(`${colorize("green", file.changed ? "Created" : "Unchanged")}: ${colorize("blue", file.path)}`);
  }
})();
