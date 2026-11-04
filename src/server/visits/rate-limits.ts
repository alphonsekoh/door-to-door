import { createRateLimiter } from "@/server/auth/rate-limit";

/*
 * Per member, per process (D-21-6, D-126-8). Here rather than in the routes,
 * which may export only their handlers, so tests can reset them.
 */

/*
 * A queue flush is a burst, not a stream: generous per member, but bounded so
 * one client cannot hammer the database on a retry loop.
 */
export const syncLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/*
 * A direct save is the queue's fallback, so it has its own budget: neither may
 * starve the other. Charged to the caller, so an admin recording on a
 * member's behalf spends the admin's.
 */
export const recordLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
