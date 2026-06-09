import pino from "pino";
import { ENV } from "./env";

export const logger = pino({
  level: ENV.isProduction ? "info" : "debug",
  base: { service: "riskwise" },
  ...(ENV.isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, ignore: "pid,hostname,service" },
        },
      }),
});
