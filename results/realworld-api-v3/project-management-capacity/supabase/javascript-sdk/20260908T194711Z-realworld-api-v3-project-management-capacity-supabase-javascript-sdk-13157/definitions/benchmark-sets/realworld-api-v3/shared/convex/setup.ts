import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const clear = mutation({ args: { limit: v.optional(v.number()) }, handler: async (ctx, args) => { const limit = Math.max(1, Math.min(500, args.limit ?? 100)); let total = 0; for (const table of ["authSessions", "activities", "comments", "tasks", "projects", "memberships", "organizations", "users"]) { const rows = await ctx.db.query(table as any).take(limit); for (const row of rows) { await ctx.db.delete(row._id); total++; } } return total; }});
export const verify = query({ args: {}, handler: async (ctx) => { const expected: Record<string, [string, string]> = { organizations: ['orgv300000000000', 'orgv30000000018f'], users: ['usrv300000000000', 'usrv300000000ccf'], memberships: ['memv300000000000', 'memv300000000ccf'], projects: ['prjv300000000000', 'prjv300000000667'], tasks: ['tskv300000000000', 'tskv300000003fgf'], comments: ['cmtv300000000000', 'cmtv30000000a9r3'], activities: ['actv300000000000', 'actv300000006uan'] }; for (const [table, ids] of Object.entries(expected)) for (const id of ids) { const row = await ctx.db.query(table as any).withIndex('by_external_id', (q: any) => q.eq('id', id)).first(); if (!row) throw new Error(`${table} sentinel ${id} is missing`); } return true; }});
export const seed = mutation({ args: { entity: v.string(), records: v.array(v.any()) }, handler: async (ctx, args) => {
  const table = args.entity === "user" ? "users" : args.entity === "activity" ? "activities" : `${args.entity}s`;
  for (const record of args.records as any[]) await ctx.db.insert(table as any, record);
  return args.records.length;
}});
