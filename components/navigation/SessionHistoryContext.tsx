"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";

interface SessionHistoryContextValue {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

const SessionHistoryContext = createContext<SessionHistoryContextValue>({
  canGoBack: false,
  canGoForward: false,
  goBack: () => {},
  goForward: () => {},
});

export function SessionHistoryProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const historyRef = useRef<string[]>([]);
  const positionRef = useRef<number>(-1);
  const isNavigatingRef = useRef(false);

  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const currentUrl = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");

  useEffect(() => {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      setCanGoBack(positionRef.current > 0);
      setCanGoForward(positionRef.current < historyRef.current.length - 1);
      return;
    }

    const history = historyRef.current;
    const pos = positionRef.current;

    // Truncate forward history on new navigation
    if (pos < history.length - 1) {
      history.splice(pos + 1);
    }

    // Don't push duplicates
    if (history[history.length - 1] !== currentUrl) {
      history.push(currentUrl);
      positionRef.current = history.length - 1;
    }

    setCanGoBack(positionRef.current > 0);
    setCanGoForward(positionRef.current < history.length - 1);
  }, [currentUrl]);

  const goBack = useCallback(() => {
    if (positionRef.current > 0) {
      positionRef.current--;
      isNavigatingRef.current = true;
      router.push(historyRef.current[positionRef.current]);
    }
  }, [router]);

  const goForward = useCallback(() => {
    if (positionRef.current < historyRef.current.length - 1) {
      positionRef.current++;
      isNavigatingRef.current = true;
      router.push(historyRef.current[positionRef.current]);
    }
  }, [router]);

  return (
    <SessionHistoryContext.Provider value={{ canGoBack, canGoForward, goBack, goForward }}>
      {children}
    </SessionHistoryContext.Provider>
  );
}

export function useSessionHistory() {
  return useContext(SessionHistoryContext);
}
