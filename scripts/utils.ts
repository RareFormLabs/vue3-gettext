import { exec } from "node:child_process";

export function execShellCommand(cmd: string) {
  return new Promise((resolve) => {
    exec(cmd, { env: process.env }, (error, stdout, stderr) => {
      if (error) {
        console.warn(error);
      }
      resolve(stdout ? stdout : stderr);
    });
  });
}

const terminalEsc = "\x1b";
const terminalFontColorReset = "\x1b[0m";
const terminalFontColors = {
  blue: "[34;1m",
  green: "[32m",
  grey: "[90m",
};
export function colorize(color: keyof typeof terminalFontColors, str: unknown): string {
  return `${terminalEsc}${terminalFontColors[color]}${str}${terminalEsc}${terminalFontColorReset}`;
}
