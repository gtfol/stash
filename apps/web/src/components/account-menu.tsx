"use client";

import { useEffect, useRef, useState } from "react";
import { useSync, type SyncStatus } from "@/lib/sync-store";

// Sign-in and sync, behind one quiet control in the header. Links always save in this browser
// first; signing in adds them to your account and keeps every signed-in browser in step.

function statusLine(status: SyncStatus, lastSyncAt: number | null, error: string | null): string {
  switch (status) {
    case "syncing": return "syncing…";
    case "offline": return "offline. changes will sync when you’re back online.";
    case "error": return error ?? "sync couldn’t finish. your links are saved in this browser.";
    case "idle": return lastSyncAt ? "synced." : "signed in.";
    default: return "";
  }
}

export function AccountMenu() {
  const { enabled, status, user, error, lastSyncAt, signIn, signOut, syncNow } = useSync();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  if (status === "loading") return <span className="h-11" />;
  const label = user ? (status === "syncing" ? "syncing…" : status === "offline" ? "offline" : status === "error" ? "sync paused" : "synced") : enabled ? "sign in" : "this browser";

  return (
    <div ref={root} className="relative">
      <button
        type="button" aria-expanded={open} aria-controls="account-panel" onClick={() => setOpen(!open)}
        className={`-mr-3 h-11 px-3 text-[13px] hover:text-strong ${status === "error" ? "text-caution" : "text-muted"}`}
      >
        {label}
      </button>
      {open ? (
        <div id="account-panel" className="absolute right-0 top-12 z-20 w-[min(calc(100vw-40px),300px)] space-y-3 border border-line bg-raised p-5 text-[13px] leading-relaxed">
          {!enabled ? (
            <p className="text-muted">links are saved in this browser. sync isn’t set up on this site.</p>
          ) : user ? (
            <>
              <div>
                <p className="truncate text-ink">{user.email}</p>
                <p className={status === "error" ? "text-caution" : "text-muted"} aria-live="polite">{statusLine(status, lastSyncAt, error)}</p>
              </div>
              <div className="flex gap-5">
                <button type="button" className="h-11 hover:text-strong disabled:text-muted" disabled={status === "syncing"} onClick={() => void syncNow()}>sync now</button>
                <button type="button" className="h-11 text-muted hover:text-strong" onClick={() => void signOut().then(() => setOpen(false))}>sign out</button>
              </div>
              <p className="text-muted">signing out shows this browser’s own links. your account keeps its links.</p>
            </>
          ) : (
            <>
              <p className="text-muted">
                {error ?? "links are saved in this browser. sign in to keep them on every device."}
              </p>
              <button
                type="button" disabled={busy}
                className="flex h-11 w-full items-center justify-center bg-ink text-canvas hover:bg-strong disabled:opacity-60"
                onClick={() => { setBusy(true); void signIn().finally(() => setBusy(false)); }}
              >
                continue with google
              </button>
              <p className="text-muted">the first account to sign in on this browser gets the links already saved here.</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
