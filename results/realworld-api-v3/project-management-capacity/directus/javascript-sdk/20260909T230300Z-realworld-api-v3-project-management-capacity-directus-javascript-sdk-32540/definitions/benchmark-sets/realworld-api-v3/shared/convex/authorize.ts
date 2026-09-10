export async function requireIdentity(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) throw new Error("authentication required");
  return identity.subject as string;
}

export async function requireMember(ctx: any, organizationId: string) {
  const subject = await requireIdentity(ctx);
  const membership = await ctx.db.query("memberships").withIndex("by_user_organization", (q: any) => q.eq("userId", subject).eq("organizationId", organizationId)).unique();
  if (!membership) throw new Error("organization access denied");
  return membership;
}

export async function requireManager(ctx: any, organizationId: string) {
  const membership = await requireMember(ctx, organizationId);
  if (membership.role !== "owner" && membership.role !== "admin") throw new Error("manager access denied");
  return membership;
}
