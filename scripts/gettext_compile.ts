#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { compilePoFiles } from "./compile.js";
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
  const localesPaths = config.output.locales.map((loc) =>
    config.output.flat ? path.join(config.output.path, `${loc}.po`) : path.join(config.output.path, `${loc}/app.po`),
  );

  await fsPromises.mkdir(config.output.path, { recursive: true });
  const jsonRes = await compilePoFiles(localesPaths);
  const localeCount = Object.keys(jsonRes).length;
  console.info(`${colorize("green", "Compiled json")}: ${colorize("grey", `${localeCount} locale(s)`)}`);
  console.info();
  if (config.output.splitJson) {
    await Promise.all(
      config.output.locales.map(async (locale) => {
        const outputPath = path.join(config.output.jsonPath, `${locale}.json`);
        await fsPromises.writeFile(
          outputPath,
          JSON.stringify({
            [locale]: jsonRes[locale],
          }),
        );
        console.info(`${colorize("green", "Created")}: ${colorize("blue", outputPath)}`);
      }),
    );
  } else {
    const outputPath = config.output.jsonPath;
    await fsPromises.writeFile(outputPath, JSON.stringify(jsonRes));
    console.info(`${colorize("green", "Created")}: ${colorize("blue", outputPath)}`);
  }
})();
