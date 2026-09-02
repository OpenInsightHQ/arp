import { useEffect, useState } from 'react';
import { Spinner, useToastContext } from '@librechat/client';
import type { TCredentialSchemaField } from 'librechat-data-provider';
import { useBindCredentialMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type BindCredentialDialogProps = {
  resourceType: string;
  resourceName: string;
  displayName?: string;
  credentialSchema: TCredentialSchemaField[];
  onClose: () => void;
};

/** Shared credential bind dialog (credential panel + skills catalog rows). */
export default function BindCredentialDialog({
  resourceType,
  resourceName,
  displayName,
  credentialSchema,
  onClose,
}: BindCredentialDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
  }, [resourceType, resourceName]);

  const bindMutation = useBindCredentialMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_credential_bound'), status: 'success' });
      onClose();
    },
    onError: (error) => {
      showToast({
        message: error.message || localize('com_ui_credential_bind_failed'),
        status: 'error',
      });
    },
  });

  const submit = () => {
    const missing = (credentialSchema || []).filter((f) => !values[f.secretKey]?.trim());
    if (missing.length > 0) {
      showToast({
        message:
          localize('com_ui_credential_missing_fields') +
          ': ' +
          missing.map((f) => f.displayName || f.secretKey).join(', '),
        status: 'error',
      });
      return;
    }
    bindMutation.mutate({ resourceType, resourceName, values });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-background p-4 shadow-2xl">
        <h3 className="mb-3 text-base font-medium text-text-primary">
          {localize('com_ui_credential_bind_title', { 0: displayName || resourceName })}
        </h3>
        <div className="flex flex-col gap-3">
          {(credentialSchema || []).length === 0 && (
            <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-2 text-xs text-orange-600 dark:text-orange-400">
              {localize('com_ui_credential_no_schema')}
            </div>
          )}
          {(credentialSchema || []).map((field) => (
            <label key={field.secretKey} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-primary">
                {field.displayName || field.secretKey}
              </span>
              <input
                type={field.sensitive !== false ? 'password' : 'text'}
                value={values[field.secretKey] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.secretKey]: e.target.value }))
                }
                placeholder={field.description || field.secretKey}
                autoComplete="off"
                className="w-full rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-light px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-surface-hover"
          >
            {localize('com_ui_cancel')}
          </button>
          <button
            type="button"
            disabled={bindMutation.isLoading}
            onClick={submit}
            className="flex items-center gap-1.5 rounded-lg bg-surface-submit px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-surface-submit-hover disabled:opacity-50"
          >
            {bindMutation.isLoading && <Spinner className="size-4" />}
            {localize('com_ui_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
