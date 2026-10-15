import type { ReactNode } from "react";
import { AccountGate } from "@/components/account-gate";
import { BottomNav } from "@/components/bottom-nav";
import { PwaPrompts } from "@/components/pwa-prompts";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <AccountGate>
        <main className="mx-auto w-full max-w-screen-sm px-4 pt-banner pb-nav">{children}</main>
        <PwaPrompts />
        <BottomNav />
      </AccountGate>
    </div>
  );
}
