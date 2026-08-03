import { useRef, useState, useEffect, type ReactElement } from 'react';
import * as Ariakit from '@ariakit/react';
import { DropdownPopup, Skeleton } from '@librechat/client';
import type { MenuItemProps } from '~/common/menus';
import { useLocalize } from '~/hooks';

export function NoImage() {
  return (
    <img
      src="assets/agent-default.png?v=20260710-square"
      className="h-full w-full rounded-full object-cover"
      alt="Agent"
    />
  );
}

export const AgentAvatarRender = ({ url }: { url?: string }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => {
    setIsLoaded(false);
  }, [url]);

  return (
    <div>
      <div className="relative h-20 w-20 overflow-hidden rounded-full">
        <img
          src={url}
          className="bg-token-surface-secondary dark:bg-token-surface-tertiary h-full w-full rounded-full object-cover"
          alt="Agent avatar"
          width="80"
          height="80"
          loading="lazy"
          key={url || 'default-key'}
          onLoad={() => setIsLoaded(true)}
          onError={() => setIsLoaded(false)}
          style={{
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 0.2s ease-in-out',
          }}
        />
        {!isLoaded && <Skeleton className="absolute inset-0 rounded-full" aria-hidden="true" />}
      </div>
    </div>
  );
};

export function AvatarMenu({
  trigger,
  handleFileChange,
  onReset,
  canReset,
}: {
  trigger: ReactElement;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  const localize = useLocalize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const onItemClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    fileInputRef.current?.click();
  };

  const uploadLabel = localize('com_ui_upload_image');

  const items: MenuItemProps[] = [
    {
      id: 'upload-avatar',
      label: uploadLabel,
      onClick: () => onItemClick(),
    },
  ];

  if (canReset) {
    items.push(
      { separate: true },
      {
        id: 'reset-avatar',
        label: localize('com_ui_reset_var', { 0: 'Avatar' }),
        onClick: () => {
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          onReset();
        },
      },
    );
  }

  return (
    <>
      <DropdownPopup
        trigger={<Ariakit.MenuButton render={trigger} />}
        items={items}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        menuId="agent-avatar-menu"
        placement="bottom"
        gutter={8}
        portal
        mountByState
      />
      <input
        accept="image/png,.png,image/jpeg,.jpg,.jpeg,image/gif,.gif,image/webp,.webp"
        multiple={false}
        type="file"
        style={{ display: 'none' }}
        onChange={(event) => {
          handleFileChange(event);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          } else {
            event.currentTarget.value = '';
          }
        }}
        ref={fileInputRef}
        tabIndex={-1}
      />
    </>
  );
}
