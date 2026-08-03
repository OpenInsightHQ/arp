import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, NewChatIcon, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { useAuthContext, useLocalize } from '~/hooks';
import type { GalleryArtifactItem, GalleryArtifactsParams } from 'librechat-data-provider';
import { useGalleryArtifactsQuery, useGetStartupConfig } from '~/data-provider';
import { OpenSidebar } from '~/components/Chat/Menus';
import SearchBar from '~/components/Agents/SearchBar';
import ArtifactCard from './ArtifactCard';
import SkillTaskTimelineMock from './SkillTaskTimelineMock';
import TaskCenterPanel from './TaskCenterPanel';
import { cn } from '~/utils';
import type { ContextType } from '~/common';

// TAB 类型
type ArtifactTab = 'HTML' | 'SKILL' | 'TASK';

const TABS: { value: ArtifactTab; labelKey: string }[] = [
  { value: 'HTML', labelKey: 'com_ui_tab_report' },
  { value: 'SKILL', labelKey: 'com_ui_tab_skill' },
  { value: 'TASK', labelKey: 'com_ui_tab_task' },
];

const ArtifactsGallery: React.FC = () => {
  const localize = useLocalize();
  const { isAuthenticated, user } = useAuthContext();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { data: startupConfig } = useGetStartupConfig();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<ArtifactTab>(
    (searchParams.get('tab') as ArtifactTab) || 'HTML',
  );
  const galleryParams = React.useMemo<GalleryArtifactsParams>(() => {
    const params: GalleryArtifactsParams = { type: 'HTML' };
    const search = searchQuery.trim();
    if (search) {
      params.search = search;
    }
    if (user?.id) {
      params.userId = user.id;
    }
    return params;
  }, [searchQuery, user?.id]);
  const {
    data: galleryData,
    error,
    isFetching,
    isLoading,
  } = useGalleryArtifactsQuery(galleryParams, { enabled: isAuthenticated && !!user?.id });
  const artifacts = galleryData?.artifacts ?? [];
  const hasNextPage = galleryData?.hasNextPage ?? false;
  const loading = isLoading && isFetching;

  // 打字机动效
  const subtitleText = localize('com_ui_portfolio_subtitle');
  const [typedText, setTypedText] = useState<string>('');
  const [charIndex, setCharIndex] = useState<number>(0);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // 打字机效果
  useEffect(() => {
    const typingSpeed = 150;
    const deletingSpeed = 50;
    const pauseDuration = 4000;

    let timeout: NodeJS.Timeout;

    if (isPaused) {
      // 暂停后开始删除
      timeout = setTimeout(() => {
        setIsPaused(false);
        setIsDeleting(true);
      }, pauseDuration);
    } else if (isDeleting) {
      // 删除文字
      if (charIndex > 0) {
        timeout = setTimeout(() => {
          setCharIndex(charIndex - 1);
        }, deletingSpeed);
      } else {
        // 删除完成，重新开始
        setIsDeleting(false);
        setCharIndex(0);
      }
    } else {
      // 输入文字
      if (charIndex < subtitleText.length) {
        // 先立即显示当前字符
        const nextIndex = charIndex + 1;

        // 然后判断是否需要停顿
        const char = subtitleText[charIndex];
        const isPunctuation = /[？。，、！,.?!]/.test(char);
        const speed = isPunctuation ? typingSpeed + 1500 : typingSpeed;

        timeout = setTimeout(() => {
          setCharIndex(nextIndex);
        }, speed);
      } else {
        // 输入完成，暂停
        setIsPaused(true);
      }
    }

    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, isPaused, subtitleText]);

  // 更新显示文本
  useEffect(() => {
    setTypedText(subtitleText.substring(0, charIndex));
  }, [charIndex, subtitleText]);

  // 打开完整 artifact - 暂时禁用
  // const [selectedArtifact, setSelectedArtifact] = useState<GalleryArtifactItem | null>(null);

  const handleArtifactClick = useCallback(
    (artifact: GalleryArtifactItem) => {
      // 跳转到 artifact 详情页面
      navigate(`/artifacts/${artifact.id}`);
    },
    [navigate],
  );

  const handleNewChat = useCallback(() => {
    window.location.href = '/c/new';
  }, []);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-800">
      {/* Header - 参考智能体市场 */}
      {!isSmallScreen && (
        <div className="sticky top-0 z-20 flex items-center justify-between bg-white p-2 font-semibold text-text-primary dark:bg-gray-800 md:h-14">
          <div className="mx-1 flex items-center gap-2">
            {!navVisible ? (
              <>
                {!startupConfig?.leftSidebarButtonHidden && (
                  <OpenSidebar setNavVisible={setNavVisible} />
                )}
                <TooltipAnchor
                  description={localize('com_ui_new_chat')}
                  render={
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={localize('com_ui_new_chat')}
                      className="rounded-xl border border-border-light bg-surface-secondary p-2 hover:bg-surface-active-alt max-md:hidden"
                      onClick={handleNewChat}
                    >
                      <NewChatIcon />
                    </Button>
                  }
                />
              </>
            ) : (
              <div className="h-10 w-10" />
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Hero Section - scrolls away */}
        {!isSmallScreen && (
          <div className="container mx-auto max-w-4xl">
            <div className={cn('text-center', 'mb-8 mt-12')}>
              <h1 className="mb-3 text-3xl font-bold tracking-tight text-text-primary md:text-5xl">
                {localize('com_ui_portfolio')}
              </h1>
              <p
                className="mx-auto mb-6 min-h-[1.75rem] max-w-4xl whitespace-nowrap text-lg text-text-primary"
                style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  textShadow: 'none',
                }}
              >
                {typedText}
                <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-text-primary align-middle"></span>
              </p>
            </div>
          </div>
        )}

        {/* Sticky wrapper for search bar and tabs - 参考智能体市场 */}
        <div className={cn('sticky z-10 bg-white dark:bg-gray-800', 'top-0')}>
          <div className="container mx-auto max-w-4xl px-4">
            {/* Search Bar - 居中，与智能体市场一致 */}
            <div className="mx-auto flex max-w-2xl justify-center pb-6 pt-0">
              <SearchBar
                value={searchQuery}
                onSearch={setSearchQuery}
                placeholder={localize('com_ui_search_artifacts')}
              />
            </div>

            {/* TABs - 参考智能体市场样式 */}
            <div className="w-full pb-4">
              <div
                className={cn(
                  'px-4',
                  isSmallScreen
                    ? 'flex gap-2 overflow-x-auto scroll-smooth'
                    : 'flex flex-wrap justify-center gap-1.5',
                )}
                role="tablist"
                aria-label={localize('com_ui_artifact_category')}
              >
                {TABS.map((tab) => (
                  <button
                    key={tab.value}
                    id={`artifact-tab-${tab.value}`}
                    role="tab"
                    aria-selected={activeTab === tab.value}
                    aria-controls={`artifact-panel-${tab.value}`}
                    onClick={() => {
                      setActiveTab(tab.value);
                      setSearchParams(tab.value === 'HTML' ? {} : { tab: tab.value });
                    }}
                    className={cn(
                      'rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                      activeTab === tab.value
                        ? 'bg-[#7948ea] text-white'
                        : 'bg-surface-tertiary text-text-secondary hover:bg-surface-active-alt hover:text-text-primary',
                    )}
                  >
                    {localize(tab.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 pt-6">
          <div className="container mx-auto max-w-6xl">
            {activeTab === 'TASK' && <TaskCenterPanel />}
            {activeTab === 'SKILL' && <SkillTaskTimelineMock searchQuery={searchQuery} />}
            <div hidden={activeTab !== 'HTML'} aria-hidden={activeTab !== 'HTML'}>
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="text-text-secondary">{localize('com_ui_loading')}</div>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-20">
                  {/* eslint-disable-next-line i18next/no-literal-string */}
                  <div className="mb-4 text-6xl">⚠️</div>
                  <h2 className="mb-2 text-xl font-medium text-text-primary">
                    {localize('com_ui_load_failed')}
                  </h2>
                  <p className="text-text-secondary">{localize('com_ui_load_failed')}</p>
                </div>
              ) : artifacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="mb-4 text-6xl">{searchQuery ? '🔍' : '📊'}</div>
                  <h2 className="mb-2 text-xl font-medium text-text-primary">
                    {searchQuery
                      ? localize('com_ui_no_matching_artifacts')
                      : localize('com_ui_no_artifacts')}
                  </h2>
                  <p className="max-w-md text-center text-text-secondary">
                    {searchQuery
                      ? localize('com_ui_try_other_keywords')
                      : localize('com_ui_empty_artifacts_hint')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="mx-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {artifacts.map((artifact, index) => (
                      <ArtifactCard
                        key={artifact.id}
                        artifact={artifact}
                        index={index}
                        onClick={handleArtifactClick}
                        enableLazyLoading={activeTab === 'HTML'}
                      />
                    ))}
                  </div>
                  {!loading && !hasNextPage && artifacts.length > 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
                      <p className="text-sm">{localize('com_ui_end_of_results')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtifactsGallery;
