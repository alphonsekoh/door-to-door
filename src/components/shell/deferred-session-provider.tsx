"use client";

import {
  SessionContext,
  SessionProvider,
  type SessionContextValue,
  useSession,
} from "next-auth/react";
import { type ReactNode, startTransition, useEffect, useState } from "react";

/* What Auth.js's provider holds until the server has answered: the same in
   the server's HTML and while hydrating. Its update does nothing then. */
const ASKING: SessionContextValue = {
  data: null,
  status: "loading",
  update: () => Promise.resolve(null),
};

function Relay({ onChange }: { onChange: (value: SessionContextValue) => void }) {
  const value = useSession();
  useEffect(() => {
    startTransition(() => {
      onChange(value);
    });
  }, [value, onChange]);
  return null;
}

/*
 * Auth.js's session, handed to the app as a transition (#113). On weak
 * signal a screen's own script can arrive after the shell's, so React
 * hydrates the shell and leaves the screen as the server's HTML, typed into.
 * An urgent change to a context above that screen, such as the session
 * answering, makes React throw the HTML away and draw the loading screen in
 * its place, losing what was typed. A transition waits for the screen to
 * hydrate. Auth.js's provider sets its state urgently, so it sits beside
 * the app rather than round it, and only this provider is above the screen.
 * Handing it the server's session instead would make every page dynamic,
 * the offline page included (D-77-7).
 */
export function DeferredSessionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SessionContextValue>(ASKING);
  return (
    <>
      <SessionProvider>
        <Relay onChange={setValue} />
      </SessionProvider>
      <SessionContext value={value}>{children}</SessionContext>
    </>
  );
}
