import { clearServiceWorkerCaches } from "@/lib/sw-client";

/*
 * Leaving the app on a phone somebody else may pick up next.
 *
 * The cached block list is cleared first: if the sign-out request then fails
 * the member stays signed in having lost nothing but a cache, whereas the
 * other order could leave a signed-out phone still holding the list.
 */
export async function signOutAndForget(
  signOut: (options: { redirectTo: string }) => Promise<unknown>,
): Promise<void> {
  await clearServiceWorkerCaches();
  await signOut({ redirectTo: "/sign-in" });
}
