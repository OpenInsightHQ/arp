import { useState, useMemo } from 'react';
import { KeyRound, ShieldCheck, ShieldX, Search } from 'lucide-react';
import { Spinner, useToastContext } from '@librechat/client';
import type { TCredentialResource } from 'librechat-data-provider';
import {
  useCredentialResourcesQuery,
  useUnbindCredentialMutation,
  useVerifyCredentialMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import BindCredentialDialog from './BindCredentialDialog';

export default function CredentialPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [filter, setFilter] = useState('');
  const [binding, setBinding] = useState<TCredentialResource | null>(null);

  const { data, isLoading } = useCredentialResourcesQuery();

  const invalidateAndToast = (message: string, status: 'success' | 'error') => {
    showToast({ message, status });
  };

  const unbindMutation = useUnbindCredentialMutation({
    onSuccess: () => invalidateAndToast(localize('com_ui_credential_unbound'), 'success'),
    onError: () => invalidateAndToast(localize('com_ui_credential_unbind_failed'), 'error'),
  });

  const verifyMutation = useVerifyCredentialMutation({
    onSuccess: (result: { valid?: boolean } | unknown) => {
      const valid = (result as { valid?: boolean })?.valid === true;
      invalidateAndToast(
        valid ? localize('com_ui_credential_valid') : localize('com_ui_credential_invalid'),
        valid ? 'success' : 'error',
      );
    },
    onError: () => invalidateAndToast(localize('com_ui_credential_verify_failed'), 'error'),
  });

  const trimmed = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    const resources = data?.resources ?? [];
    if (!trimmed) {
      return resources;
    }
    return resources.filter(
      (r) =>
        r.resourceName.toLowerCase().includes(trimmed) ||
        (r.description ? r.description.toLowerCase().includes(trimmed) : false),
    );
  }, [data?.resources, trimmed]);

  const statusLabel = (resource: TCredentialResource) => {
    if (!resource.bound) {
      return (
        <span className="text-red-600 dark:text-red-400">
          {localize('com_ui_credential_not_bound')}
        </span>
      );
    }
    if (resource.status?.status === 'invalid') {
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          <ShieldX className="size-3.5" />
          {localize('com_ui_credential_invalid')}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="size-3.5" />
        {localize('com_ui_credential_bound')}
      </span>
    );
  };

  const bindButtonLabel = (resource: TCredentialResource) =>
    resource.bound ? localize('com_ui_credential_update') : localize('com_ui_credential_bind');

  const openBindDialog = (resource: TCredentialResource) => {
    setBinding(resource);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="size-5 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">
          {localize('com_nav_my_credentials')}
        </span>
        {data?.resources && (
          <span className="ml-auto text-xs text-text-secondary">{data.resources.length}</span>
        )}
      </div>

      {data && !data.cryptoConfigured && (
        <div className="mb-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-2 text-xs text-orange-600 dark:text-orange-400">
          {localize('com_ui_credential_crypto_disabled')}
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={localize('com_ui_search_credentials')}
            className="w-full rounded-lg border border-border-light bg-transparent py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner className="size-6" />
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="py-8 text-center text-sm text-text-secondary">
          {localize('com_ui_credentials_empty')}
        </div>
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="flex flex-col gap-2">
          {filtered.map((resource) => (
            <div
              key={`${resource.resourceType}:${resource.resourceName}`}
              className="rounded-lg border border-border-light p-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {resource.displayName || resource.resourceName}
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                    resource.resourceType === 'skill'
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                  )}
                >
                  {resource.resourceType}
                </span>
                {resource.skillType && (
                  <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
                    {resource.skillType}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-xs">
                  {statusLabel(resource)}
                </span>
              </div>
              {resource.description && (
                <div className="mt-1 line-clamp-2 text-xs text-text-secondary">
                  {resource.description}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => openBindDialog(resource)}
                  className="rounded-lg bg-surface-submit px-2.5 py-1.5 font-medium text-white transition-colors hover:bg-surface-submit-hover"
                >
                  {bindButtonLabel(resource)}
                </button>
                {resource.bound && (
                  <>
                    <button
                      type="button"
                      disabled={verifyMutation.isLoading}
                      onClick={() =>
                        verifyMutation.mutate({
                          resourceType: resource.resourceType,
                          resourceName: resource.resourceName,
                        })
                      }
                      className="rounded-lg border border-border-light px-2.5 py-1.5 text-text-primary transition-colors hover:bg-surface-hover"
                    >
                      {localize('com_ui_credential_verify')}
                    </button>
                    <button
                      type="button"
                      disabled={unbindMutation.isLoading}
                      onClick={() =>
                        unbindMutation.mutate({
                          resourceType: resource.resourceType,
                          resourceName: resource.resourceName,
                        })
                      }
                      className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                    >
                      {localize('com_ui_credential_unbind')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {binding && (
        <BindCredentialDialog
          resourceType={binding.resourceType}
          resourceName={binding.resourceName}
          displayName={binding.displayName}
          credentialSchema={binding.credentialSchema || []}
          onClose={() => setBinding(null)}
        />
      )}
    </div>
  );
}
