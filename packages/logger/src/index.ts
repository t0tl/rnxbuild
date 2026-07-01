import pino, { type Logger, type LoggerOptions } from "pino";

export type RnxLogger = Logger;

export interface CreateLoggerOptions {
  name: string;
  level?: pino.Level;
}

export function createLogger(opts: CreateLoggerOptions): RnxLogger {
  const envLevel = process.env.RNXBUILD_LOG_LEVEL as pino.Level | undefined;
  const level = envLevel ?? opts.level ?? "info";

  const pinoOpts: LoggerOptions = {
    name: opts.name,
    level,
  };

  // Pretty-print only when stdout is a TTY (human-facing). JSON otherwise (machine).
  if (process.stdout.isTTY) {
    return pino({
      ...pinoOpts,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l" },
      },
    });
  }

  return pino(pinoOpts);
}
