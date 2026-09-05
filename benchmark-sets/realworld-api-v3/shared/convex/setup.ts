import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const clear = mutation({ args: { limit: v.optional(v.number()) }, handler: async (ctx, args) => { const limit = Math.max(1, Math.min(500, args.limit ?? 100)); let total = 0; for (const table of ["authSessions", "activities", "comments", "tasks", "projects", "memberships", "organizations", "users"]) { const rows = await ctx.db.query(table as any).take(limit); for (const row of rows) { await ctx.db.delete(row._id); total++; } } return total; }});
export const seed = mutation({ args: { entity: v.string(), records: v.array(v.any()) }, handler: async (ctx, args) => {
  const table = args.entity === "user" ? "users" : args.entity === "activity" ? "activities" : `${args.entity}s`;
  for (const record of args.records as any[]) await ctx.db.insert(table as any, record);
  return args.records.length;
}});
