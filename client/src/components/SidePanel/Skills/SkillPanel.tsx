import { useState, useRef, useMemo } from 'react';
import { Sparkles, Upload, Search, KeyRound, Globe, Plug } from 'lucide-react';
import { Spinner, useToastContext } from '@librechat/client';
import type { TSkillsCatalogItem } from 'librechat-data-provider';
import {
  useMySkillsQuery,
  useUploadSkillMutation,
  useSkillsCatalogQuery,
  useTestSkillConnectionMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import SkillList from '~/components/SidePanel/Skills/SkillList';
import SkillEmptyState from '~/components/SidePanel/Skills/SkillEmptyState';
import BindCredentialDialog from '~/components/Credentials/BindCredentialDialog';
import CreateHttpSkillDialog from '~/components/Skills/CreateHttpSkillDialog';

type SkillTab = 'skill' | 'http' | 'mcp';
type SourceFilter = 'all' | 'created' | 'authorized';

type SkillPanelProps = {
  onNavigate?: () => void;
};

export default function SkillPanel({ onNavigate }: SkillPanelProps = {}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<SkillTab>('skill');
  const [source, setSource] = useState<SourceFilter>('all');
  const [filter, setFilter] = useState('');
  const [binding, setBinding] = useState<TSkillsCatalogItem | null>(null);
  const [showCreateHttp, setShowCreateHttp] = useState(false);

  const { data, isLoading } = useMySkillsQuery();
  const catalogQuery = useSkillsCatalogQuery(tab, source, { enabled: tab !== 'skill' });

  const uploadMutation = useUploadSkillMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_skill_uploaded'), status: 'success' });
    },
    onError: () => {
      showToast({ message: localize('com_ui_skill_upload_failed'), status: 'error' });
    },
  });

  const testConnectionMutation = useTestSkillConnectionMutation({
    onSuccess: (result) => {
      showToast({
        message: `${result.ok ? '✓' : '✗'} ${result.message || ''}`,
        status: result.ok ? 'success' : 'error',
      });
    },
    onError: () => {
      showToast({ message: localize('com_ui_test_connection_failed'), status: 'error' });
    },
  });

  const filteredSkills = useMemo(() => {
    if (!data?.skills) {
      return [];
    }
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) {
      return data.skills;
    }
    return data.skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(trimmed) ||
        skill.description?.toLowerCase().includes(trimmed),
    );
  }, [data?.skills, filter]);

  const catalogItems = useMemo(() => {
    const items = catalogQuery.data?.items ?? [];
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) {
      return items;
    }
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(trimmed) ||
        (item.description ? item.description.toLowerCase().includes(trimmed) : false),
    );
  }, [catalogQuery.data?.items, filter]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    uploadMutation.mutate(formData);
    e.target.value = '';
  };

  const testConnectionFor = (item: TSkillsCatalogItem) => {
    const url = item.serverUrl || item.baseUrl;
    if (!url) {
      showToast({ message: localize('com_ui_test_connection_no_url'), status: 'error' });
      return;
    }
    testConnectionMutation.mutate({ type: item.resourceType === 'mcp' ? 'mcp' : 'http', url });
  };

  const catalogItemTestUrl = (item: TSkillsCatalogItem) => Boolean(item.serverUrl || item.baseUrl);

  const tabs: Array<{ key: SkillTab; label: string }> = [
    { key: 'skill', label: localize('com_ui_skills_tab_skill') },
    { key: 'http', label: localize('com_ui_skills_tab_http') },
    { key: 'mcp', label: localize('com_ui_skills_tab_mcp') },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-5 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">
          {localize('com_nav_my_skills')}
        </span>
        {tab === 'skill' && data?.skills && (
          <span className="ml-auto text-xs text-text-secondary">{data.skills.length}</span>
        )}
        {tab !== 'skill' && catalogQuery.data?.items && (
          <span className="ml-auto text-xs text-text-secondary">
            {catalogQuery.data.items.length}
          </span>
        )}
      </div>

      <div className="mb-2 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t.key
                ? 'bg-surface-active text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'skill' && (
        <div className="mb-2 flex gap-1">
          {(
            [
              ['all', localize('com_ui_source_all')],
              ['created', localize('com_ui_source_created')],
              ['authorized', localize('com_ui_source_authorized')],
            ] as Array<[SourceFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] transition-colors',
                source === key
                  ? 'bg-surface-active-alt text-text-primary'
                  : 'text-text-secondary hover:bg-surface-hover',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={localize('com_ui_search_skills')}
            className="w-full rounded-lg border border-border-light bg-transparent py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
          />
        </div>
        {tab === 'skill' && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isLoading}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-submit px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-surface-submit-hover disabled:opacity-50"
            >
              {uploadMutation.isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <Upload className="size-4" />
              )}
              {localize('com_ui_upload')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              className="hidden"
            />
          </>
        )}
        {tab === 'http' && (
          <button
            type="button"
            onClick={() => setShowCreateHttp(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-submit px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-surface-submit-hover"
          >
            <Globe className="size-4" />
            {localize('com_ui_create_http_skill')}
          </button>
        )}
      </div>

      {tab === 'skill' && isLoading && (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}
      {tab === 'skill' && !isLoading && filteredSkills.length === 0 && (
        <SkillEmptyState isFiltered={filter.trim().length > 0} />
      )}
      {tab === 'skill' && !isLoading && filteredSkills.length > 0 && (
        <SkillList skills={filteredSkills} onNavigate={onNavigate} />
      )}

      {tab !== 'skill' && catalogQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}
      {tab !== 'skill' && !catalogQuery.isLoading && catalogItems.length === 0 && (
        <div className="py-8 text-center text-sm text-text-secondary">
          {tab === 'mcp' ? localize('com_ui_mcp_empty_hint') : localize('com_ui_catalog_empty')}
        </div>
      )}
      {tab !== 'skill' && !catalogQuery.isLoading && catalogItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {catalogItems.map((item) => (
            <div
              key={`${item.resourceType}:${item.name}`}
              className="rounded-lg border border-border-light p-3"
            >
              <div className="flex items-center gap-2">
                {item.resourceType === 'mcp' ? (
                  <Plug className="size-4 text-amber-500" />
                ) : (
                  <Globe className="size-4 text-blue-500" />
                )}
                <span className="text-sm font-medium text-text-primary">
                  {item.displayName || item.name}
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px]',
                    item.source === 'created'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-surface-tertiary text-text-secondary',
                  )}
                >
                  {item.source === 'created'
                    ? localize('com_ui_source_created')
                    : localize('com_ui_source_authorized')}
                </span>
                {item.requiresCredentials && (
                  <span
                    className={cn(
                      'ml-auto flex items-center gap-1 text-xs',
                      item.bound
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400',
                    )}
                  >
                    <KeyRound className="size-3.5" />
                    {item.bound
                      ? localize('com_ui_credential_bound')
                      : localize('com_ui_credential_not_bound')}
                  </span>
                )}
              </div>
              {item.description && (
                <div className="mt-1 line-clamp-2 text-xs text-text-secondary">
                  {item.description}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-xs">
                {item.requiresCredentials &&
                  item.userManaged &&
                  item.credentialSchema?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBinding(item)}
                      className="rounded-lg bg-surface-submit px-2.5 py-1.5 font-medium text-white transition-colors hover:bg-surface-submit-hover"
                    >
                      {item.bound
                        ? localize('com_ui_credential_update')
                        : localize('com_ui_credential_bind')}
                    </button>
                  )}
                {catalogItemTestUrl(item) && (
                  <button
                    type="button"
                    disabled={testConnectionMutation.isLoading}
                    onClick={() => testConnectionFor(item)}
                    className="rounded-lg border border-border-light px-2.5 py-1.5 text-text-primary transition-colors hover:bg-surface-hover"
                  >
                    {localize('com_ui_test_connection')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {binding && (
        <BindCredentialDialog
          resourceType={binding.resourceType}
          resourceName={binding.name}
          displayName={binding.displayName}
          credentialSchema={binding.credentialSchema || []}
          onClose={() => setBinding(null)}
        />
      )}

      {showCreateHttp && <CreateHttpSkillDialog onClose={() => setShowCreateHttp(false)} />}
    </div>
  );
}
