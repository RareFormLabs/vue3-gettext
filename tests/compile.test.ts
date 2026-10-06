import { describe, it, expect } from "vitest";
import { serializeTranslations } from "../scripts/compile.js";
import type { Translations } from "../src/typeDefs.js";

describe("serializeTranslations", () => {
  const translations: Translations = {
    fr: {
      Zebra: "Zèbre",
      Apple: "Pomme",
      "%{n} car": ["%{n} voiture", "%{n} voitures"],
      Open: { verb: "Ouvrir", adjective: "Ouvert" },
    },
    en: { Hello: "Hello" },
  };

  it("keeps the minified output by default", () => {
    expect(serializeTranslations(translations)).toBe(JSON.stringify(translations));
  });

  it("sorts keys and puts each entry on its own line when pretty", () => {
    expect(serializeTranslations(translations, true)).toBe(
      `{
  "en": {
    "Hello": "Hello"
  },
  "fr": {
    "%{n} car": [
      "%{n} voiture",
      "%{n} voitures"
    ],
    "Apple": "Pomme",
    "Open": {
      "adjective": "Ouvert",
      "verb": "Ouvrir"
    },
    "Zebra": "Zèbre"
  }
}
`,
    );
  });

  it("round-trips to the same data when pretty", () => {
    expect(JSON.parse(serializeTranslations(translations, true))).toEqual(translations);
  });
});
