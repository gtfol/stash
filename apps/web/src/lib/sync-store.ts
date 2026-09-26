"use client";

import { create } from "zustand";
import { authClient } from "./auth-client";
import { useLibrary } from "./library";
import { accountSpace, GUEST_SPACE, importGuestOnce, subscribeToChanges } from "./local-db";
import { fetchTransport, SignedOutError, syncAccount } from "./sync-client";

// Sign-in and sync state, following capsule's sync store: signing in copies this browser's guest
// links into the account once, local changes sync shortly after they're made, and signing out
// returns to the guest library. An expired session keeps the account's links usable offline here.

export type SyncStatus = "loading" | "disabled" | "signed-out" | "idle" | "syncing" | "offline" | "error";
export interface SyncUser { id: string; email: string; name: string }

interface SyncState {
  enabled: boolean;
  status: SyncStatus;
  user: SyncUser | null;
  error: string | null;
  lastSyncAt: number | null;
  initialize: () => Promise<void>;
  refreshSession: () => Promise<void>;
  syncNow: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

let initialized: Promise<void> | null = null;
let listening = false;
let running: Promise<void> | null = null;
let refreshing: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionGeneration = 0;
const offlineOr = (fallback: SyncStatus): SyncStatus => navigator.onLine ? fallback : "offline";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Sync couldn’t finish. Your links are saved in this browser.";

export const useSync = create<SyncState>((set, get) => {
  function listen() {
    if (listening) return;
    listening = true;
    const refresh = () => { if (document.visibilityState === "visible") void (get().enabled ? get().refreshSession() : get().initialize()); };
    window.addEventListener("online", () => void (get().enabled ? get().refreshSession() : get().initialize()));
    window.addEventListener("offline", () => { if (get().user) set({ status: "offline" }); });
    document.addEventListener("visibilitychange", refresh);
    setInterval(refresh, 60_000);
    subscribeToChanges((space, source) => {
      const user = get().user;
      if (source === "remote" || !user || space !== accountSpace(user.id)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().syncNow(), 1_500);
    });
  }

  return {
    enabled: false, status: "loading", user: null, error: null, lastSyncAt: null,

    initialize: () => {
      listen();
      if (initialized) return initialized;
      initialized = (async () => {
        await useLibrary.getState().initialize();
        try {
          const response = await fetch("/api/sync/status", { cache: "no-store" });
          if (!response.ok) throw new Error("Couldn’t check sync.");
          const enabled = (await response.json() as { enabled?: unknown }).enabled === true;
          set({ enabled, status: enabled ? "signed-out" : "disabled" });
          if (enabled) await get().refreshSession();
        } catch {
          set({ status: offlineOr("error"), error: "Sync is unavailable right now. Your links are saved in this browser." });
          initialized = null;
        }
      })();
      return initialized;
    },

    refreshSession: () => {
      if (refreshing) return refreshing;
      let generation = sessionGeneration;
      refreshing = (async () => {
        if (!get().enabled) return;
        if (!navigator.onLine) { set({ status: "offline" }); return; }
        try {
          const { data, error } = await authClient.getSession({ query: { disableCookieCache: true } });
          if (generation !== sessionGeneration) return;
          if (error) throw new Error(error.message || "Couldn’t check your sign-in.");
          if (data?.user) {
            const user = { id: data.user.id, email: data.user.email, name: data.user.name ?? "" };
            if (get().user?.id !== user.id) sessionGeneration++;
            generation = sessionGeneration;
            await importGuestOnce(user.id);
            if (generation !== sessionGeneration) return;
            await useLibrary.getState().switchSpace(accountSpace(user.id));
            if (generation !== sessionGeneration) return;
            set({ user, status: "idle", error: null });
            await get().syncNow();
          } else {
            sessionGeneration++;
            set({ user: null, status: "signed-out", lastSyncAt: null, error: null });
          }
        } catch (error) {
          if (generation === sessionGeneration) set({ status: offlineOr("error"), error: errorText(error) });
        }
      })().finally(() => { refreshing = null; });
      return refreshing;
    },

    syncNow: () => {
      if (running) return running.then(() => (get().user ? get().syncNow() : undefined));
      const user = get().user;
      if (!user || !get().enabled) return Promise.resolve();
      if (!navigator.onLine) { set({ status: "offline" }); return Promise.resolve(); }
      const generation = sessionGeneration;
      const current = () => generation === sessionGeneration && get().user?.id === user.id;
      running = (async () => {
        set({ status: "syncing", error: null });
        try {
          // One tab at a time per account; the server's revisions protect browsers without locks.
          const exchange = () => syncAccount(user.id, fetchTransport, current);
          if (navigator.locks) await navigator.locks.request(`stash-sync:${user.id}`, exchange);
          else await exchange();
          if (current()) set({ status: "idle", lastSyncAt: Date.now(), error: null });
        } catch (error) {
          if (!current()) return;
          if (error instanceof SignedOutError) {
            sessionGeneration++;
            set({ user: null, status: "signed-out", error: "Sign in again to keep syncing." });
          } else {
            set({ status: offlineOr("error"), error: errorText(error) });
          }
        }
      })().finally(() => { running = null; });
      return running;
    },

    signIn: async () => {
      set({ error: null });
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
      if (error) set({ status: "error", error: error.message || "Couldn’t start sign-in. Try again." });
    },

    signOut: async () => {
      try {
        const { error } = await authClient.signOut();
        if (error) throw new Error(error.message || "Couldn’t sign out. Try again.");
        sessionGeneration++;
        set({ user: null, status: "signed-out", lastSyncAt: null, error: null });
        await useLibrary.getState().switchSpace(GUEST_SPACE);
      } catch (error) {
        set({ error: errorText(error) });
      }
    },
  };
});
