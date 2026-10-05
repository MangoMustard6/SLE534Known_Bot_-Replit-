import { spawn } from "node:child_process";

export function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${command} exceeded its time limit.`));
    }, timeoutMs);

    const finish = (error?: Error, exitCode?: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else if (exitCode !== 0) {
        reject(
          new Error(stderr.trim().slice(-2_000) || `${command} failed.`),
        );
      } else {
        resolve({ stdout, stderr });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-8_000);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(undefined, code));
  });
}
