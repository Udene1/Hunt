import { prisma, databaseConfigured } from "./db";

export async function auditEvent(input: {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  if (!databaseConfigured()) return;
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId || null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId || null,
        metadata: input.metadata || undefined,
      },
    });
  } catch {
    // Audit failure must never turn a successful product action into a failed request.
  }
}
