#!/usr/bin/env node
/**
 * Flywheel MCP Server — supports two transport modes:
 *
 *   stdio (default)  — used by Claude Code and Claude Desktop locally
 *   http             — used for server deployment (claude.ai, remote access)
 *
 * Environment variables:
 *   FLYWHEEL_URL   URL of the Flywheel app  (default: http://localhost:5500)
 *   MCP_MODE       "stdio" | "http"         (default: stdio)
 *   PORT           HTTP port                (default: 5501)
 *   MCP_API_KEY    Bearer token for HTTP auth (required in http mode)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { z } from "zod";

const BASE_URL = (process.env.FLYWHEEL_URL ?? "http://localhost:5500").replace(/\/$/, "");
const MODE = process.env.MCP_MODE ?? "stdio";
const PORT = parseInt(process.env.PORT ?? "5501", 10);
const API_KEY = process.env.MCP_API_KEY ?? "";
const DEFAULT_USER = process.env.FLYWHEEL_USER ?? process.env.USER ?? process.env.USERNAME ?? "Team";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Flywheel API ${res.status} on ${path}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function parseContributors(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }
  return [];
}

function nameMatches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase().trim());
}

const STATUS_VALUES = ["Not Started", "On Track", "At Risk", "Blocked", "Completed"] as const;

// ─── Server factory (one per request in HTTP mode) ───────────────────────────

function createServer(): McpServer {
  const server = new McpServer({ name: "flywheel", version: "1.0.0" });

  // ── list_all_mandates ──────────────────────────────────────────────────────
  server.tool(
    "list_all_mandates",
    "List all strategic mandates with their current status, owner, theme, and initiative count.",
    {},
    async () => {
      const [mandates, initiatives] = await Promise.all([
        api<any[]>("/api/mandates"),
        api<any[]>("/api/initiatives"),
      ]);
      const summary = mandates.map((m) => ({
        id: m.id as string,
        title: m.title as string,
        theme: m.theme as string,
        owner: m.owner as string,
        contributors: parseContributors(m.contributors),
        status: m.status as string,
        initiative_count: initiatives.filter((i) => i.mandate_id === m.id).length,
        updated_at: m.updated_at as string,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── get_person_initiatives ─────────────────────────────────────────────────
  server.tool(
    "get_person_initiatives",
    "Get all initiatives owned by or contributed to by a specific person, with current status and most recent update note.",
    {
      person_name: z.string().describe(
        "Display name of the person (e.g. 'Saranya', 'Vijay'). Partial names work, case-insensitive."
      ),
    },
    async ({ person_name }) => {
      const [initiatives, mandates] = await Promise.all([
        api<any[]>("/api/initiatives"),
        api<any[]>("/api/mandates"),
      ]);
      const mandateMap = new Map<string, string>(
        mandates.map((m) => [m.id as string, m.title as string])
      );
      const matched = initiatives.filter((i) => {
        const ownerMatch = nameMatches(i.owner ?? "", person_name);
        const contribMatch = parseContributors(i.contributors).some((c) =>
          nameMatches(c, person_name)
        );
        return ownerMatch || contribMatch;
      });
      if (matched.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No initiatives found for "${person_name}". Known people: Saranya, Vijay, Manikanta, Sandeep, Uthra, Adarsh, Srividhya, Ilakkia, Saradha, Santhosh, Navin, Vishnu, Nishanth, Saravana, Naveen, Gova.`,
          }],
        };
      }
      const enriched = matched.map((i) => {
        const allVerifications: any[] = (i.kpis ?? []).flatMap(
          (k: any) => (k.verifications ?? []) as any[]
        );
        const latestUpdate = allVerifications.sort(
          (a, b) =>
            new Date(b.verified_at as string).getTime() -
            new Date(a.verified_at as string).getTime()
        )[0];
        return {
          id: i.id as string,
          title: i.title as string,
          theme: i.theme as string,
          mandate: mandateMap.get(i.mandate_id as string) ?? null,
          owner: i.owner as string,
          contributors: parseContributors(i.contributors),
          status: i.status as string,
          latest_update: latestUpdate
            ? { note: latestUpdate.note, reviewer: latestUpdate.reviewer, verdict: latestUpdate.verdict, date: latestUpdate.verified_at }
            : null,
          kpi_count: (i.kpis ?? []).length as number,
          updated_at: i.updated_at as string,
        };
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  // ── get_initiative_details ─────────────────────────────────────────────────
  server.tool(
    "get_initiative_details",
    "Get full details of a specific initiative including KPIs, execution steps, quarterly plans, and update history.",
    { initiative_id: z.string().describe("The initiative UUID") },
    async ({ initiative_id }) => {
      const initiative = await api<any>(`/api/initiatives/${initiative_id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(initiative, null, 2) }] };
    }
  );

  // ── search ─────────────────────────────────────────────────────────────────
  server.tool(
    "search",
    "Search for initiatives or mandates by title keyword.",
    {
      query: z.string().describe("Keyword to search for in initiative and mandate titles"),
      type: z.enum(["initiatives", "mandates", "both"]).default("both"),
    },
    async ({ query, type }) => {
      const q = query.toLowerCase().trim();
      const results: Record<string, any[]> = {};
      if (type === "initiatives" || type === "both") {
        const initiatives = await api<any[]>("/api/initiatives");
        results.initiatives = initiatives
          .filter((i) => (i.title as string ?? "").toLowerCase().includes(q))
          .map((i) => ({ id: i.id, title: i.title, status: i.status, owner: i.owner, theme: i.theme }));
      }
      if (type === "mandates" || type === "both") {
        const mandates = await api<any[]>("/api/mandates");
        results.mandates = mandates
          .filter((m) => (m.title as string ?? "").toLowerCase().includes(q))
          .map((m) => ({ id: m.id, title: m.title, status: m.status, owner: m.owner, theme: m.theme }));
      }
      const total = (results.initiatives?.length ?? 0) + (results.mandates?.length ?? 0);
      if (total === 0) {
        return { content: [{ type: "text" as const, text: `No results found for "${query}".` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  // ── submit_initiative_update ───────────────────────────────────────────────
  server.tool(
    "submit_initiative_update",
    "Submit a status update note for a specific initiative.",
    {
      initiative_id: z.string().describe("The initiative UUID"),
      note: z.string().describe("The update note to submit"),
      reviewer: z.string().default(DEFAULT_USER).describe("Name of the person submitting the update"),
    },
    async ({ initiative_id, note, reviewer }) => {
      const result = await api<any>(`/api/initiatives/${initiative_id}/updates`, {
        method: "POST",
        body: JSON.stringify({ note, reviewer }),
      });
      return { content: [{ type: "text" as const, text: `Update submitted.\n\n${JSON.stringify(result, null, 2)}` }] };
    }
  );

  // ── submit_mandate_status_update ───────────────────────────────────────────
  server.tool(
    "submit_mandate_status_update",
    "Submit a status update for a strategic mandate.",
    {
      mandate_id: z.string().describe("The mandate UUID"),
      status: z.enum(STATUS_VALUES).describe("New status for the mandate"),
      note: z.string().describe("Note explaining the status change"),
      actor_name: z.string().default(DEFAULT_USER).describe("Name of the person submitting the update"),
    },
    async ({ mandate_id, status, note, actor_name }) => {
      const result = await api<any>(`/api/mandates/${mandate_id}/status-updates`, {
        method: "POST",
        body: JSON.stringify({ status, note, actor_name }),
      });
      return { content: [{ type: "text" as const, text: `Mandate status updated to "${status}".\n\n${JSON.stringify(result, null, 2)}` }] };
    }
  );

  return server;
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (MODE === "http") {
  const app = express();
  app.use(express.json());

  // Auth middleware
  app.use((req, res, next) => {
    if (!API_KEY) { next(); return; }
    const auth = req.headers.authorization ?? "";
    if (auth === `Bearer ${API_KEY}`) { next(); return; }
    res.status(401).json({ error: "Unauthorized" });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", flywheel_url: BASE_URL });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.error(`Flywheel MCP server (HTTP) listening on port ${PORT}`);
    console.error(`Flywheel URL: ${BASE_URL}`);
  });
} else {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}
