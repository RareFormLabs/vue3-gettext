# Message extraction

To extract all the messages that you want translated from your application code, a bit of setup is required.

## Scripts

First, add scripts to your `package.json`:

```json { package.json }
"scripts": {
  ...
  "gettext:extract": "vue-gettext-extract",
  "gettext:translate": "vue-gettext-translate",
  "gettext:compile": "vue-gettext-compile",
}
```

`npm run gettext:extract` extracts messages from your code and creates `.po` files.

`npm run gettext:translate` fills missing PO entries using your configured translation provider.

`npm run gettext:compile` compiles the translated messages from the `.po` files to a `.json` to be used in your application.

Using these scripts is _theoretically_ optional if you have other means of extraction or may even want to write message files yourself.

## Configuration

Before running the scripts, create a file `gettext.config.js` in your application root. This is a configuration _only_ for the scripts above. A minimal configuration may look like this:

```js
// @ts-check
/** @type {import('./src/index').Config} */
const config = {
  output: {
    locales: ["en", "de"],
  },
};
export default config;
```

Here are all the available configuration options and their defaults:

```js
// @ts-check
/** @type {import('./src/index').Config} */
const config = {
  input: {
    path: "./src", // only files in this directory are considered for extraction
    include: ["**/*.js", "**/*.ts", "**/*.vue"], // glob patterns to select files for extraction
    exclude: [], // glob patterns to exclude files from extraction
    parserOptions: {
      // add your own function names/keywords to extract
      mapping: {
        simple: ["$gettext"],
        plural: ["$ngettext"],
        ctx: ["$pgettext"],
        ctxPlural: ["$npgettext"],
      },
      overrideDefaultKeywords: false, // do not extract default keywords, `mapping` must be set if this is enabled
    },
  },
  output: {
    path: "./src/language", // output path of all created files
    potPath: "./messages.pot", // relative to output.path, so by default "./src/language/messages.pot"
    jsonPath: "./translations.json", // relative to output.path, so by default "./src/language/translations.json"
    locales: ["en"],
    flat: true, // create a subdirectory for each locale
    linguas: true, // create a LINGUAS file
    splitJson: false, // create separate json files for each locale. If used, jsonPath must end with a directory, not a file
    fuzzyMatching: true, // set if fuzzy matching should be enabled when merging the pot file into the po files
    locations: true, // output location paths
    /**
     * "full": file and line number (default)
     * "file": filename only (reduces merge conflicts)
     * "never": no location comments
     */
    addLocation: "full",
    /**
     * If enabled, empty msgstr entries will be filled with the msgid.
     * Can be a boolean or an array of locales (e.g. ["en"]).
     */
    autoFill: false,
  },
  translate: {
    provider: "openai",
    model: "gpt-4.1-mini", // default model used for translation requests
    locales: undefined, // defaults to output.locales
    includeTranslated: false, // when true, retranslate entries that already have msgstr values
    openai: {
      authMode: "api-key", // "api-key" for normal OpenAI API, or "oauth" for ChatGPT/Codex OAuth
      apiKeyEnvVar: "OPENAI_API_KEY", // env var to read in api-key mode
      credentialsPath: undefined, // oauth mode; defaults to ~/.vue-gettext/openai-codex-oauth.json
      accessTokenEnvVar: "OPENAI_OAUTH_ACCESS_TOKEN", // optional oauth env override instead of credentialsPath
      refreshTokenEnvVar: "OPENAI_OAUTH_REFRESH_TOKEN", // optional oauth env override instead of credentialsPath
      accountIdEnvVar: "OPENAI_OAUTH_ACCOUNT_ID", // optional oauth env override; usually derivable from token
      persistRefresh: true, // oauth mode; write refreshed tokens back to credentialsPath
      baseUrl: undefined, // optional advanced override; normally leave unset unless targeting a compatible endpoint
      model: undefined, // optional provider-specific override; falls back to translate.model
      organization: undefined, // api-key mode only; optional OpenAI organization header
      project: undefined, // api-key mode only; optional OpenAI project header
      originator: undefined, // oauth mode only; advanced header override if your environment requires a non-default originator
    },
  },
};
export default config;
```

## Advanced Extraction Options

### Reducing Merge Conflicts

By default, the extractor includes line numbers in the PO file comments (`#: file.js:123`). This often causes noisy merge conflicts when lines shift.

To reduce this, set `addLocation: 'file'` to only include filenames, or `'never'` to remove location comments entirely.

### Mechanical Default Locales (Auto-fill)

For your primary language (e.g., English), it can be tedious to manually copy `msgid` to `msgstr`.

Set `autoFill: ["en"]` to automatically populate empty translations in `en.po` with the source string. This allows you to treat the PO file for your default locale as a generated artifact.

## AI translation workflow

Keep extraction, translation, and compilation as separate steps:

```bash
npm run gettext:extract
OPENAI_API_KEY=your-key npm run gettext:translate
npm run gettext:compile
```

OAuth workflow:

```bash
npx vue-gettext-openai-login
npm run gettext:translate
```

What the OAuth-specific options mean:

- `credentialsPath`: where the saved OAuth credentials JSON lives
- `persistRefresh`: whether refreshed access tokens should be written back to that file
- `baseUrl`: advanced override for the HTTP endpoint; leave unset unless you know you need a custom compatible endpoint
- `originator`: advanced OAuth header override; most users should leave this unset

The translator reads your existing PO files, sends only untranslated entries by default, preserves `msgctxt` and `msgid_plural`, and writes the returned `msgstr` values back into the PO files.

CLI flags:

- `--config, -c` custom gettext config path
- `--locale, -l` restrict translation to one or more locales
- `--provider` provider name, currently `openai`
- `--model` override the configured model
- `--include-translated` retranslate entries that already have `msgstr` values
- `--dry-run` call the provider without writing files

## Gotchas

When first extract, it will call `msginit` to create a `.po` file,
this command will set the `Plural-Forms` header, if the locale is in
[the embedded table](https://github.com/dd32/gettext/blob/master/gettext-tools/src/plural-table.c#L27)
of msginit.

Otherwise, as an experimental feature,
you can instruct msginit to use the information from Unicode CLDR,
by setting the `GETTEXTCLDRDIR` environment variable.
The program will look for a file named
`common/supplemental/plurals.xml` under that directory.
You can get the CLDR data from [http://cldr.unicode.org/](http://cldr.unicode.org/).
Or only download the [plurals.xml](https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/plurals.xml) file.
