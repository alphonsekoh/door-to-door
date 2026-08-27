import type { Block } from "@/generated/types.gen";
import type { BlockRow } from "@/server/blocks/service";

export function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    name: row.name,
    street: row.street,
    postalCode: row.postalCode,
    createdAt: row.createdAt.toISOString(),
  };
}
