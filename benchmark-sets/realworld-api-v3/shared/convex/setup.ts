import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const seed = mutation({ args: { entity: v.string(), records: v.array(v.any()) }, handler: async (ctx, args) => {
  const table = args.entity === "user" ? "users" : `${args.entity}s`;
  for (const record of args.records as any[]) await ctx.db.insert(table as any, record);
  return args.records.length;
});
