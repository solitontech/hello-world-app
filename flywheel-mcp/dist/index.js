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
import express from "express";
import { z } from "zod";
const BASE_URL = (process.env.FLYWHEEL_URL ?? "http://localhost:5500").replace(/\/$/, "");
const MODE = process.env.MCP_MODE ?? "stdio";
const PORT = parseInt(process.env.PORT ?? "5501", 10);
const API_KEY = process.env.MCP_API_KEY ?? "";
const DEFAULT_USER = process.env.FLYWHEEL_USER ?? process.env.USER ?? process.env.USERNAME ?? "Team";
// ─── Helpers ──────────────────────────────────────────────────────────────────
async function api(path, options) {
    const res = await fetch(`${BASE_URL}${path}`, {
        headers: { "Content-Type": "application/json", ...options?.headers },
        ...options,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Flywheel API ${res.status} on ${path}: ${text || res.statusText}`);
    }
    return res.json();
}
function parseContributors(raw) {
    if (Array.isArray(raw))
        return raw;
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    return [];
}
function nameMatches(name, query) {
    return name.toLowerCase().includes(query.toLowerCase().trim());
}
const STATUS_VALUES = ["Not Started", "On Track", "At Risk", "Blocked", "Completed"];
// ─── Server factory (one per request in HTTP mode) ───────────────────────────
function createServer() {
    const server = new McpServer({ name: "flywheel", version: "1.0.0" });
    // ── list_all_mandates ──────────────────────────────────────────────────────
    server.tool("list_all_mandates", "List all strategic mandates with their current status, owner, theme, and initiative count.", {}, async () => {
        const [mandates, initiatives] = await Promise.all([
            api("/api/mandates"),
            api("/api/initiatives"),
        ]);
        const summary = mandates.map((m) => ({
            id: m.id,
            title: m.title,
            theme: m.theme,
            owner: m.owner,
            contributors: parseContributors(m.contributors),
            status: m.status,
            initiative_count: initiatives.filter((i) => i.mandate_id === m.id).length,
            updated_at: m.updated_at,
        }));
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    });
    // ── get_person_initiatives ─────────────────────────────────────────────────
    server.tool("get_person_initiatives", "Get all initiatives owned by or contributed to by a specific person, with current status and most recent update note.", {
        person_name: z.string().describe("Display name of the person (e.g. 'Saranya', 'Vijay'). Partial names work, case-insensitive."),
    }, async ({ person_name }) => {
        const [initiatives, mandates] = await Promise.all([
            api("/api/initiatives"),
            api("/api/mandates"),
        ]);
        const mandateMap = new Map(mandates.map((m) => [m.id, m.title]));
        const matched = initiatives.filter((i) => {
            const ownerMatch = nameMatches(i.owner ?? "", person_name);
            const contribMatch = parseContributors(i.contributors).some((c) => nameMatches(c, person_name));
            return ownerMatch || contribMatch;
        });
        if (matched.length === 0) {
            return {
                content: [{
                        type: "text",
                        text: `No initiatives found for "${person_name}". Known people: Saranya, Vijay, Manikanta, Sandeep, Uthra, Adarsh, Srividhya, Ilakkia, Saradha, Santhosh, Navin, Vishnu, Nishanth, Saravana, Naveen, Gova.`,
                    }],
            };
        }
        const enriched = matched.map((i) => {
            const allVerifications = (i.kpis ?? []).flatMap((k) => (k.verifications ?? []));
            const latestUpdate = allVerifications.sort((a, b) => new Date(b.verified_at).getTime() -
                new Date(a.verified_at).getTime())[0];
            return {
                id: i.id,
                title: i.title,
                theme: i.theme,
                mandate: mandateMap.get(i.mandate_id) ?? null,
                owner: i.owner,
                contributors: parseContributors(i.contributors),
                status: i.status,
                latest_update: latestUpdate
                    ? { note: latestUpdate.note, reviewer: latestUpdate.reviewer, verdict: latestUpdate.verdict, date: latestUpdate.verified_at }
                    : null,
                kpi_count: (i.kpis ?? []).length,
                updated_at: i.updated_at,
            };
        });
        return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    });
    // ── get_initiative_details ─────────────────────────────────────────────────
    server.tool("get_initiative_details", "Get full details of a specific initiative including KPIs, execution steps, quarterly plans, and update history.", { initiative_id: z.string().describe("The initiative UUID") }, async ({ initiative_id }) => {
        const initiative = await api(`/api/initiatives/${initiative_id}`);
        return { content: [{ type: "text", text: JSON.stringify(initiative, null, 2) }] };
    });
    // ── search ─────────────────────────────────────────────────────────────────
    server.tool("search", "Search for initiatives or mandates by title keyword.", {
        query: z.string().describe("Keyword to search for in initiative and mandate titles"),
        type: z.enum(["initiatives", "mandates", "both"]).default("both"),
    }, async ({ query, type }) => {
        const q = query.toLowerCase().trim();
        const results = {};
        if (type === "initiatives" || type === "both") {
            const initiatives = await api("/api/initiatives");
            results.initiatives = initiatives
                .filter((i) => (i.title ?? "").toLowerCase().includes(q))
                .map((i) => ({ id: i.id, title: i.title, status: i.status, owner: i.owner, theme: i.theme }));
        }
        if (type === "mandates" || type === "both") {
            const mandates = await api("/api/mandates");
            results.mandates = mandates
                .filter((m) => (m.title ?? "").toLowerCase().includes(q))
                .map((m) => ({ id: m.id, title: m.title, status: m.status, owner: m.owner, theme: m.theme }));
        }
        const total = (results.initiatives?.length ?? 0) + (results.mandates?.length ?? 0);
        if (total === 0) {
            return { content: [{ type: "text", text: `No results found for "${query}".` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    });
    // ── submit_initiative_update ───────────────────────────────────────────────
    server.tool("submit_initiative_update", "Submit a status update note for a specific initiative.", {
        initiative_id: z.string().describe("The initiative UUID"),
        note: z.string().describe("The update note to submit"),
        reviewer: z.string().default(DEFAULT_USER).describe("Name of the person submitting the update"),
    }, async ({ initiative_id, note, reviewer }) => {
        const result = await api(`/api/initiatives/${initiative_id}/updates`, {
            method: "POST",
            body: JSON.stringify({ note, reviewer }),
        });
        return { content: [{ type: "text", text: `Update submitted.\n\n${JSON.stringify(result, null, 2)}` }] };
    });
    // ── submit_mandate_status_update ───────────────────────────────────────────
    server.tool("submit_mandate_status_update", "Submit a status update for a strategic mandate.", {
        mandate_id: z.string().describe("The mandate UUID"),
        status: z.enum(STATUS_VALUES).describe("New status for the mandate"),
        note: z.string().describe("Note explaining the status change"),
        actor_name: z.string().default(DEFAULT_USER).describe("Name of the person submitting the update"),
    }, async ({ mandate_id, status, note, actor_name }) => {
        const result = await api(`/api/mandates/${mandate_id}/status-updates`, {
            method: "POST",
            body: JSON.stringify({ status, note, actor_name }),
        });
        return { content: [{ type: "text", text: `Mandate status updated to "${status}".\n\n${JSON.stringify(result, null, 2)}` }] };
    });
    return server;
}
// ─── Start ────────────────────────────────────────────────────────────────────
if (MODE === "http") {
    const app = express();
    app.use(express.json());
    // Auth middleware
    app.use((req, res, next) => {
        if (!API_KEY) {
            next();
            return;
        }
        const auth = req.headers.authorization ?? "";
        if (auth === `Bearer ${API_KEY}`) {
            next();
            return;
        }
        res.status(401).json({ error: "Unauthorized" });
    });
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", flywheel_url: BASE_URL });
    });
    app.post("/mcp", async (req, res) => {
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
}
else {
    const transport = new StdioServerTransport();
    await createServer().connect(transport);
}
