#!/usr/bin/env node
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { loadConfig } from "./config.js";
import { createAwardFlightsServer } from "./server.js";

const config = loadConfig();

if (config.transport === "http") {
  await runHttp();
} else {
  await runStdio();
}

async function runStdio(): Promise<void> {
  const server = createAwardFlightsServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("award-flights-mcp running on stdio");

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

async function runHttp(): Promise<void> {
  const app = createMcpExpressApp();

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createAwardFlightsServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error"
          },
          id: null
        });
      }
    }
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "award-flights-mcp" });
  });

  app.all("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  const httpServer = app.listen(config.httpPort, () => {
    console.error(`award-flights-mcp running at http://0.0.0.0:${config.httpPort}/mcp`);
  });

  process.on("SIGINT", () => {
    httpServer.close(() => process.exit(0));
  });
}
