import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  guestbook: defineTable({
    author: v.string(),
    message: v.string(),
    created_at: v.number(),
    fixture_key: v.union(v.number(), v.null()),
  })
    .index("by_created_at", ["created_at"])
    .index("by_fixture_key", ["fixture_key"]),
});
