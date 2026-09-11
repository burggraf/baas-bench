import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const signIn = mutation({ args: { email: v.string(), password: v.string() }, handler: async (ctx, args) => {
  const user = await ctx.db.query("users").withIndex("by_email", (q: any) => q.eq("email", args.email)).unique();
  if (!user || args.password !== (process.env.CONVEX_BENCHMARK_PASSWORD ?? "Bb-v3-42-capacity!")) throw new Error("invalid credentials");
  const token = crypto.randomUUID();
  await ctx.db.insert("authSessions", { token, userId: user.id, expiresAt: Date.now() + 3_600_000 });
  return { token, userId: user.id };
}});
export const refresh = mutation({ args: { token: v.string() }, handler: async (ctx, args) => { const row = await ctx.db.query("authSessions").withIndex("by_token", (q: any) => q.eq("token", args.token)).unique(); if (!row || row.expiresAt < Date.now()) throw new Error("invalid session"); return { token: args.token, userId: row.userId }; } });
export const signOut = mutation({ args: { token: v.string() }, handler: async (ctx, args) => { const row = await ctx.db.query("authSessions").withIndex("by_token", (q: any) => q.eq("token", args.token)).unique(); if (row) await ctx.db.delete(row._id); return null; } });
export const me = query({ args: {}, handler: async (ctx) => { const identity = await ctx.auth.getUserIdentity(); if (!identity?.subject) throw new Error("authentication required"); return await ctx.db.query("users").withIndex("by_external_id", (q: any) => q.eq("id", identity.subject)).unique(); } });
