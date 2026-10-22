import { HouseholdScreen } from "@/components/households/household-screen";

export const metadata = { title: "Unit" };

export default async function HouseholdPage({ params }: PageProps<"/households/[id]">) {
  const { id } = await params;
  return <HouseholdScreen householdId={id} />;
}
