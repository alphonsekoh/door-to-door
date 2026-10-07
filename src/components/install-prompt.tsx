"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useReservedSpace } from "@/components/use-reserved-space";
import { classifyBrowser, INSTALL_GUIDES, installPathFor } from "@/lib/install-environment";
import type { InstallPath } from "@/lib/install-environment";
import {
  deriveInstallState,
  isRecordingRoute,
  isStandalone,
  readDismissedAt,
  clearInstalled,
  readInstalled,
  writeDismissedAt,
  writeInstalled,
} from "@/lib/install-prompt";
import { useRole } from "@/lib/use-role";
import { isPublicPath } from "@/server/auth/routes";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Environment = {
  path: InstallPath;
  standalone: boolean;
  installedFlag: boolean;
  dismissedAt: number | null;
  now: number;
};

function readEnvironment(): Environment {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    path: installPathFor(classifyBrowser(nav.userAgent, nav.maxTouchPoints)),
    standalone: isStandalone((query) => window.matchMedia(query), nav.standalone),
    installedFlag: readInstalled(localStorage),
    dismissedAt: readDismissedAt(localStorage),
    now: Date.now(),
  };
}

/*
 * Offers to install the app. It is always mounted, even on the sign-in screen,
 * because Chromium fires beforeinstallprompt once per page load: a listener
 * that only exists after signing in would miss it. It only draws once the
 * member is signed in, never on a public route, and never on the block screens
 * where the recording form's Save button sits just above the nav.
 */
export function InstallPrompt() {
  const pathname = usePathname();
  const { isSignedIn } = useRole();
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [hasDeferred, setHasDeferred] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const bannerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Deferred: React warns about state set synchronously inside an effect.
    const read = setTimeout(() => {
      setEnvironment(readEnvironment());
    }, 0);

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      clearInstalled(localStorage);
      setEnvironment((current) => (current ? { ...current, installedFlag: false } : current));
      setHasDeferred(true);
    };
    const onInstalled = () => {
      writeInstalled(localStorage);
      deferred.current = null;
      setHasDeferred(false);
      setEnvironment((current) => (current ? { ...current, installedFlag: true } : current));
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(read);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const eligible = environment !== null && isSignedIn && !isPublicPath(pathname);
  const state = eligible
    ? deriveInstallState({
        path: environment.path,
        hasDeferredPrompt: hasDeferred,
        standalone: environment.standalone,
        installedFlag: environment.installedFlag,
        dismissedAt: environment.dismissedAt,
        now: environment.now,
        recording: isRecordingRoute(pathname),
      })
    : null;
  const visible = state?.kind === "available" || state?.kind === "manual";
  useReservedSpace("--banner-bottom", bannerRef, visible);

  if (!state || (state.kind !== "available" && state.kind !== "manual")) return null;

  function dismiss() {
    const now = Date.now();
    writeDismissedAt(localStorage, now);
    setEnvironment((current) => (current ? { ...current, dismissedAt: now, now } : current));
  }

  async function install() {
    const event = deferred.current;
    if (!event) return;
    // The event can be used once; a second prompt() would throw.
    deferred.current = null;
    setHasDeferred(false);
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "dismissed") dismiss();
  }

  const copy =
    state.kind === "manual"
      ? INSTALL_GUIDES[state.guide]
      : {
          title: "Install Door to Door",
          steps: "Add it to your home screen to open it like an app.",
        };

  return (
    <aside
      ref={bannerRef}
      aria-label="Install the app"
      className="fixed inset-x-0 above-nav z-30 border-t border-border bg-surface px-4 py-3"
    >
      <div className="mx-auto flex max-w-screen-sm items-center gap-3">
        <div className="flex-1">
          <p className="text-body font-semibold">{copy.title}</p>
          <p className="text-caption text-foreground-muted">{copy.steps}</p>
        </div>
        {state.kind === "available" ? (
          <button
            type="button"
            onClick={() => {
              void install();
            }}
            className="min-h-11 rounded-lg bg-primary px-4 text-body font-semibold text-primary-foreground"
          >
            Install
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 rounded-lg px-3 text-body text-foreground-muted"
        >
          {state.kind === "manual" ? "Got it" : "Not now"}
        </button>
      </div>
    </aside>
  );
}
