/*
 * The seeded accounts and where their saved sessions live.
 *
 * Kept apart from the specs so a spec never has to know a password, and so
 * global-setup and the fixtures agree on one set of paths.
 */

export const SEED_ADMIN = "admin@example.com";
export const SEED_MEMBER = "alice@example.com";
export const SEED_PARTNER = "ben@example.com";
export const SEED_PASSWORD = "password123";

export const ADMIN_STATE = "e2e/.auth/admin.json";
export const MEMBER_STATE = "e2e/.auth/member.json";
export const PARTNER_STATE = "e2e/.auth/partner.json";

/* Block 123, Ang Mo Kio Ave 3, from the seed. */
export const SEED_BLOCK = "00000000-0000-4000-8001-000000000001";
