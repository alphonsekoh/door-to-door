"use client";

import { useParams } from "next/navigation";
import { HouseholdScreen } from "@/components/households/household-screen";

/* The unit in the address, read here so the page itself reads nothing per
   request and is served as a static shell (#252). */
export function HouseholdRoute() {
  const { id } = useParams<{ id: string }>();
  return <HouseholdScreen householdId={id} />;
}
