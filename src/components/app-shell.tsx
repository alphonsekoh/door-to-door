import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <main className="mx-auto w-full max-w-screen-sm px-4 pt-4 pb-nav">{children}</main>
      <BottomNav />
    </div>
  );
}
