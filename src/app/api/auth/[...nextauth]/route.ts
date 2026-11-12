import { handlers } from "@/auth";
import { withAuthRouteHeaders } from "@/server/auth/route-headers";
import { failUnendedSignOut } from "@/server/auth/sign-out";

export const GET = withAuthRouteHeaders(handlers.GET);
export const POST = withAuthRouteHeaders(failUnendedSignOut(handlers.POST));
