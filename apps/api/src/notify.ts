import { prisma } from "@sk/db";

export type NotifInput = {
  type: string;
  title: string;
  body: string;
  section: string;
  orderId?: number | null;
};

// Create one notification per recipient user.
export async function notifyUsers(userIds: number[], n: NotifInput) {
  const ids = [...new Set(userIds.filter((x): x is number => !!x))];
  if (ids.length === 0) return;
  await prisma.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      section: n.section,
      orderId: n.orderId ?? null,
    })),
  });
}

// Fan out to every active user holding one of the given roles.
export async function notifyRoles(roles: string[], n: NotifInput) {
  const users = await prisma.user.findMany({
    where: { role: { in: roles as any }, active: true, deletedAt: null },
    select: { id: true },
  });
  await notifyUsers(users.map((u) => u.id), n);
}
