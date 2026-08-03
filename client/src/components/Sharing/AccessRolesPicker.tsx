import React from 'react';
import * as Ariakit from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import { DropdownPopup, Skeleton } from '@librechat/client';
import { AccessRoleIds, ResourceType } from 'librechat-data-provider';
import { useGetAccessRolesQuery } from 'librechat-data-provider/react-query';
import type { AccessRole } from 'librechat-data-provider';
import type * as t from '~/common';
import { cn, getRoleLocalizationKeys } from '~/utils';
import { useLocalize } from '~/hooks';

interface AccessRolesPickerProps {
  id?: string;
  resourceType?: ResourceType;
  selectedRoleId?: AccessRoleIds;
  onRoleChange: (roleId: AccessRoleIds) => void;
  className?: string;
  /** 弹出方向，默认向下 */
  placement?: 'top' | 'bottom';
}

export default function AccessRolesPicker({
  id,
  resourceType = ResourceType.AGENT,
  selectedRoleId = AccessRoleIds.AGENT_VIEWER,
  onRoleChange,
  className = '',
  placement,
}: AccessRolesPickerProps) {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = React.useState(false);
  const { data: accessRoles, isLoading: rolesLoading } = useGetAccessRolesQuery(resourceType);

  /** Helper function to get localized role name and description */
  const getLocalizedRoleInfo = (roleId: AccessRoleIds) => {
    const keys = getRoleLocalizationKeys(roleId);
    return {
      name: localize(keys.name),
      description: localize(keys.description),
    };
  };

  const selectedRole = accessRoles?.find((role) => role.accessRoleId === selectedRoleId);
  const selectedRoleInfo = selectedRole ? getLocalizedRoleInfo(selectedRole.accessRoleId) : null;

  if (rolesLoading || !accessRoles) {
    return <Skeleton className="h-10 w-24 rounded-lg" />;
  }

  const dropdownItems: t.MenuItemProps[] = accessRoles.map((role: AccessRole) => {
    const localizedInfo = getLocalizedRoleInfo(role.accessRoleId);

    // GalleryArtifact: 只显示 Viewer，不允许更改 Owner 或 Editor
    if (resourceType === ResourceType.GALLERY_ARTIFACT) {
      if (role.accessRoleId === AccessRoleIds.GALLERY_ARTIFACT_OWNER ||
          role.accessRoleId === AccessRoleIds.GALLERY_ARTIFACT_EDITOR) {
        return null; // 隐藏 Owner 和 Editor 角色
      }
    }

    return {
      id: role.accessRoleId,
      label: localizedInfo.name,
      onClick: () => {
        onRoleChange(role.accessRoleId);
        setIsOpen(false);
      },
      render: (props) => (
        <button {...props}>
          <div className="flex flex-col items-start gap-0.5 text-left">
            <span className="font-medium text-text-primary">{localizedInfo.name}</span>
            <span className="text-xs text-text-secondary">{localizedInfo.description}</span>
          </div>
        </button>
      ),
    };
  }).filter(Boolean);

  return (
    <div className={className} id={id}>
      <DropdownPopup
        menuId="access-roles-menu"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        trigger={
          <Ariakit.MenuButton
            aria-label={selectedRoleInfo?.description || 'Select role'}
            className={cn(
              'flex items-center justify-between gap-2 rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-sm transition-colors hover:bg-surface-tertiary',
            )}
          >
            <span className="font-medium">
              {selectedRoleInfo?.name || localize('com_ui_select')}
            </span>
            <ChevronDown className="h-4 w-4 text-text-secondary" aria-hidden="true" />
          </Ariakit.MenuButton>
        }
        items={dropdownItems}
        className="w-[280px] z-[150]"
        itemClassName="bg-white dark:bg-gray-800"
        {...(placement === 'top' ? { placement: 'top-end' as const } : {})}
      />
    </div>
  );
}
