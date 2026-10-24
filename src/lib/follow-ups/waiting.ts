import { firstName } from "@/lib/session/own-name";

/*
 * Said to a member where reopening a note would leave it owed beside a
 * suggestion still waiting at the door. One sentence for the server's
 * refusal and the screen's caption, so the two name the suggester alike.
 */
export function waitingSentence({ name, mine }: { name: string | null; mine: boolean }): string {
  const whose = mine ? "Your" : `${firstName(name)}'s`;
  return `${whose} suggestion for this door is waiting for an admin. Ask an admin to review it.`;
}
