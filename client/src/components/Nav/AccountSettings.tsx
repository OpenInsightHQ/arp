import { useState, memo, useRef } from 'react';
import * as Select from '@ariakit/react/select';
import { Database, KeyRound, LogOut, Sparkles, MessageSquareQuote } from 'lucide-react';
import { LinkIcon, GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import Settings from './Settings';
import MemoryModal from './MemoryModal';
import SkillModal from './SkillModal';
import PromptModal from './PromptModal';
import CredentialModal from './CredentialModal';

function AccountSettings() {
  const localize = useLocalize();
  const { user, isAuthenticated, logout } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Select.SelectProvider>
      <Select.Select
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className="mt-text-sm flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt"
      >
        <div className="-ml-0.9 -mt-0.8 h-8 w-8 flex-shrink-0">
          <div className="relative flex">
            <Avatar user={user} size={32} />
          </div>
        </div>
        <div
          className="mt-2 grow overflow-hidden text-ellipsis whitespace-nowrap text-left text-text-primary"
          style={{ marginTop: '0', marginLeft: '0' }}
        >
          {user?.name ?? user?.username ?? localize('com_nav_user')}
        </div>
      </Select.Select>
      <Select.SelectPopover
        className="account-settings-popover popover-ui z-[125] w-[305px] rounded-lg md:w-[244px]"
        style={{
          transformOrigin: 'bottom',
          translate: '0 -4px',
        }}
      >
        <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        <DropdownMenuSeparator />
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <>
            <div className="text-token-text-secondary ml-3 mr-2 py-2 text-sm" role="note">
              {localize('com_nav_balance')}:{' '}
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <Select.SelectItem
          value=""
          onClick={() => setShowMemory(true)}
          className="select-item text-sm"
        >
          <Database className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_memories')}
        </Select.SelectItem>
        <Select.SelectItem
          value=""
          onClick={() => setShowSkills(true)}
          className="select-item text-sm"
        >
          <Sparkles className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_skills')}
        </Select.SelectItem>
        <Select.SelectItem
          value=""
          onClick={() => setShowCredentials(true)}
          className="select-item text-sm"
        >
          <KeyRound className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_credentials')}
        </Select.SelectItem>
        <Select.SelectItem
          value=""
          onClick={() => setShowPrompts(true)}
          className="select-item text-sm"
        >
          <MessageSquareQuote className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_prompts')}
        </Select.SelectItem>
        {startupConfig?.helpAndFaqURL !== '/' && (
          <Select.SelectItem
            value=""
            onClick={() => window.open(startupConfig?.helpAndFaqURL, '_blank')}
            className="select-item text-sm"
          >
            <LinkIcon aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Select.SelectItem>
        )}
        <Select.SelectItem
          value=""
          onClick={() => setShowSettings(true)}
          className="select-item text-sm"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Select.SelectItem>
        <DropdownMenuSeparator />
        <Select.SelectItem
          aria-selected={true}
          onClick={() => logout()}
          value="logout"
          className="select-item text-sm"
        >
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Select.SelectItem>
      </Select.SelectPopover>
      {showSettings && <Settings open={showSettings} onOpenChange={setShowSettings} />}
      {showMemory && <MemoryModal open={showMemory} onOpenChange={setShowMemory} />}
      {showSkills && <SkillModal open={showSkills} onOpenChange={setShowSkills} />}
      {showPrompts && <PromptModal open={showPrompts} onOpenChange={setShowPrompts} />}
      {showCredentials && (
        <CredentialModal open={showCredentials} onOpenChange={setShowCredentials} />
      )}
    </Select.SelectProvider>
  );
}

export default memo(AccountSettings);
