import { config } from "zod";

/*
 * zod 4 probes `new Function("")` once per page, when the first object schema
 * is built, to decide whether it may compile a fast parser. Chromium reports
 * that probe as a CSP violation under Report-Only, and both engines block and
 * report it once the policy is enforced (D-122-7), even though zod swallows
 * the throw. Next runs this file before hydration, so before any client
 * module builds a schema. The server keeps the compiled parsers.
 */
config({ jitless: true });
