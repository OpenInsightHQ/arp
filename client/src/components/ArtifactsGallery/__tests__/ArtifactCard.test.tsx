import React from 'react';
import { render, act } from '@testing-library/react';

jest.mock('framer-motion', () => {
  const filterDOMProps = (props: Record<string, unknown>) => {
    const dom: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (
        k === 'children' ||
        k === 'style' ||
        k === 'className' ||
        k.startsWith('on') ||
        k === 'key' ||
        k === 'role' ||
        k === 'id' ||
        k === 'tabIndex'
      ) {
        dom[k] = v;
      }
    }
    return dom;
  };
  return {
    motion: {
      div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
        <div {...filterDOMProps(props)}>{children}</div>
      ),
    },
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

jest.mock('@dicebear/core', () => ({
  createAvatar: () => ({
    toDataUri: () => 'data:image/svg+xml,mock',
  }),
}));

jest.mock('@dicebear/collection', () => ({
  initials: 'initials',
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useLazyLoad: jest.requireActual('~/hooks/Artifacts/useLazyLoad').default,
}));

import ArtifactCard from '../ArtifactCard';
import type { ArtifactCardData } from '../ArtifactCard';
import { _resetSharedObserverForTesting } from '~/hooks/Artifacts/useLazyLoad';

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

function fireIntersect(target: Element, isIntersecting: boolean) {
  observerCallback?.([
    {
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: {} as DOMRectReadOnly,
      isIntersecting,
      rootBounds: null,
      target,
      time: Date.now(),
    } as IntersectionObserverEntry,
  ]);
}

const makeArtifact = (overrides?: Partial<ArtifactCardData>): ArtifactCardData =>
  ({
    id: 'art-1',
    title: 'Test Report',
    type: 'HTML',
    content: '<html><body><p>Hello</p></body></html>',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    likeCount: 0,
    ...overrides,
  }) as ArtifactCardData;

beforeEach(() => {
  observerCallback = null;
  observeCalls = [];
  unobserveCalls = [];
  (globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;
  _resetSharedObserverForTesting();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
});

describe('ArtifactCard lazy loading', () => {
  it('shows placeholder instead of iframe when offscreen', () => {
    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={true} />,
    );

    expect(observeCalls.length).toBe(1);

    const iframes = container.querySelectorAll('iframe');
    expect(iframes).toHaveLength(0);

    const placeholders = container.querySelectorAll('.animate-pulse');
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });

  it('mounts iframe when element enters viewport', () => {
    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={true} />,
    );

    const observedEl = observeCalls[0];

    act(() => {
      fireIntersect(observedEl, true);
    });

    const iframes = container.querySelectorAll('iframe');
    expect(iframes).toHaveLength(1);
    expect(iframes[0]).toHaveAttribute('sandbox', 'allow-same-origin');
    expect(iframes[0]).toHaveAttribute('title', 'artifact preview');
  });

  it('stays mounted after element leaves viewport', () => {
    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={true} />,
    );

    const observedEl = observeCalls[0];

    act(() => {
      fireIntersect(observedEl, true);
    });
    expect(container.querySelectorAll('iframe')).toHaveLength(1);

    act(() => {
      fireIntersect(observedEl, false);
    });
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('does not load iframe when enableLazyLoading is false', () => {
    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={false} />,
    );

    expect(observeCalls).toHaveLength(0);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    const placeholders = container.querySelectorAll('.animate-pulse');
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves stable preview dimensions (h-44)', () => {
    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={true} />,
    );

    const previewArea = container.querySelector('.h-44');
    expect(previewArea).toBeInTheDocument();
    expect(previewArea).toHaveClass('overflow-hidden');
  });

  it('loads immediately when IntersectionObserver is unsupported', () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;

    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={true} />,
    );

    const iframes = container.querySelectorAll('iframe');
    expect(iframes).toHaveLength(1);
  });

  it('does not load when IntersectionObserver is unsupported and disabled', () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;

    const { container } = render(
      <ArtifactCard artifact={makeArtifact()} enableLazyLoading={false} />,
    );

    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    const placeholders = container.querySelectorAll('.animate-pulse');
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });

  it('shows image preview without registering observer', () => {
    const { container } = render(
      <ArtifactCard
        artifact={makeArtifact({ preview: 'https://example.com/img.png' })}
        enableLazyLoading={true}
      />,
    );

    const img = container.querySelector('img[src="https://example.com/img.png"]');
    expect(img).toBeInTheDocument();
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(observeCalls).toHaveLength(0);
  });

  it('shows file icon without registering observer when no content and no preview', () => {
    const { container } = render(
      <ArtifactCard artifact={makeArtifact({ content: undefined })} enableLazyLoading={true} />,
    );

    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(observeCalls).toHaveLength(0);
  });

  it('does not observe when enableLazyLoading defaults to true but card has no content', () => {
    const { container } = render(<ArtifactCard artifact={makeArtifact({ content: undefined })} />);

    expect(observeCalls).toHaveLength(0);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('observes only content cards across multiple cards', () => {
    const { container } = render(
      <>
        <ArtifactCard
          artifact={makeArtifact({
            id: 'img-card',
            preview: 'https://example.com/img.png',
          })}
          enableLazyLoading={true}
        />
        <ArtifactCard artifact={makeArtifact({ id: 'content-card' })} enableLazyLoading={true} />
        <ArtifactCard
          artifact={makeArtifact({ id: 'icon-card', content: undefined })}
          enableLazyLoading={true}
        />
      </>,
    );

    expect(observeCalls).toHaveLength(1);

    const observedEl = observeCalls[0];
    act(() => {
      fireIntersect(observedEl, true);
    });

    const iframes = container.querySelectorAll('iframe');
    expect(iframes).toHaveLength(1);
  });
});

describe('hidden Reports grid lazy-loading simulation', () => {
  const CARD_COUNT = 8;

  const makeCards = () =>
    Array.from({ length: CARD_COUNT }, (_, i) =>
      makeArtifact({ id: `rpt-${i}`, title: `Report ${i}` }),
    );

  it('renders grid with lazyLoading off then on, observes all on enable, and loads exactly one on intersection', () => {
    const cards = makeCards();
    const { container, rerender } = render(
      <>
        {cards.map((art) => (
          <ArtifactCard key={art.id} artifact={art} enableLazyLoading={false} />
        ))}
      </>,
    );

    expect(observeCalls).toHaveLength(0);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    rerender(
      <>
        {cards.map((art) => (
          <ArtifactCard key={art.id} artifact={art} enableLazyLoading={true} />
        ))}
      </>,
    );

    expect(observeCalls).toHaveLength(CARD_COUNT);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);

    act(() => {
      fireIntersect(observeCalls[3], true);
    });

    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });
});
