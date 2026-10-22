import type { ReactNode } from "react";
import { AccountGate } from "@/components/shell/account-gate";
import { BottomNav } from "@/components/shell/bottom-nav";
import { LocalCopyKeeper } from "@/components/sync/local-copy-keeper";
import { PressFeedback } from "@/components/ui/press-feedback";
import { PwaPrompts } from "@/components/pwa/pwa-prompts";
import { ScreenTrailKeeper } from "@/components/shell/screen-trail-keeper";
import { SyncProvider } from "@/components/sync/sync-provider";
import { SyncStatusBar } from "@/components/sync/sync-status-bar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <PressFeedback />
      <ScreenTrailKeeper />
      <AccountGate>
        <LocalCopyKeeper />
        <SyncProvider>
          <main className="mx-auto w-full max-w-screen-sm px-4 pt-banner pb-nav">
            <SyncStatusBar />
            {children}
            {/* Inside main: an install banner too tall to float, or on a
                screen with a docked Save, is the last thing in the page. */}
            <PwaPrompts />
          </main>
          <BottomNav />
        </SyncProvider>
      </AccountGate>
    </div>
  );
}
