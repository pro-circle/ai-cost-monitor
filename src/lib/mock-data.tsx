import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const COOKIE = "acg_mock";

interface MockDataValue {
  loaded: boolean;
  ready: boolean;
  load: () => void;
  clear: () => void;
}

const FALLBACK: MockDataValue = { loaded: false, ready: false, load: () => {}, clear: () => {} };

const MockDataContext = createContext<MockDataValue | null>(null);

export function MockDataProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLoaded(document.cookie.split("; ").some((c) => c === `${COOKIE}=1`));
    setReady(true);
  }, []);

  const apply = useCallback(
    (next: boolean) => {
      document.cookie = next
        ? `${COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`
        : `${COOKIE}=; path=/; max-age=0; SameSite=Lax`;
      qc.clear();
      setLoaded(next);
    },
    [qc],
  );

  const load = useCallback(() => apply(true), [apply]);
  const clear = useCallback(() => apply(false), [apply]);

  return <MockDataContext.Provider value={{ loaded, ready, load, clear }}>{children}</MockDataContext.Provider>;
}

export function useMockData() {
  const ctx = useContext(MockDataContext);
  // Fallback keeps the page alive if the provider is missing (e.g. mid hot-reload).
  return ctx ?? FALLBACK;
}
