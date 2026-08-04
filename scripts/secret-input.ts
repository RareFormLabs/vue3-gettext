export type SecretInputResult = {
  value: string;
  output: string;
  action?: "submit" | "cancel";
};

export const processSecretInputChunk = (currentValue: string, input: string): SecretInputResult => {
  let value = currentValue;
  let output = "";

  for (const character of input) {
    if (character === "\u0003") return { value, output, action: "cancel" };
    if (character === "\r" || character === "\n") return { value, output, action: "submit" };
    if (character === "\u007f" || character === "\b") {
      if (value.length > 0) {
        value = value.slice(0, -1);
        output += "\b \b";
      }
      continue;
    }
    value += character;
    output += "*";
  }

  return { value, output };
};
