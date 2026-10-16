import type { ReactNode } from "react";
import { AccountGate } from "@/components/account-gate";
import { BottomNav } from "@/components/bottom-nav";
import { PwaPrompts } from "@/components/pwa-prompts";
import { SyncProvider } from "@/components/sync-provider";
import { SyncStatusBar } from "@/components/sync-status-bar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <AccountGate>
        <SyncProvider>
          <main className="mx-auto w-full max-w-screen-sm px-4 pt-banner pb-nav">
            <SyncStatusBar />
            {children}
          </main>
          <PwaPrompts />
          <BottomNav />
        </SyncProvider>
      </AccountGate>
    </div>
  );
}
