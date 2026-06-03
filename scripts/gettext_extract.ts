#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";
import { glob } from "glob";
import path from "node:path";
import { GettextConfig } from "../src/typeDefs.js";
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { extractAndCreatePOT } from "./extract.js";
import { execShellCommand, colorize } from "./utils.js";

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

const getFiles = async (config: GettextConfig) => {
  const allFiles = await Promise.all(
    config.input?.include.map((pattern) => {
      const searchPath = path.join(config.input.path, pattern).replace(/\\/g, "/");
      console.info(`Searching: ${colorize("blue", searchPath)}`);
      return glob(searchPath);
    }),
  );
  const excludeFiles = await Promise.all(
    config.input.exclude.map((pattern) => {
      const searchPath = path.join(config.input.path, pattern).replace(/\\/g, "/");
      console.info(`Excluding: ${colorize("blue", searchPath)}`);
      return glob(searchPath);
    }),
  );
  const filesFlat = allFiles.reduce((prev, curr) => [...prev, ...curr], [] as string[]);
  const excludeFlat = excludeFiles.reduce((prev, curr) => [...prev, ...curr], [] as string[]);
  excludeFlat.forEach((file) => {
    const index = filesFlat.indexOf(file);
    if (index !== -1) {
      filesFlat.splice(index, 1);
    }
  });
  return filesFlat;
};

(async () => {
  const config = await loadConfig(options);
  console.info(`Input directory: ${colorize("blue", config.input.path)}`);
  console.info(`Output directory: ${colorize("blue", config.output.path)}`);
  console.info(`Output POT file: ${colorize("blue", config.output.potPath)}`);
  console.info(`Locales: ${colorize("blue", config.output.locales)}`);
  console.info(`Locations: ${colorize("blue", config.output.locations)}`);
  console.info();

  const files = await getFiles(config);
  console.info();
  files.forEach((f) => console.info(colorize("grey", f)));
  console.info();
  await extractAndCreatePOT(files, config.output.potPath, config);

  for (const loc of config.output.locales) {
    const poDir = config.output.flat ? config.output.path : path.join(config.output.path, loc);
    const poFile = config.output.flat ? path.join(poDir, `${loc}.po`) : path.join(poDir, `app.po`);
    const noLocation = config.output.locations ? "" : "--no-location";
    const noFuzzyMatching = config.output.fuzzyMatching ? "" : "--no-fuzzy-matching";

    mkdirSync(poDir, { recursive: true });
    const isFile = existsSync(poFile) && lstatSync(poFile).isFile();
    if (isFile) {
      await execShellCommand(
        `msgmerge --lang=${loc} --update ${poFile} ${config.output.potPath} ${noFuzzyMatching} ${noLocation} --backup=off`,
      );
      console.info(`${colorize("green", "Merged")}: ${colorize("blue", poFile)}`);
    } else {
      // https://www.gnu.org/software/gettext/manual/html_node/msginit-Invocation.html
      // msginit will set Plural-Forms header if the locale is in the
      // [embedded table](https://github.com/dd32/gettext/blob/master/gettext-tools/src/plural-table.c#L27)
      // otherwise it will read [$GETTEXTCLDRDIR/common/supplemental/plurals.xml](https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/plurals.xml)
      // so execShellCommand should pass the env(GETTEXTCLDRDIR) to child process
      await execShellCommand(
        `msginit --no-translator --locale=${loc} --input=${config.output.potPath} --output-file=${poFile}`,
      );
      chmodSync(poFile, 0o666);
      await execShellCommand(`msgattrib --no-wrap --no-obsolete ${noLocation} -o ${poFile} ${poFile}`);
      console.info(`${colorize("green", "Created")}: ${colorize("blue", poFile)}`);
    }
  }
  if (config.output.linguas === true) {
    const linguasPath = path.join(config.output.path, "LINGUAS");
    writeFileSync(linguasPath, config.output.locales.join(" "));
    console.info();
    console.info(`${colorize("green", "Created")}: ${colorize("blue", linguasPath)}`);
  }
})();
