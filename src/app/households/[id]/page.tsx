import { HouseholdRoute } from "@/components/households/household-route";

export const metadata = { title: "Unit" };

/* No unit is known at build time. Each unit's page is drawn the first time
   it is asked for, then kept: the screen reads its unit on the client, so
   nothing in the page is per request or per member (#252). */
export function generateStaticParams(): { id: string }[] {
  return [];
}

export default function HouseholdPage() {
  return <HouseholdRoute />;
}
