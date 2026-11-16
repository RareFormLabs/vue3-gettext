import PO from "pofile";

type PoItem = InstanceType<typeof PO.Item>;

const conflictMarker = /^(<{7,}|\|{7,}|={7,}|>{7,})(?: .*)?\r?$/;

export const hasConflictMarkers = (content: string) => content.split("\n").some((line) => conflictMarker.test(line));

export class ConflictMarkersError extends Error {
  constructor(filePath: string) {
    super(
      `${filePath} has unresolved merge conflict markers. Run vue-gettext-extract to resolve them, then run this command again.`,
    );
    this.name = "ConflictMarkersError";
  }
}

export const assertNoConflictMarkers = (content: string, filePath: string) => {
  if (hasConflictMarkers(content)) {
    throw new ConflictMarkersError(filePath);
  }
};

/**
 * Splits a file with git conflict markers into the two versions being merged.
 * Each version is a complete PO file, so it parses even when a conflict hunk splits an entry.
 * The common-ancestor section of a diff3-style conflict is dropped.
 */
export const splitConflictSides = (content: string, filePath: string) => {
  const ours: string[] = [];
  const theirs: string[] = [];
  let section: "both" | "ours" | "base" | "theirs" = "both";
  let markerLength = 0;

  content.split("\n").forEach((line, index) => {
    const markerRun = line.match(conflictMarker)?.[1];
    const marker = markerRun?.[0];
    const unexpected = () => new Error(`${filePath}:${index + 1}: unexpected merge conflict marker "${line.trim()}"`);
    if (markerRun && marker !== "<" && markerRun.length !== markerLength) {
      throw unexpected();
    }
    if (marker === "<") {
      if (section !== "both") throw unexpected();
      section = "ours";
      markerLength = markerRun!.length;
    } else if (marker === "|") {
      if (section !== "ours") throw unexpected();
      section = "base";
    } else if (marker === "=") {
      if (section !== "ours" && section !== "base") throw unexpected();
      section = "theirs";
    } else if (marker === ">") {
      if (section !== "theirs") throw unexpected();
      section = "both";
    } else {
      if (section === "both" || section === "ours") ours.push(line);
      if (section === "both" || section === "theirs") theirs.push(line);
    }
  });

  if (section !== "both") {
    throw new Error(`${filePath}: merge conflict is missing its closing ">>>>>>>" marker`);
  }
  return { ours: ours.join("\n"), theirs: theirs.join("\n") };
};

const isUntranslated = (item: PoItem) => item.msgstr.every((value) => !value);

const sameTranslation = (left: PoItem, right: PoItem) =>
  left.msgstr.length === right.msgstr.length && left.msgstr.every((value, index) => value === right.msgstr[index]);

const mergeUniqueValues = (left: string[], right: string[]) => [...new Set([...left, ...right])];

const itemKey = (item: PoItem) =>
  JSON.stringify([item.msgctxt ?? null, item.msgid, item.msgid_plural ?? null, item.obsolete]);

/**
 * Collapses entries that share a gettext key. An untranslated copy gives way to a translated one.
 * Groups whose copies carry different translations are returned untouched and listed in `conflicts`.
 */
export const mergeDuplicateItems = (items: PoItem[]) => {
  const groups = new Map<string, PoItem[]>();
  items.forEach((item) => {
    const key = itemKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  let removedCount = 0;
  const conflicts: PoItem[][] = [];
  const merged = [...groups.values()].flatMap((group) => {
    if (group.length === 1) {
      return group;
    }
    const translated = group.filter((item) => !isUntranslated(item));
    const distinctTranslations = translated.filter(
      (item, index) => translated.findIndex((other) => sameTranslation(item, other)) === index,
    );
    if (distinctTranslations.length > 1) {
      conflicts.push(group);
      return group;
    }

    const [first, ...duplicates] = group;
    first.msgstr = [...(distinctTranslations[0] ?? first).msgstr];
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
    removedCount += duplicates.length;
    return [first];
  });

  return { items: merged, removedCount, conflicts };
};

const describeConflict = (group: PoItem[]) => {
  const label = group[0].msgctxt ? `${group[0].msgctxt} | ${group[0].msgid}` : group[0].msgid;
  const translations = group
    .filter((item) => !isUntranslated(item))
    .map((item) => JSON.stringify(item.msgstr.join(" | ")));
  return `  ${JSON.stringify(label)}: ${[...new Set(translations)].join(" vs ")}`;
};

export class MergeConflictError extends Error {
  name = "MergeConflictError";
}

export class PluralFormsConflictError extends MergeConflictError {
  name = "PluralFormsConflictError";

  constructor(filePath: string, ours: string, theirs: string) {
    super(
      [
        `${filePath} has merge conflicts where the two sides use different Plural-Forms headers:`,
        `  ${JSON.stringify(ours)} vs ${JSON.stringify(theirs)}`,
        "Keep one Plural-Forms header, remove the conflict markers, and run the command again.",
      ].join("\n"),
    );
  }
}

export class TranslationConflictError extends MergeConflictError {
  constructor(filePath: string, conflicts: PoItem[][]) {
    super(
      [
        `${filePath} has merge conflicts where both sides translate the same message differently:`,
        ...conflicts.map(describeConflict),
        "Keep one translation for each message, remove the conflict markers, and run the command again.",
      ].join("\n"),
    );
    this.name = "TranslationConflictError";
  }
}

/**
 * Prepares an existing PO file for msgmerge: resolves git conflict markers by keeping the entries from
 * both sides, and removes duplicate entries.
 *
 * Returns the new file content, or `undefined` if nothing changed. Throws `TranslationConflictError`
 * when the conflict markers hide two different translations of the same message.
 */
export const resolvePoContent = (content: string, filePath: string) => {
  const hadConflictMarkers = hasConflictMarkers(content);
  let po: PO;
  if (hadConflictMarkers) {
    const sides = splitConflictSides(content, filePath);
    po = PO.parse(sides.ours);
    const theirs = PO.parse(sides.theirs);
    const ourPluralForms = po.headers["Plural-Forms"];
    const theirPluralForms = theirs.headers["Plural-Forms"];
    if (ourPluralForms && theirPluralForms && ourPluralForms !== theirPluralForms) {
      throw new PluralFormsConflictError(filePath, ourPluralForms, theirPluralForms);
    }
    if (!ourPluralForms && theirPluralForms) {
      po.headers["Plural-Forms"] = theirPluralForms;
    }
    po.items = [...po.items, ...theirs.items];
  } else {
    po = PO.parse(content);
  }

  const { items, removedCount, conflicts } = mergeDuplicateItems(po.items);
  if (hadConflictMarkers && conflicts.length > 0) {
    throw new TranslationConflictError(filePath, conflicts);
  }
  if (!hadConflictMarkers && removedCount === 0) {
    return { content: undefined, hadConflictMarkers, removedCount };
  }

  po.items = items;
  return { content: po.toString(), hadConflictMarkers, removedCount };
};
