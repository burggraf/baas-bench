import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const timestamps = { createdAt: v.number(), updatedAt: v.number() };
const tenant = { organizationId: v.string() };
export default defineSchema({
  users: defineTable({ id: v.string(), authSubject: v.string(), email: v.string(), displayName: v.string(), ...timestamps }).index("by_id", ["id"]).index("by_email", ["email"]).index("by_auth_subject", ["authSubject"]),
  organizations: defineTable({ id: v.string(), name: v.string(), ownerId: v.string(), createdAt: v.number() }).index("by_id", ["id"]),
  memberships: defineTable({ id: v.string(), ...tenant, userId: v.string(), role: v.string(), createdAt: v.number() }).index("by_organization", ["organizationId"]).index("by_user_organization", ["userId", "organizationId"]),
  projects: defineTable({ id: v.string(), ...tenant, name: v.string(), status: v.string(), ...timestamps }).index("by_organization", ["organizationId", "createdAt", "id"]),
  tasks: defineTable({ id: v.string(), ...tenant, projectId: v.string(), creatorId: v.string(), assigneeId: v.optional(v.union(v.string(), v.null())), title: v.string(), description: v.string(), status: v.string(), priority: v.string(), dueDate: v.optional(v.union(v.number(), v.null())), ...timestamps }).index("by_project", ["organizationId", "projectId", "createdAt", "id"]).index("by_assignee", ["organizationId", "assigneeId"]),
  comments: defineTable({ id: v.string(), ...tenant, projectId: v.string(), taskId: v.string(), authorId: v.string(), body: v.string(), ...timestamps }).index("by_task", ["organizationId", "projectId", "taskId", "createdAt", "id"]),
  activities: defineTable({ id: v.string(), ...tenant, projectId: v.union(v.string(), v.null()), actorId: v.string(), action: v.string(), subjectType: v.string(), subjectId: v.string(), createdAt: v.number() }).index("by_project", ["organizationId", "projectId", "createdAt", "id"]),
  authSessions: defineTable({ token: v.string(), userId: v.string(), expiresAt: v.number() }).index("by_token", ["token"]),
});
