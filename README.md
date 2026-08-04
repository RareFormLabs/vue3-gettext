<h1 align="center">
  <a href="https://www.npmjs.com/package/@rareformlabs/vue3-gettext" target="_blank">
    Vue 3 Gettext 💬
  </a>
</h1>

<p align="center">
  <strong>Maintained fork</strong> of <a href="https://github.com/jshmrtn/vue3-gettext">jshmrtn/vue3-gettext</a>
</p>
<br/>

Translate [Vue 3](http://vuejs.org) applications with [gettext](https://en.wikipedia.org/wiki/Gettext).

<br>
<p align="center">
 <a href="https://jshmrtn.github.io/vue3-gettext/">Getting started</a> | <a href="https://jshmrtn.github.io/vue3-gettext/demo.html">Demo</a> | <a href="https://jshmrtn.github.io/vue3-gettext/setup.html">Documentation</a> | <a href="README_zh.md">中文</a>
</p>

## Install

```bash
npm i @rareformlabs/vue3-gettext
```

<br>

## Basic usage

In templates:

```jsx
<span>
  {{ $gettext("I'm %{age} years old!", { age: 32 }) }}
</span>
```

In code:

```ts
const { $gettext } = useGettext();

console.log($gettext("Hello World!"));
```

## Features

- simple, ergonomic API
- reactive translations in Vue templates and TypeScript/JavaScript code
- CLI to automatically extract messages from code files
- AI-assisted PO translation for missing entries
- support for pluralization and message contexts

## Extraction, Translation & Configuration

This fork includes improved extraction tools with configurable location comments, auto-filling support, and optional AI-assisted translation.

Create a `gettext.config.js` in your project root:

```js
export default {
  input: {
    path: "./src",
    include: ["**/*.js", "**/*.ts", "**/*.vue"],
    exclude: [],
  },
  output: {
    path: "./src/language",
    locales: ["en", "es"],
    /**
     * "full": file and line number (default)
     * "file": filename only (reduces merge conflicts)
     * "never": no location comments
     */
    addLocation: "file",
    /**
     * If true, empty msgstr entries in PO files will be filled with the msgid.
     * Can also be an array of locales to auto-fill (e.g. ["en"]).
     * Useful for mechanical default locales (e.g. English).
     */
    autoFill: ["en"],
  },
  translate: {
    // Optional repository fallback. Each developer can override this pair locally.
    model: {
      provider: "openai",
      id: "gpt-4.1-mini",
    },
    // optional: limit translation to specific locales instead of output.locales
    locales: ["es"],
    // default false: only fill missing entries; true means retranslate existing msgstr values too
    includeTranslated: false,
  },
};
```

The checked-in model is only a fallback. Add `.env.gettext` to your project's `.gitignore`, then each developer can select their own provider and model beside `gettext.config.js`:

```dotenv
VUE_GETTEXT_PROVIDER=anthropic
VUE_GETTEXT_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=your-key

# Optional model endpoint override
# VUE_GETTEXT_BASE_URL=http://localhost:11434/v1

# Optional; defaults to ~/.vue-gettext/auth.json
# VUE_GETTEXT_CREDENTIALS_PATH=~/.vue-gettext/auth.json
```

`VUE_GETTEXT_PROVIDER` and `VUE_GETTEXT_MODEL` are an atomic pair. They are never mixed with values from another layer. Selection precedence is:

1. `--provider` and `--model`
2. Existing shell or CI environment variables
3. `--env-file <path>`, or `.env.gettext` beside the selected config file
4. The optional checked-in `translate.model` fallback

If either value is present at a layer, both are required. An explicit `--env-file` replaces automatic discovery and must exist. The file can also contain any standard pi-ai provider variables, such as `OPENAI_API_KEY`, AWS credentials, or Google and Cloudflare configuration. If it contains secrets, use restrictive permissions such as `chmod 600 .env.gettext`.

Run extraction:

```bash
npx vue-gettext-extract
```

Run AI translation with a local environment file:

```bash
npx vue-gettext-translate
```

Or choose a model for one invocation:

```bash
ANTHROPIC_API_KEY=your-key npx vue-gettext-translate \
  --provider anthropic --model claude-sonnet-4-5
```

OpenAI API example:

```bash
OPENAI_API_KEY=your-key npx vue-gettext-translate \
  --provider openai --model gpt-4.1-mini
```

For CI, set the pair and provider credentials as protected environment variables; no local file is required:

```yaml
env:
  VUE_GETTEXT_PROVIDER: openai
  VUE_GETTEXT_MODEL: gpt-4.1-mini
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

All built-in, tool-capable pi-ai text providers are supported. API-key and ambient provider credentials take precedence over saved credentials. For interactive API-key or OAuth login, use the provider-aware auth command:

```bash
npx vue-gettext-auth login anthropic --type api-key
npx vue-gettext-auth login anthropic --type oauth
npx vue-gettext-auth login openai-codex --type oauth
npx vue-gettext-auth list
npx vue-gettext-auth logout anthropic
```

Saved credentials are provider-keyed in `~/.vue-gettext/auth.json` by default. Override that location only with `VUE_GETTEXT_CREDENTIALS_PATH` or `--credentials`. Writes are locked and atomic, with `0700` parent directories and `0600` files. The commands never print credential values.

Useful translation flags include:

- `--config, -c <path>`: use a specific config file
- `--env-file <path>`: use a specific local environment file
- `--credentials <path>`: use a specific credential store
- `--provider <id> --model <id>`: select an atomic provider/model pair
- `--base-url <url>`: override the selected model endpoint
- `--locale, -l <locale>`: restrict translation to one or more locales
- `--include-translated`: retranslate existing values
- `--dry-run`: validate provider output without writing PO files

### Migrating from v4

v5 requires Node 22.19 or newer and uses pi-ai for every provider. Legacy configuration is rejected with an inline migration example:

| v4                                     | v5                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `translate.provider: "openai"`         | `translate.model.provider: "openai"`                                            |
| `translate.model: "gpt-4.1-mini"`      | `translate.model.id: "gpt-4.1-mini"`                                            |
| `translate.openai.authMode: "api-key"` | Provider `openai`; use `OPENAI_API_KEY`                                         |
| `translate.openai.authMode: "oauth"`   | Provider `openai-codex`; use `vue-gettext-auth login openai-codex --type oauth` |
| `vue-gettext-openai-login`             | `vue-gettext-auth login [provider] --type api-key\|oauth`                       |

Project workflow options such as `locales` and `includeTranslated` remain in `gettext.config.js`. Provider, model, endpoint, credential location, and provider-specific credentials can all be local-only.

Run compilation:

```bash
npx vue-gettext-compile
```

## Contribute

Please make sure your code is properly formatted (the project contains a `prettier` config) and all the tests run successfully (`npm run test`) when opening a pull request.

Please specify clearly what you changed and why.

## Credits

This plugin relies heavily on the work of the original [`vue-gettext`](https://github.com/Polyconseil/vue-gettext/).

## License

[MIT](http://opensource.org/licenses/MIT)
