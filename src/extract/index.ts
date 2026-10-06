// Node-only extraction API, published as `@rareformlabs/vue3-gettext/extract`.
// Kept out of the root entry because the parser depends on pofile, which
// requires Node built-ins (fs) and breaks browser bundles.
export { tokenize } from "./tokenizer.js";
export { type MsgInfo, parseSrc, makePO } from "./parser.js";
