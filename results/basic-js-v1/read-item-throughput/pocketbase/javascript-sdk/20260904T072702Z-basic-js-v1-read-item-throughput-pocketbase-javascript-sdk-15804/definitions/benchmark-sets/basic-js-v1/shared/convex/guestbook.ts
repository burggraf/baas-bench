import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function shape(row: { _id: string; author: string; message: string; created_at: number }) {
  return {
    id: row._id,
    author: row.author,
    message: row.message,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("guestbook").withIndex("by_created_at").order("desc").take(20)).map(shape),
});

export const get = query({
  args: { id: v.id("guestbook") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    return row === null ? null : shape(row);
  },
});

export const create = mutation({
  args: { author: v.string(), message: v.string() },
  handler: async (ctx, { author, message }) => {
    if (author.length < 1 || author.length > 32) throw new Error("invalid author");
    if (message.length < 1 || message.length > 256) throw new Error("invalid message");
    return ctx.db.insert("guestbook", { author, message, created_at: Date.now(), fixture_key: null });
  },
});
