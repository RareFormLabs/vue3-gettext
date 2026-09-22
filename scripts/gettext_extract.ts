#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";
import { glob } from "glob";
import path from "node:path";
import { GettextConfig } from "../src/typeDefs.js";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { extractAndCreatePOT } from "./extract.js";
import { colorize, execShellCommand, ShellCommandError } from "./utils.js";
import PO from "pofile";

const optionDefinitions: OptionDefinition[] = [{ name: "config", alias: "c", type: String }];
let options: {
  config?: string;
};
try {
  options = commandLineArgs(optionDefinitions) as typeof options;
} catch (e) {
  console.error(e);
  process.exit(1);
}

const getFiles = async (config: GettextConfig) => {
  const allFiles = await Promise.all(
    config.input?.include.map((pattern) => {
      const searchPath = path.join(config.input.path, pattern).replace(/\\/g, "/");
      console.info(`Searching: ${colorize("blue", searchPath)}`);
      return glob(searchPath, { nodir: true });
    }),
  );
  const excludeFiles = await Promise.all(
    config.input.exclude.map((pattern) => {
      const searchPath = path.join(config.input.path, pattern).replace(/\\/g, "/");
      console.info(`Excluding: ${colorize("blue", searchPath)}`);
      return glob(searchPath, { nodir: true });
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

const areTranslationsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((translation, index) => translation === right[index]);

const mergeUniqueValues = (left: string[], right: string[]) => [...new Set([...left, ...right])];

const deduplicateIdenticalMessages = (poFile: string) => {
  const po = PO.parse(readFileSync(poFile, "utf-8"));
  const groups = new Map<string, InstanceType<typeof PO.Item>[]>();

  po.items.forEach((item) => {
    const key = JSON.stringify([item.msgctxt ?? null, item.msgid, item.msgid_plural ?? null, item.obsolete]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  });

  if (![...groups.values()].some((group) => group.length > 1)) {
    return 0;
  }

  let removedCount = 0;
  po.items = [...groups.values()].flatMap((group) => {
    const [first, ...duplicates] = group;
    if (!first || duplicates.length === 0) {
      return group;
    }
    // Conflicting translations need a human decision. Keep that group intact and let msgmerge
    // report it, while still cleaning up independent groups that are safe to deduplicate.
    if (duplicates.some((item) => !areTranslationsEqual(item.msgstr, first.msgstr))) {
      return group;
    }

    removedCount += duplicates.length;
    duplicates.forEach((duplicate) => {
      first.comments = mergeUniqueValues(first.comments, duplicate.comments);
      first.extractedComments = mergeUniqueValues(first.extractedComments, duplicate.extractedComments);
      first.references = mergeUniqueValues(first.references, duplicate.references);
      Object.entries(duplicate.flags).forEach(([flag, enabled]) => {
        if (enabled) {
          first.flags[flag] = true;
        }
      });
    });
    return [first];
  });

  if (removedCount > 0) {
    writeFileSync(poFile, po.toString());
  }
  return removedCount;
};

async function main() {
  const config = await loadConfig(options);
  console.info(`Input directory: ${colorize("blue", config.input.path)}`);
  console.info(`Output directory: ${colorize("blue", config.output.path)}`);
  console.info(`Output POT file: ${colorize("blue", config.output.potPath)}`);
  console.info(`Locales: ${colorize("blue", config.output.locales.join(", "))}`);
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
    let noLocation = config.output.locations === false || config.output.addLocation === "never" ? "--no-location" : "";
    const noFuzzyMatching = config.output.fuzzyMatching ? "" : "--no-fuzzy-matching";

    mkdirSync(poDir, { recursive: true });
    const isFile = existsSync(poFile) && lstatSync(poFile).isFile();
    if (isFile) {
      const deduplicatedCount = deduplicateIdenticalMessages(poFile);
      if (deduplicatedCount > 0) {
        console.info(
          `${colorize("green", "Removed identical duplicate messages")}: ${colorize("blue", `${deduplicatedCount} in ${poFile}`)}`,
        );
      }
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

    // Post-process the PO file for formatting and auto-filling
    if (existsSync(poFile)) {
      await execShellCommand(`msgattrib --no-wrap --no-obsolete ${noLocation} -o ${poFile} ${poFile}`);

      const shouldAutoFill =
        config.output.autoFill === true ||
        (Array.isArray(config.output.autoFill) && config.output.autoFill.includes(loc));

      if (shouldAutoFill) {
        const po = PO.parse(readFileSync(poFile, "utf-8"));
        let changed = false;
        po.items.forEach((item) => {
          // If the message is completely untranslated
          if (item.msgstr.every((s) => !s || s.length === 0)) {
            item.msgstr[0] = item.msgid;
            if (item.msgid_plural) {
              // Fill all plural forms with the plural ID
              const nplurals = parseInt(po.headers["Plural-Forms"]?.match(/nplurals\s*=\s*(\d+)/)?.[1] || "2");
              for (let i = 1; i < nplurals; i++) {
                item.msgstr[i] = item.msgid_plural;
              }
            }
            changed = true;
          }
        });
        if (changed) {
          writeFileSync(poFile, po.toString());
          // Run msgattrib again to ensure consistent formatting after pofile serialization
          await execShellCommand(`msgattrib --no-wrap ${noLocation} -o ${poFile} ${poFile}`);
          console.info(`${colorize("green", "Auto-filled")}: ${colorize("blue", poFile)}`);
        }
      }
    }
  }
  if (config.output.linguas === true) {
    const linguasPath = path.join(config.output.path, "LINGUAS");
    writeFileSync(linguasPath, config.output.locales.join(" "));
    console.info();
    console.info(`${colorize("green", "Created")}: ${colorize("blue", linguasPath)}`);
  }
}

main().catch((error) => {
  if (error instanceof ShellCommandError) {
    console.error(colorize("red", error.message));
    const stderr = error.stderr.trim();
    if (stderr) {
      console.error(stderr);
    }
  } else {
    console.error(error);
  }
  process.exit(1);
});
