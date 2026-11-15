import { PageHeader } from "@/components/ui/page-header";

/*
 * Shown the moment a block is tapped, so the navigation commits on the first
 * frame instead of the Session screen sitting unchanged while the route
 * loads in poor signal.
 */
export default function BlockLoading() {
  return (
    <div aria-busy="true">
      <PageHeader
        title="Record a visit"
        subtitle="One unit at a time."
        back={{ href: "/", label: "Session" }}
        inline
        standIn
      />
      <p className="text-body text-foreground-muted">Loading the block…</p>
    </div>
  );
}
