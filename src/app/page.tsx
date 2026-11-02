import { ActiveSessionScreen } from "@/components/sessions/active-session";

/* The header is the screen's own: what it asks of a member depends on the
   kind of session running. */
export default function SessionPage() {
  return <ActiveSessionScreen />;
}
