/*
 * How long a session cookie lives: sliding, since every answer the proxy
 * passes re-issues it for this long again. Its own module so the sign-in
 * check can use it without loading Auth.js.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
