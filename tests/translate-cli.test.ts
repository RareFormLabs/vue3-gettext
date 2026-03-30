import PO from "pofile";
import { describe, expect, it } from "vitest";
import { applyTranslations, collectTranslationEntries } from "../scripts/translate.js";

const parsePo = (content: string) => PO.parse(content);

describe("translation CLI helpers", () => {
  it("collects only untranslated singular entries by default", () => {
    const po = parsePo(`
msgid ""
msgstr ""
"Language: fr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Already translated"
msgstr "Déjà traduit"

msgid "Hello"
msgstr ""
`);

    const entries = collectTranslationEntries(po);
    expect(entries).toHaveLength(1);
    expect(entries[0].msgid).toBe("Hello");
    expect(entries[0].targetPluralCount).toBe(1);
  });

  it("collects plural and context metadata for untranslated entries", () => {
    const po = parsePo(`
msgid ""
msgstr ""
"Language: ru\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

msgctxt "verb"
msgid "Archive"
msgstr ""

msgctxt "cart"
msgid "item"
msgid_plural "items"
msgstr[0] ""
msgstr[1] ""
msgstr[2] ""
`);

    const entries = collectTranslationEntries(po);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ msgctxt: "verb", msgid: "Archive", targetPluralCount: 1 });
    expect(entries[1]).toMatchObject({
      msgctxt: "cart",
      msgid: "item",
      msgidPlural: "items",
      targetPluralCount: 3,
    });
  });

  it("applies translations without disturbing existing ones", () => {
    const po = parsePo(`
msgid ""
msgstr ""
"Language: fr\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"

msgid "Already translated"
msgstr "Déjà traduit"

msgctxt "button"
msgid "Save"
msgstr ""

msgid "car"
msgid_plural "cars"
msgstr[0] ""
msgstr[1] ""
`);

    const entries = collectTranslationEntries(po);
    const changes = applyTranslations(po, [
      {
        key: entries[0].key,
        msgstr: ["Enregistrer"],
      },
      {
        key: entries[1].key,
        msgstr: ["voiture", "voitures"],
      },
    ]);

    expect(changes).toBe(2);
    expect(po.items[0].msgstr).toEqual(["Déjà traduit"]);
    expect(po.items[1].msgctxt).toBe("button");
    expect(po.items[1].msgstr).toEqual(["Enregistrer"]);
    expect(po.items[2].msgid_plural).toBe("cars");
    expect(po.items[2].msgstr).toEqual(["voiture", "voitures"]);
  });

  it("can include already translated entries when requested", () => {
    const po = parsePo(`
msgid ""
msgstr ""
"Language: es\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "Hello"
msgstr "Hola"
`);

    const entries = collectTranslationEntries(po, true);
    expect(entries).toHaveLength(1);
    expect(entries[0].previousTranslations).toEqual(["Hola"]);
  });

  it("includes partially translated plural entries by default", () => {
    const po = parsePo(`
msgid ""
msgstr ""
"Language: ru\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

msgid "file"
msgid_plural "files"
msgstr[0] "файл"
msgstr[1] ""
msgstr[2] ""
`);

    const entries = collectTranslationEntries(po);
    expect(entries).toHaveLength(1);
    expect(entries[0].targetPluralCount).toBe(3);
    expect(entries[0].previousTranslations).toEqual(["файл", "", ""]);
  });
});
