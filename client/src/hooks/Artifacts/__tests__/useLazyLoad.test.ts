import { renderHook, act } from '@testing-library/react';
import useLazyLoad, { _resetSharedObserverForTesting } from '../useLazyLoad';

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

function toThresholdArray(value: number | number[] | undefined): number[] {
  if (value === undefined) {
    return [0];
  }
  return Array.isArray(value) ? value : [value];
}

let observerCallback: ObserverCallback | null = null;
let observeCalls: Element[] = [];
let unobserveCalls: Element[] = [];
let lastCreatedObserver: MockIntersectionObserver | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;

  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    observerCallback = callback;
    this.rootMargin = options?.rootMargin ?? '';
    this.thresholds = toThresholdArray(options?.threshold);
  }

  observe(target: Element) {
    observeCalls.push(target);
  }

  unobserve(target: Element) {
    unobserveCalls.push(target);
  }

  disconnect() {
    observeCalls = [];
    unobserveCalls = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function createTrackedObserver(callback: ObserverCallback, options?: IntersectionObserverInit) {
  const observer = new MockIntersectionObserver(callback, options);
  lastCreatedObserver = observer;
  return observer;
}

function fireIntersect(entry: Partial<IntersectionObserverEntry>, target: Element) {
  observerCallback?.([
    {
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: entry.isIntersecting ? 1 : 0,
      intersectionRect: {} as DOMRectReadOnly,
      isIntersecting: entry.isIntersecting ?? false,
      rootBounds: null,
      target,
      time: Date.now(),
    } as IntersectionObserverEntry,
  ]);
}

beforeEach(() => {
  observerCallback = null;
  observeCalls = [];
  unobserveCalls = [];
  lastCreatedObserver = null;
  (globalThis as Record<string, unknown>).IntersectionObserver = createTrackedObserver;
  _resetSharedObserverForTesting();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
});

describe('useLazyLoad', () => {
  it('returns loaded=false initially when no ref is attached', () => {
    const { result } = renderHook(() => useLazyLoad());
    expect(result.current.loaded).toBe(false);
  });

  it('creates the shared observer with rootMargin 300px 0px and threshold 0', () => {
    const { result } = renderHook(() => useLazyLoad());
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    expect(lastCreatedObserver).not.toBeNull();
    expect(lastCreatedObserver!.rootMargin).toBe('300px 0px');
    expect(lastCreatedObserver!.thresholds).toEqual([0]);

    document.body.removeChild(div);
  });

  it('registers observer and sets loaded when element is in viewport', () => {
    const { result } = renderHook(() => useLazyLoad());
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    expect(observeCalls).toContain(div);
    expect(result.current.loaded).toBe(false);

    act(() => {
      fireIntersect({ isIntersecting: true }, div);
    });

    expect(result.current.loaded).toBe(true);

    document.body.removeChild(div);
  });

  it('stays loaded after element leaves viewport', () => {
    const { result } = renderHook(() => useLazyLoad());
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    act(() => {
      fireIntersect({ isIntersecting: true }, div);
    });

    expect(result.current.loaded).toBe(true);

    act(() => {
      fireIntersect({ isIntersecting: false }, div);
    });

    expect(result.current.loaded).toBe(true);

    document.body.removeChild(div);
  });

  it('does not observe or fallback-load when enabled=false', () => {
    const { result } = renderHook(() => useLazyLoad({ enabled: false }));
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    expect(observeCalls).toHaveLength(0);
    expect(result.current.loaded).toBe(false);

    document.body.removeChild(div);
  });

  it('falls back to loaded=true when IntersectionObserver is unsupported', () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;

    const { result } = renderHook(() => useLazyLoad());
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    expect(result.current.loaded).toBe(true);

    document.body.removeChild(div);
  });

  it('does not fallback-load when IntersectionObserver is unsupported and enabled=false', () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;

    const { result } = renderHook(() => useLazyLoad({ enabled: false }));
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    expect(result.current.loaded).toBe(false);

    document.body.removeChild(div);
  });

  it('unregisters observer on cleanup', () => {
    const { result, unmount } = renderHook(() => useLazyLoad());
    const div = document.createElement('div');
    document.body.appendChild(div);

    act(() => {
      result.current.ref(div);
    });

    expect(observeCalls).toContain(div);

    unmount();

    expect(unobserveCalls).toHaveLength(1);

    document.body.removeChild(div);
  });

  it('does not re-register when ref is attached to null', () => {
    const { result } = renderHook(() => useLazyLoad());

    act(() => {
      result.current.ref(null);
    });

    expect(observeCalls).toHaveLength(0);
  });

  it('handles re-attachment of ref to different element', () => {
    const { result } = renderHook(() => useLazyLoad());
    const div1 = document.createElement('div');
    const div2 = document.createElement('div');
    document.body.appendChild(div1);
    document.body.appendChild(div2);

    act(() => {
      result.current.ref(div1);
    });

    expect(observeCalls).toContain(div1);

    act(() => {
      result.current.ref(div2);
    });

    expect(observeCalls).toContain(div2);

    document.body.removeChild(div1);
    document.body.removeChild(div2);
  });
});
