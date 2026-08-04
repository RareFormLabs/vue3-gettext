#!/usr/bin/env node

import commandLineArgs, { type OptionDefinition } from "command-line-args";
import { runTranslationCommand, type TranslationCommandOptions } from "./translation-command.js";

const optionDefinitions: OptionDefinition[] = [
  { name: "config", alias: "c", type: String },
  { name: "env-file", type: String },
  { name: "credentials", type: String },
  { name: "locale", alias: "l", type: String, multiple: true },
  { name: "provider", type: String },
  { name: "model", type: String },
  { name: "base-url", type: String },
  { name: "include-translated", type: Boolean },
  { name: "dry-run", type: Boolean },
];

const parseOptions = () => commandLineArgs(optionDefinitions, { camelCase: true }) as TranslationCommandOptions;

Promise.resolve()
  .then(parseOptions)
  .then(runTranslationCommand)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
