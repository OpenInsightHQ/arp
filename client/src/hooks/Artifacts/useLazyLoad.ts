import { useCallback, useEffect, useRef, useState } from 'react';

const ROOT_MARGIN = '300px 0px';

let sharedObserver: IntersectionObserver | null = null;
const callbacks = new Map<Element, (entry: IntersectionObserverEntry) => void>();

function getSharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') {
    return null;
  }

  if (sharedObserver) {
    return sharedObserver;
  }

  sharedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry);
      }
    },
    { rootMargin: ROOT_MARGIN, threshold: 0 },
  );

  return sharedObserver;
}

export interface UseLazyLoadOptions {
  enabled?: boolean;
}

export interface UseLazyLoadResult {
  ref: (node: Element | null) => void;
  loaded: boolean;
}

/** Resets the shared observer instance (for testing). */
export function _resetSharedObserverForTesting() {
  sharedObserver?.disconnect();
  sharedObserver = null;
  callbacks.clear();
}

export default function useLazyLoad(options: UseLazyLoadOptions = {}): UseLazyLoadResult {
  const { enabled = true } = options;
  const [loaded, setLoaded] = useState(false);
  const [node, setNode] = useState<Element | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const setRef = useCallback((el: Element | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node || !enabledRef.current) {
      return;
    }

    const observer = getSharedObserver();
    if (!observer) {
      setLoaded(true);
      return;
    }

    const handler = (entry: IntersectionObserverEntry) => {
      if (entry.isIntersecting) {
        setLoaded(true);
      }
    };

    callbacks.set(node, handler);
    observer.observe(node);

    return () => {
      callbacks.delete(node);
      observer.unobserve(node);
    };
  }, [node, enabled]);

  return { ref: setRef, loaded };
}
