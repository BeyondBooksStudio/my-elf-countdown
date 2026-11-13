import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { publicAppConfigScript } from "./publicConfig";

/** API only: no listener, Vite import, static files, or simulated authentication. */
export function createApp() {
  const app = express();

  app.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.type("application/javascript").send(publicAppConfigScript());
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );
  // Missing API paths must never fall through to the website's SPA document.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  return app;
}
