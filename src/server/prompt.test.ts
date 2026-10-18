import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PromptCancelledError, promptHidden } from "@/server/prompt";

function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = "";
  output.on("data", (chunk: Buffer) => {
    shown += chunk.toString();
  });
  return { input, output, shown: () => shown };
}

describe("promptHidden", () => {
  it("returns what was typed without ever echoing it", async () => {
    const t = terminal();
    const answer = promptHidden("Password: ", t.input, t.output);
    t.input.write("s3cret-pass\r");

    await expect(answer).resolves.toBe("s3cret-pass");
    expect(t.shown()).toBe("Password: \n");
  });

  it("keeps characters after a backspace correct and still hidden", async () => {
    const t = terminal();
    const answer = promptHidden("Password: ", t.input, t.output);
    t.input.write("abX\x7Fc\r");

    await expect(answer).resolves.toBe("abc");
    expect(t.shown()).not.toMatch(/ab/);
  });

  it("rejects on Ctrl-C instead of hanging", async () => {
    const t = terminal();
    const answer = promptHidden("Password: ", t.input, t.output);
    t.input.write("half\x03");

    await expect(answer).rejects.toBeInstanceOf(PromptCancelledError);
    expect(t.shown()).not.toMatch(/half/);
  });

  it("rejects when input ends before an answer", async () => {
    const t = terminal();
    const answer = promptHidden("Password: ", t.input, t.output);
    t.input.end();

    await expect(answer).rejects.toThrow("Cancelled; nothing was changed.");
  });
});
