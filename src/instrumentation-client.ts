import { config } from "zod";

/*
 * zod 4 probes `new Function("")` as each object schema is built, to decide
 * whether it may compile a fast parser. The browser reports that probe as a
 * CSP violation on every page load, Report-Only or enforced, even though zod
 * swallows the throw. Next runs this file before hydration, so before any
 * client module builds a schema. The server keeps the compiled parsers.
 */
config({ jitless: true });
