type Level = "info" | "warn" | "error";

function write(level: Level, message: string, extra?: unknown): void {
  const prefix = `[embedify] ${level}`;
  if (extra === undefined) {
    console[level](prefix, message);
    return;
  }
  console[level](prefix, message, extra);
}

export const log = {
  info: (message: string, extra?: unknown) => write("info", message, extra),
  warn: (message: string, extra?: unknown) => write("warn", message, extra),
  error: (message: string, extra?: unknown) => write("error", message, extra),
};
