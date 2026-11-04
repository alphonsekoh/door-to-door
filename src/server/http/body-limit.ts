/*
 * How large a request body may be (#126). Memory guards derived from the
 * contract, not policy, so constants rather than config keys (as D-120-3).
 * next.config.ts reads the proxy's cut from here, so this file imports nothing.
 *
 * No body any operation accepts reaches the default; a sync batch of 100
 * records at every maxLength, written in 3-byte characters, is about 1.25 MiB.
 */
export const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024;
export const SYNC_BODY_LIMIT_BYTES = 1.5 * 1024 * 1024;

/*
 * Next buffers at most this much of a body for the proxy and cuts the rest
 * rather than refusing it (D-120-7). Kept well above the sync cap, so a cut
 * body is still over its cap and answered 413 rather than parsed short.
 */
export const PROXY_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
