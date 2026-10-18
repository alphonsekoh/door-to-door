import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export class PromptCancelledError extends Error {
  constructor() {
    super("Cancelled; nothing was changed.");
    this.name = "PromptCancelledError";
  }
}

/*
 * Asks a question on a terminal without echoing the answer, for secrets that
 * must stay out of shell history and process arguments.
 *
 * readline in terminal mode does its own echoing through `output`, so it is
 * given a sink that swallows everything after the question has been written.
 * Ctrl-C and end of input reject rather than leaving the promise hanging.
 */
export function promptHidden(
  question: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const rl = createInterface({ input, output: muted, terminal: true });
    let settled = false;
    const finish = (settle: () => void) => {
      settled = true;
      rl.close();
      output.write("\n");
      settle();
    };

    rl.on("SIGINT", () => {
      finish(() => {
        reject(new PromptCancelledError());
      });
    });
    rl.on("close", () => {
      if (!settled) {
        finish(() => {
          reject(new PromptCancelledError());
        });
      }
    });

    output.write(question);
    rl.question("", (answer) => {
      finish(() => {
        resolve(answer);
      });
    });
  });
}
