import type { DefaultSession } from "next-auth";
import type { Role } from "@/db/schema";

/*
 * Puts role and deactivation on the session and token, so authorization checks
 * are typed rather than reaching through `any`.
 *
 * Declaration merging only works with `interface`, so the project's
 * type-over-interface rule cannot apply in this file.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions */

declare module "next-auth" {
  interface Session {
    /* The sign-in's server-side record (#125); resolveSession checks it. */
    signInId?: string;
    user: {
      id: string;
      role: Role;
      deactivated: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    deactivatedAt?: Date | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    deactivated?: boolean;
    signInId?: string;
  }
}
