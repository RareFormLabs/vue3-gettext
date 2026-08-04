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

**NOTE**: `vue-gettext-compile` WILL NOT include messages marked as `obsolete` or `fuzzy`! Thus you might want to execute `msgattrib --clear-fuzzy` to unset "fuzzy" attribute from all strings in order to get them included in translations.

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
    // Optional repository fallback. Developers can override this pair locally.
    model: {
      provider: "openai",
      id: "gpt-4.1-mini",
      baseUrl: undefined, // optional endpoint override
    },
    locales: undefined, // defaults to output.locales
    includeTranslated: false, // when true, retranslate entries that already have msgstr values
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
npm run gettext:translate
npm run gettext:compile
```

The checked-in `translate.model` is an optional fallback. To choose a model per developer, add `.env.gettext` to `.gitignore` and create it beside `gettext.config.js`:

```dotenv
VUE_GETTEXT_PROVIDER=anthropic
VUE_GETTEXT_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=your-key

# Optional
# VUE_GETTEXT_BASE_URL=http://localhost:11434/v1
# VUE_GETTEXT_CREDENTIALS_PATH=~/.vue-gettext/auth.json
```

Use restrictive permissions such as `chmod 600 .env.gettext` if the file contains secrets. The translator warns if an automatically discovered file appears to be tracked by Git.

The provider and model are atomic at every layer. They resolve in this order:

1. `--provider` and `--model`
2. Existing `VUE_GETTEXT_PROVIDER` and `VUE_GETTEXT_MODEL` shell variables
3. An explicit `--env-file`, or `.env.gettext` beside the selected config
4. The optional `translate.model` repository fallback

Setting only one value is an error; the translator never combines values from different layers. Existing shell variables win over values loaded from a local file. An explicit environment file must exist and replaces automatic discovery.

The local file may contain the model pair, `VUE_GETTEXT_BASE_URL`, `VUE_GETTEXT_CREDENTIALS_PATH`, and any standard pi-ai provider credentials, including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, AWS variables, and Google or Cloudflare configuration.

API-key examples:

```bash
ANTHROPIC_API_KEY=your-key npx vue-gettext-translate \
  --provider anthropic --model claude-sonnet-4-5

OPENAI_API_KEY=your-key npx vue-gettext-translate \
  --provider openai --model gpt-4.1-mini
```

CI can set `VUE_GETTEXT_PROVIDER`, `VUE_GETTEXT_MODEL`, and the provider's credentials as protected environment variables instead of creating a local file.

All built-in, tool-capable pi-ai text providers use the same translation path. Provider output is validated before any PO file changes are written.

Authentication precedence is explicit provider environment credentials, a saved provider credential, then other pi-ai ambient authentication such as AWS profiles or Google ADC. Manage saved credentials with:

```bash
npx vue-gettext-auth login anthropic --type api-key
npx vue-gettext-auth login anthropic --type oauth
npx vue-gettext-auth login openai-codex --type oauth
npx vue-gettext-auth list
npx vue-gettext-auth logout anthropic
```

The store defaults to `~/.vue-gettext/auth.json`; only `VUE_GETTEXT_CREDENTIALS_PATH` and `--credentials` override it. Writes use cross-process locking and atomic replacement. Store directories are created with mode `0700` and files with mode `0600`. Credential values and local environment values are never printed.

The translator reads your existing PO files, sends only untranslated entries by default, preserves `msgctxt` and `msgid_plural`, and writes the returned `msgstr` values back into the PO files.

CLI flags:

- `--config, -c` custom gettext config path
- `--env-file` custom local environment file; disables automatic discovery
- `--credentials` custom provider credential store path
- `--locale, -l` restrict translation to one or more locales
- `--provider` provider ID; must be supplied with `--model`
- `--model` model ID; must be supplied with `--provider`
- `--base-url` override the selected model endpoint
- `--include-translated` retranslate entries that already have `msgstr` values
- `--dry-run` call the provider without writing files

## Migrating from v4

v5 requires Node 22.19 or newer. It rejects `translate.provider`, string-valued `translate.model`, and `translate.openai` and prints a migration example.

| v4                                | v5                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `translate.provider: "openai"`    | `translate.model.provider: "openai"`                                            |
| `translate.model: "gpt-4.1-mini"` | `translate.model.id: "gpt-4.1-mini"`                                            |
| OpenAI API billing                | Provider `openai` plus `OPENAI_API_KEY`                                         |
| ChatGPT/Codex OAuth               | Provider `openai-codex` plus `vue-gettext-auth login openai-codex --type oauth` |
| `vue-gettext-openai-login`        | `vue-gettext-auth login [provider] --type api-key\|oauth`                       |

Keep workflow settings such as `locales` and `includeTranslated` in repository configuration. Provider, model, endpoint, credential path, and credentials may all remain local to each developer or CI job.

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
