import type { User } from "@/generated/types.gen";
import type { UserRow } from "@/server/users/service";

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    role: row.role,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    lastRecordedAt: row.lastRecordedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
