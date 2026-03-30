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

## Extraction & Configuration

This fork includes improved extraction tools with configurable location comments and auto-filling support.

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
    provider: "openai",
    model: "gpt-4.1-mini",
    // optional: limit translation to specific locales instead of output.locales
    locales: ["es"],
    // default false: only fill untranslated entries
    includeTranslated: false,
    openai: {
      /**
       * Default: "api-key"
       * - "api-key" uses https://api.openai.com/v1/chat/completions
       * - "oauth" uses ChatGPT/Codex OAuth via @mariozechner/pi-ai and https://chatgpt.com/backend-api/codex/responses
       */
      authMode: "api-key",
      // optional override, defaults to OPENAI_API_KEY
      apiKeyEnvVar: "OPENAI_API_KEY",
    },
  },
};
```

OAuth mode example:

```js
export default {
  translate: {
    provider: "openai",
    model: "gpt-5.4",
    includeTranslated: false,
    openai: {
      authMode: "oauth",
      // defaults to ~/.vue-gettext/openai-codex-oauth.json
      credentialsPath: "./.gettext/openai-codex-oauth.json",
      // optional env overrides if you do not want a file
      accessTokenEnvVar: "OPENAI_OAUTH_ACCESS_TOKEN",
      refreshTokenEnvVar: "OPENAI_OAUTH_REFRESH_TOKEN",
      accountIdEnvVar: "OPENAI_OAUTH_ACCOUNT_ID",
      // default true: persist refreshed tokens back to credentialsPath
      persistRefresh: true,
    },
  },
};
```

Credential file formats accepted in OAuth mode:

```json
{
  "access": "<token>",
  "refresh": "<token>",
  "expires": 1760000000000,
  "accountId": "user-123"
}
```

or:

```json
{
  "openai-codex": {
    "access": "<token>",
    "refresh": "<token>",
    "expires": 1760000000000,
    "accountId": "user-123"
  }
}
```

Run extraction:

```bash
npx vue-gettext-extract
```

Run AI translation for missing entries with API key auth:

```bash
OPENAI_API_KEY=your-key npx vue-gettext-translate
```

Run AI translation with OAuth auth:

```bash
OPENAI_OAUTH_ACCESS_TOKEN=... \
OPENAI_OAUTH_REFRESH_TOKEN=... \
OPENAI_OAUTH_ACCOUNT_ID=... \
npx vue-gettext-translate
```

Or point `translate.openai.credentialsPath` at a saved OAuth JSON file.

Run compilation:

```bash
npx vue-gettext-compile
```

## Contribute

> Note: We're publishing a stable 4.1.1 next (dropping the beta suffix).

Please make sure your code is properly formatted (the project contains a `prettier` config) and all the tests run successfully (`npm run test`) when opening a pull request.

Please specify clearly what you changed and why.

## Credits

This plugin relies heavily on the work of the original [`vue-gettext`](https://github.com/Polyconseil/vue-gettext/).

## License

[MIT](http://opensource.org/licenses/MIT)
