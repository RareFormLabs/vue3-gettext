import { exec } from "node:child_process";

export class ShellCommandError extends Error {
  command: string;
  exitCode: number | string | null | undefined;
  stderr: string;

  constructor(command: string, exitCode: number | string | null | undefined, stderr: string) {
    super(`Command failed${exitCode !== undefined && exitCode !== null ? ` (${exitCode})` : ""}: ${command}`);
    this.name = "ShellCommandError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export function execShellCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new ShellCommandError(cmd, error.code, stderr));
        return;
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
  red: "[31m",
};
export function colorize(color: keyof typeof terminalFontColors, str: unknown): string {
  return `${terminalEsc}${terminalFontColors[color]}${str}${terminalEsc}${terminalFontColorReset}`;
}
