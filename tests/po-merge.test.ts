import { describe, it, expect } from "vitest";
import PO from "pofile";
import {
  assertNoConflictMarkers,
  ConflictMarkersError,
  hasConflictMarkers,
  resolvePoContent,
  splitConflictSides,
  TranslationConflictError,
} from "../scripts/po-merge.js";

const header = `msgid ""
msgstr ""
"Language: fr\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"
`;

const translationsOf = (content: string) =>
  Object.fromEntries(PO.parse(content).items.map((item) => [item.msgid, item.msgstr.join(" | ")]));

describe("hasConflictMarkers", () => {
  it("finds markers only at the start of a line", () => {
    expect(hasConflictMarkers(`${header}\n<<<<<<< HEAD\n`)).toBe(true);
    expect(hasConflictMarkers(`${header}\n=======\r\n`)).toBe(true);
    expect(hasConflictMarkers(`${header}\nmsgid "a <<<<<<< b"\nmsgstr "======="\n`)).toBe(false);
  });
});

describe("splitConflictSides", () => {
  it("drops the common ancestor of a diff3 conflict", () => {
    const sides = splitConflictSides(
      "a\n<<<<<<< HEAD\nours\n||||||| base\nancestor\n=======\ntheirs\n>>>>>>> main\nz",
      "fr.po",
    );
    expect(sides).toEqual({ ours: "a\nours\nz", theirs: "a\ntheirs\nz" });
  });

  it("rejects malformed markers", () => {
    expect(() => splitConflictSides("<<<<<<< HEAD\na\n", "fr.po")).toThrow('missing its closing ">>>>>>>"');
    expect(() => splitConflictSides("=======\n", "fr.po")).toThrow("fr.po:1: unexpected merge conflict marker");
  });
});

describe("resolvePoContent", () => {
  it("keeps the entries from both sides of a conflict", () => {
    const content = `${header}
msgid "Shared"
msgstr "Partagé"

<<<<<<< HEAD
msgid "Ours"
msgstr "Le nôtre"

msgid "Also ours"
msgstr "Aussi le nôtre"
=======
msgid "Theirs"
msgstr "Le leur"
>>>>>>> main

msgid "After"
msgstr "Après"
`;

    const resolved = resolvePoContent(content, "fr.po");

    expect(resolved.hadConflictMarkers).toBe(true);
    expect(hasConflictMarkers(resolved.content!)).toBe(false);
    expect(translationsOf(resolved.content!)).toEqual({
      Shared: "Partagé",
      Ours: "Le nôtre",
      "Also ours": "Aussi le nôtre",
      Theirs: "Le leur",
      After: "Après",
    });
  });

  it("resolves a conflict that splits an entry when only one side translated it", () => {
    const content = `${header}
msgid "Hello"
<<<<<<< HEAD
msgstr ""
=======
msgstr "Bonjour"
>>>>>>> main
`;

    expect(translationsOf(resolvePoContent(content, "fr.po").content!)).toEqual({ Hello: "Bonjour" });
  });

  it("refuses to pick between two different translations", () => {
    const content = `${header}
<<<<<<< HEAD
msgid "Hello"
msgstr "Bonjour"
=======
msgid "Hello"
msgstr "Salut"
>>>>>>> main
`;

    expect(() => resolvePoContent(content, "fr.po")).toThrow(TranslationConflictError);
    expect(() => resolvePoContent(content, "fr.po")).toThrow('"Hello": "Bonjour" vs "Salut"');
  });

  it("keeps messages with the same msgid but different contexts apart", () => {
    const content = `${header}
<<<<<<< HEAD
msgctxt "verb"
msgid "Open"
msgstr "Ouvrir"
=======
msgctxt "adjective"
msgid "Open"
msgstr "Ouvert"
>>>>>>> main
`;

    const items = PO.parse(resolvePoContent(content, "fr.po").content!).items;
    expect(items.map((item) => [item.msgctxt, item.msgstr[0]])).toEqual([
      ["verb", "Ouvrir"],
      ["adjective", "Ouvert"],
    ]);
  });

  it("leaves a file without duplicates or markers alone", () => {
    expect(resolvePoContent(`${header}\nmsgid "Hello"\nmsgstr "Bonjour"\n`, "fr.po").content).toBeUndefined();
  });

  it("leaves conflicting duplicates without markers for msgmerge to report", () => {
    const content = `${header}\nmsgid "Hello"\nmsgstr "Bonjour"\n\nmsgid "Hello"\nmsgstr "Salut"\n`;
    expect(resolvePoContent(content, "fr.po").content).toBeUndefined();
  });
});

describe("assertNoConflictMarkers", () => {
  it("names the file and the command that resolves it", () => {
    expect(() => assertNoConflictMarkers(`${header}\n<<<<<<< HEAD\n`, "src/lang/fr.po")).toThrow(ConflictMarkersError);
    expect(() => assertNoConflictMarkers(`${header}\n<<<<<<< HEAD\n`, "src/lang/fr.po")).toThrow(
      "src/lang/fr.po has unresolved merge conflict markers. Run vue-gettext-extract",
    );
  });
});
