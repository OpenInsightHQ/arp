import { useState } from 'react';
import { Spinner, useToastContext } from '@librechat/client';
import { useCreateHttpSkillMutation, useTestSkillConnectionMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Create-personal-http-skill dialog (My Skills → HTTP tab). */
export default function CreateHttpSkillDialog({ onClose }: { onClose: () => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [baseUrl, setBaseUrl] = useState('');
  const [apis, setApis] = useState('');
  const [requiresCredentials, setRequiresCredentials] = useState(false);
  const [userManaged, setUserManaged] = useState(true);
  const [credentialSchema, setCredentialSchema] = useState('');
  const [credentialBinding, setCredentialBinding] = useState('');

  const createMutation = useCreateHttpSkillMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_http_skill_created'), status: 'success' });
      onClose();
    },
    onError: (error) => {
      showToast({
        message: error.message || localize('com_ui_http_skill_create_failed'),
        status: 'error',
      });
    },
  });

  const testMutation = useTestSkillConnectionMutation({
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

  const validateJson = (value: string, array: boolean): string | null => {
    if (!value.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      if (array && !Array.isArray(parsed)) {
        return localize('com_ui_http_skill_apis_invalid');
      }
      if (!array && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        return localize('com_ui_http_skill_binding_invalid');
      }
      if (array) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || !item.secretKey) {
            return localize('com_ui_http_skill_schema_invalid');
          }
        }
      }
      return null;
    } catch {
      return array
        ? localize('com_ui_http_skill_apis_invalid')
        : localize('com_ui_http_skill_binding_invalid');
    }
  };

  const submit = () => {
    if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(name)) {
      showToast({ message: localize('com_ui_http_skill_name_invalid'), status: 'error' });
      return;
    }
    if (!description.trim()) {
      showToast({ message: localize('com_ui_http_skill_desc_required'), status: 'error' });
      return;
    }
    const apisError = validateJson(apis, true);
    if (apisError) {
      showToast({ message: apisError, status: 'error' });
      return;
    }
    const schemaError = validateJson(credentialSchema, true);
    if (schemaError) {
      showToast({ message: schemaError, status: 'error' });
      return;
    }
    const bindingError = validateJson(credentialBinding, false);
    if (bindingError) {
      showToast({ message: bindingError, status: 'error' });
      return;
    }
    createMutation.mutate({
      name,
      description,
      category,
      baseUrl,
      apis: apis.trim() || undefined,
      requiresCredentials,
      userManaged,
      credentialSchema: credentialSchema.trim() || undefined,
      credentialBinding: credentialBinding.trim() || undefined,
    });
  };

  const inputClass =
    'w-full rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-background p-4 shadow-2xl">
        <h3 className="mb-3 text-base font-medium text-text-primary">
          {localize('com_ui_create_http_skill')}
        </h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-primary">
              {localize('com_ui_http_skill_name')}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feishu"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-primary">
              {localize('com_ui_http_skill_desc')}
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-text-primary">
                {localize('com_ui_http_skill_category')}
              </span>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-text-primary">
                {localize('com_ui_http_skill_base_url')}
              </span>
              <div className="flex gap-1">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://open.feishu.cn"
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={!baseUrl.trim() || testMutation.isLoading}
                  onClick={() => testMutation.mutate({ type: 'http', url: baseUrl.trim() })}
                  className="shrink-0 rounded-lg border border-border-light px-2.5 text-xs text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  {testMutation.isLoading ? (
                    <Spinner className="size-4" />
                  ) : (
                    localize('com_ui_test_connection')
                  )}
                </button>
              </div>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-primary">
              {localize('com_ui_http_skill_apis')}
            </span>
            <textarea
              value={apis}
              onChange={(e) => setApis(e.target.value)}
              rows={4}
              placeholder={
                '[{"name":"send_message","method":"POST","url":"https://open.feishu.cn/open-apis/im/v1/messages"}]'
              }
              className={inputClass}
            />
          </label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                checked={requiresCredentials}
                onChange={(e) => setRequiresCredentials(e.target.checked)}
              />
              {localize('com_ui_http_skill_requires_credentials')}
            </label>
            {requiresCredentials && (
              <label className="flex items-center gap-2 text-xs text-text-primary">
                <input
                  type="checkbox"
                  checked={userManaged}
                  onChange={(e) => setUserManaged(e.target.checked)}
                />
                {localize('com_ui_http_skill_user_managed')}
              </label>
            )}
          </div>
          {requiresCredentials && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-primary">
                  {localize('com_ui_http_skill_credential_schema')}
                </span>
                <textarea
                  value={credentialSchema}
                  onChange={(e) => setCredentialSchema(e.target.value)}
                  rows={3}
                  placeholder={
                    '[{"secretKey":"app_id"},{"secretKey":"app_secret","sensitive":true}]'
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-primary">
                  {localize('com_ui_http_skill_credential_binding')}
                </span>
                <textarea
                  value={credentialBinding}
                  onChange={(e) => setCredentialBinding(e.target.value)}
                  rows={2}
                  placeholder={'{"authType":"bearer"}'}
                  className={inputClass}
                />
              </label>
            </>
          )}
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
            disabled={createMutation.isLoading}
            onClick={submit}
            className="flex items-center gap-1.5 rounded-lg bg-surface-submit px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-surface-submit-hover disabled:opacity-50"
          >
            {createMutation.isLoading && <Spinner className="size-4" />}
            {localize('com_ui_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
