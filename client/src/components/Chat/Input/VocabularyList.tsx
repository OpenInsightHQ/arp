import { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { searchVocabulary, type VocabularyHit } from 'librechat-data-provider';

const TEXTAREA_ID = 'prompt-textarea';
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

interface VocabularyListProps {
  searchQuery: string;
  datasetIds: string[] | null | undefined;
  onKeywordSelect: (hit: VocabularyHit) => void;
  onClose: () => void;
}

interface GroupedHits {
  [datasetId: string]: VocabularyHit[];
}

const VocabularyList = memo(function VocabularyList({
  searchQuery,
  datasetIds,
  onKeywordSelect,
  onClose,
}: VocabularyListProps) {
  const [hits, setHits] = useState<VocabularyHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setSelectedIndexState] = useState(-1);
  const selectedIndexRef = useRef(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = selectedIndexRef.current;

  const updateSelectedIndex = (updater: number | ((prev: number) => number)) => {
    if (typeof updater === 'function') {
      selectedIndexRef.current = updater(selectedIndexRef.current);
    } else {
      selectedIndexRef.current = updater;
    }
    setSelectedIndexState(selectedIndexRef.current);
  };

  const groupedHits = useMemo(() => {
    const groups: GroupedHits = {};
    for (const hit of hits) {
      if (!groups[hit.datasetId]) {
        groups[hit.datasetId] = [];
      }
      groups[hit.datasetId].push(hit);
    }
    return groups;
  }, [hits]);

  const groupEntries = useMemo(
    () => Object.entries(groupedHits).sort((a, b) => a[0].localeCompare(b[0])),
    [groupedHits],
  );

  const getTotalItems = useCallback(
    () => groupEntries.reduce((total, [, items]) => total + items.length, 0),
    [groupEntries],
  );

  const getItemAtIndex = useCallback(
    (index: number): VocabularyHit | null => {
      let currentIndex = 0;
      for (const [, items] of groupEntries) {
        for (const hit of items) {
          if (currentIndex === index) {
            return hit;
          }
          currentIndex++;
        }
      }
      return null;
    },
    [groupEntries],
  );

  const performSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < MIN_QUERY_LENGTH || !datasetIds || datasetIds.length === 0) {
        setHits([]);
        updateSelectedIndex(-1);
        return;
      }
      setLoading(true);
      try {
        const response = await searchVocabulary(trimmed, datasetIds);
        setHits(response.hits);
        updateSelectedIndex(response.hits.length > 0 ? 0 : -1);
      } catch (error) {
        console.error('Vocabulary search error:', error);
        setHits([]);
        updateSelectedIndex(-1);
      } finally {
        setLoading(false);
      }
    },
    [datasetIds],
  );

  useEffect(() => {
    if (
      !searchQuery ||
      searchQuery.trim().length < MIN_QUERY_LENGTH ||
      !datasetIds ||
      datasetIds.length === 0
    ) {
      setHits([]);
      updateSelectedIndex(-1);
      return;
    }
    const timer = setTimeout(() => performSearch(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery, datasetIds, performSearch]);

  const handleSelect = useCallback(
    (hit: VocabularyHit) => {
      onKeywordSelect(hit);
    },
    [onKeywordSelect],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const totalItems = getTotalItems();
      if (totalItems === 0) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        updateSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        updateSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const item = getItemAtIndex(selectedIndex >= 0 ? selectedIndex : 0);
        if (item) {
          handleSelect(item);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setHits([]);
        updateSelectedIndex(-1);
        onClose();
      }
    },
    [selectedIndex, getTotalItems, getItemAtIndex, handleSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      requestAnimationFrame(() => {
        const buttons = listRef.current?.querySelectorAll('button');
        const selectedEl = buttons?.[selectedIndex] as HTMLElement;
        if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'nearest' });
        }
      });
    }
  }, [selectedIndex]);

  if (loading || hits.length === 0) {
    return null;
  }

  const textAreaEl = document.getElementById(TEXTAREA_ID);
  let dropdownStyle: React.CSSProperties = { display: 'none' };
  if (textAreaEl) {
    const rect = textAreaEl.getBoundingClientRect();
    dropdownStyle = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top + 4}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: '240px',
      overflowY: 'auto',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      backgroundColor: '#ffffff',
      boxShadow: '0 -4px 6px -1px rgba(0, 0, 0, 0.1)',
      zIndex: 9999,
    };
  }

  let currentIndex = 0;

  return (
    <div ref={listRef} style={dropdownStyle}>
      {groupEntries.map(([datasetId, items]) => (
        <div key={datasetId}>
          <div
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#6b7280',
              backgroundColor: '#f3f4f6',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            {`${items[0]?.datasetName || '数据集'}(${datasetId})`}
          </div>
          {items.map((hit) => {
            const index = currentIndex++;
            return (
              <button
                key={`${hit.name}-${hit.datasetId}-${index}`}
                type="button"
                style={{
                  display: 'flex',
                  width: '100%',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  textAlign: 'left',
                  backgroundColor: index === selectedIndex ? '#e5e7eb' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => updateSelectedIndex(index)}
                onClick={() => handleSelect(hit)}
              >
                <span style={{ fontWeight: 500, color: '#111827' }}>{hit.name}</span>
                <span
                  style={{
                    maxWidth: '60%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '12px',
                    color: '#6b7280',
                  }}
                >
                  {hit.desc || hit.definition}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});

export default VocabularyList;
