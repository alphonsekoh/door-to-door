import type { User, UserList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * Every active user, a page at a time. Pickers built from one page of 100
 * would quietly leave out the 101st person; this walks until the server says
 * there is no more (or a page comes back empty, so a miscounting server
 * cannot loop it forever).
 */
export async function loadAllUsers(pageSize = 100): Promise<User[]> {
  const users: User[] = [];
  for (;;) {
    const page = await apiFetch<UserList>(
      `/users?limit=${String(pageSize)}&offset=${String(users.length)}`,
    );
    users.push(...page.data);
    if (!page.pagination.hasMore || page.data.length === 0) return users;
  }
}
