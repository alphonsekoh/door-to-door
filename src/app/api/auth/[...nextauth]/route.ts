import { handlers } from "@/auth";
import { withAuthRouteHeaders } from "@/server/auth/route-headers";

export const GET = withAuthRouteHeaders(handlers.GET);
export const POST = withAuthRouteHeaders(handlers.POST);
