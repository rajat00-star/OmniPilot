import { useEffect, useState, useSyncExternalStore } from "react";

/** Viewer preferences kept in this browser only. Sound starts off; effects start full. */
export interface Prefs {
  sound: boolean;
  effects: "full" | "reduced";
}

const KEY = "omnipilot:prefs";
const DEFAULTS: Prefs = { sound: false, effects: "full" };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return { sound: parsed.sound === true, effects: parsed.effects === "reduced" ? "reduced" : "full" };
  } catch {
    return DEFAULTS;
  }
}

let state: Prefs = typeof window === "undefined" ? DEFAULTS : load();
const listeners = new Set<() => void>();

export const prefs = {
  get: () => state,
  set(patch: Partial<Prefs>) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Private mode or blocked storage: the preference still applies for this visit.
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, () => DEFAULTS);
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
