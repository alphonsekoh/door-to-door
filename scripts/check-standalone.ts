import { STANDALONE_DIR, checkStandaloneOutput } from "../src/server/standalone-output";

/*
 * Runs after every `npm run build` (the `postbuild` script, so Docker and the
 * E2E server get it too). A settings file or secret in the standalone output
 * would be frozen at build time and shipped with any copy of the folder.
 */
try {
  const { removed, forbidden } = checkStandaloneOutput(STANDALONE_DIR);
  for (const name of removed) {
    console.log(
      `Removed ${name} from ${STANDALONE_DIR}: Next copies it, the server must not read it.`,
    );
  }
  if (forbidden.length > 0) {
    console.error(
      `${STANDALONE_DIR} contains settings or secrets, which are only ever read at runtime:\n` +
        forbidden.map((path) => `  ${path}`).join("\n") +
        "\nSomething the server imports made the bundler trace them; see the comments in src/server/config.ts.",
    );
    process.exit(1);
  }
} catch (error) {
  console.error(
    `Cannot check ${STANDALONE_DIR}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
