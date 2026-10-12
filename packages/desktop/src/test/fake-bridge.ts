import { act } from "@testing-library/react";

type Handler = (event: unknown, payload: unknown) => void;

export interface FakeBridge {
  /** Every `send*` call made by the renderer, in order. */
  sent: { name: string; payload: unknown }[];
  /** Every other bridge call (request*, open*, close, ...), in order. */
  calls: { name: string; args: unknown[] }[];
  /** Deliver an IPC message to the renderer's `on*` listeners. */
  emit: (name: string, payload?: unknown) => void;
  /** Payloads of all `send*` calls with the given name. */
  sentOf: <T = Record<string, unknown>>(name: string) => T[];
  /** Names of all non-send calls. */
  callNames: () => string[];
  /** Number of listeners currently registered for `on*` channel `name`. */
  listenerCount: (name: string) => number;
  uninstall: () => void;
}

/**
 * Installs a minimal `window.cslope` stand-in that records `on*` listeners,
 * `send*` payloads and all other calls. Dialog components read `isElectron`
 * at module load, so tests must also mock `utils/is-electron`.
 */
export function installFakeBridge(
  overrides: Record<string, unknown> = {},
): FakeBridge {
  const handlers = new Map<string, Handler[]>();
  const sent: FakeBridge["sent"] = [];
  const calls: FakeBridge["calls"] = [];
  const api = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop in overrides) return overrides[prop];
        if (prop.startsWith("on")) {
          return (fn: Handler) => {
            handlers.set(prop, [...(handlers.get(prop) ?? []), fn]);
            return () =>
              handlers.set(
                prop,
                (handlers.get(prop) ?? []).filter((h) => h !== fn),
              );
          };
        }
        if (prop.startsWith("send")) {
          return (payload: unknown) => sent.push({ name: prop, payload });
        }
        return (...args: unknown[]) => {
          calls.push({ name: prop, args });
          return Promise.resolve(null);
        };
      },
    },
  );
  (window as unknown as { cslope: unknown }).cslope = api;
  return {
    sent,
    calls,
    emit: (name, payload) => {
      act(() => {
        for (const fn of handlers.get(name) ?? []) fn({}, payload);
      });
    },
    sentOf: <T,>(name: string) =>
      sent.filter((s) => s.name === name).map((s) => s.payload as T),
    callNames: () => calls.map((c) => c.name),
    listenerCount: (name) => (handlers.get(name) ?? []).length,
    uninstall: () => {
      delete (window as unknown as { cslope?: unknown }).cslope;
    },
  };
}
