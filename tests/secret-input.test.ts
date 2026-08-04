import { processSecretInputChunk } from "../scripts/secret-input.js";

describe("secret input", () => {
  it("submits pasted input at the first newline", () => {
    expect(processSecretInputChunk("", "secret\nignored")).toEqual({
      value: "secret",
      output: "******",
      action: "submit",
    });
  });

  it("handles backspace and cancellation within multi-character chunks", () => {
    expect(processSecretInputChunk("ab", "\bcd\u0003ignored")).toEqual({
      value: "acd",
      output: "\b \b**",
      action: "cancel",
    });
  });
});
