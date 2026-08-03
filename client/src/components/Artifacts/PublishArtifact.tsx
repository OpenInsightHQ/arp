import React, { useState, useCallback, useEffect } from 'react';
import { Upload, CircleCheckBig } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Button, Spinner, useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalize, useAuthContext } from '~/hooks';
import { useArtifactsContext, useChatContext, useAgentsMapContext } from '~/Providers';
import { cn } from '~/utils';
import { getPublishedArtifactStatus, publishArtifact, QueryKeys } from 'librechat-data-provider';
import { buildArtifactPublishPayload } from './publishArtifactPayload';

interface PublishArtifactProps {
  artifact: {
    id: string;
    identifier?: string;
    title?: string;
    type?: string;
    messageId?: string;
    conversationId?: string;
    content?: string;
  };
  onPublishSuccess?: () => void;
}

const PublishArtifact = ({ artifact, onPublishSuccess }: PublishArtifactProps) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthContext();
  const { conversationId } = useArtifactsContext();
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [title, setTitle] = useState(artifact.title || '');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [updateFrequency, setUpdateFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [updateTime, setUpdateTime] = useState('09:00');
  
  // 监听来自 ArtifactDetail 的配置事件
  useEffect(() => {
    const handleOpenPublish = (e: CustomEvent) => {
      const { artifactId, title: eventTitle, updateFrequency: freq, autoUpdate: auto } = e.detail || {};
      
      // 预填充信息
      if (eventTitle) setTitle(eventTitle);
      if (freq) setUpdateFrequency(freq);
      if (auto !== undefined) setAutoUpdate(auto);
      
      // 打开弹窗
      setIsOpen(true);
      setIsPublished(!!artifactId);
    };
    
    window.addEventListener('open-publish-artifact', handleOpenPublish as EventListener);
    return () => window.removeEventListener('open-publish-artifact', handleOpenPublish as EventListener);
  }, []);

  const handleOpenChange = async (open: boolean) => {
    if (isPublishing) return;
    setIsOpen(open);
    if (open) {
      setTitle(artifact.title || '');
      setIsPublished(false);

      // 查询当前用户是否已经发布过这个精确的 Artifact 版本。
      if (artifact.id && artifact.messageId) {
        try {
          const existingArtifact = await getPublishedArtifactStatus(
            artifact.id,
            artifact.messageId,
          );
          if (existingArtifact) {
            setAutoUpdate(existingArtifact.autoUpdate || false);
            setUpdateFrequency(existingArtifact.updateFrequency || 'daily');
            setUpdateTime(existingArtifact.updateTime || '09:00');
            setIsPublished(true);
          }
        } catch (error) {
          console.error('[PublishArtifact] Failed to fetch existing artifact:', error);
          // 失败时使用默认值
          setAutoUpdate(false);
          setUpdateFrequency('daily');
          setUpdateTime('09:00');
        }
      }
    }
  };

  const handlePublish = useCallback(async () => {
    if (!title.trim() || !conversationId || !artifact.id || !artifact.messageId) {
      showToast({ message: localize('com_ui_missing_required') || '缺少必要信息', status: 'error' });
      return;
    }

    if (!isAuthenticated) {
      showToast({ message: localize('com_ui_not_authenticated') || '请先登录', status: 'error' });
      return;
    }

    setIsPublishing(true);
    try {
      // 获取 Agent 信息
      const agentId = conversation?.agent_id || conversation?.assistant_id || null;
      const agentName = agentId ? (agentsMap?.[agentId]?.name ?? null) : null;


      const result = await publishArtifact(
        buildArtifactPublishPayload(artifact, {
          title,
          conversationId,
          autoUpdate,
          updateFrequency,
          updateTime,
          agentId,
          agentName,
        }),
      );
      setIsPublished(true);
      await queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'list']);
      // 根据 SQL 固化结果显示不同提示
      if (result.sqlResult) {
        if (result.sqlResult.success) {
          showToast({ message: localize('com_arp_publish_success_queries', { count: result.sqlResult.count }), status: 'success' });
        } else {
          showToast({ message: localize('com_arp_publish_success_no_queries'), status: 'warning' });
        }
      } else {
        showToast({ message: localize('com_ui_publish_success'), status: 'success' });
      }
      onPublishSuccess?.();
      setIsOpen(false);

    } catch (error) {
      console.error('Publish failed:', error);
      showToast({ message: localize('com_ui_publish_error') || '发布失败', status: 'error' });
    } finally {
      setIsPublishing(false);
    }
  }, [title, artifact, conversationId, autoUpdate, updateFrequency, updateTime, isAuthenticated, localize, showToast, onPublishSuccess, conversation, agentsMap, queryClient]);

  const handleViewInGallery = useCallback(() => {
    setIsOpen(false);
    navigate('/artifacts');
  }, [navigate]);

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => handleOpenChange(true)}
        aria-label={localize('com_ui_publish_artifact') || '发布为作品'}
      >
        {isPublished ? (
          <CircleCheckBig size={16} className="text-green-500" aria-hidden="true" />
        ) : (
          <Upload size={16} aria-hidden="true" />
        )}
      </Button>

      <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-primary p-6 shadow-2xl">
            <Dialog.Title className="mb-4 text-lg font-semibold text-text-primary">
              {localize('com_ui_publish_artifact') || '发布为作品'}
            </Dialog.Title>

            <div className="space-y-4">
              {/* 标题输入 */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  {localize('com_ui_bookmarks_title') || '标题'}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-text-primary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea]"
                  placeholder={`${localize('com_ui_enter')} ${localize('com_ui_bookmarks_title')}`}
                />
              </div>

              {/* 自动更新开关 */}
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text-secondary">
                  {localize('com_ui_auto_update') || '自动更新'}
                </label>
                <button
                  type="button"
                  onClick={() => setAutoUpdate(!autoUpdate)}
                  className={cn(
                    'relative h-6 w-11 rounded-full transition-colors',
                    autoUpdate ? 'bg-[#7948ea]' : 'bg-surface-tertiary'
                  )}
                >
                  <span
                    className={cn(
                      'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                      autoUpdate ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>

              {/* 更新频率和时间（仅当开启自动更新时显示） */}
              {autoUpdate && (
                <div className="space-y-3 rounded-lg border border-border-light bg-surface-secondary p-3">
                  {/* 频率选择 */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      {localize('com_ui_update_frequency') || '更新频率'}
                    </label>
                    <div className="flex gap-2">
                      {[
                        { value: 'daily', label: localize('com_ui_daily') || '每天' },
                        { value: 'weekly', label: localize('com_ui_weekly') || '每周' },
                        { value: 'monthly', label: localize('com_ui_monthly') || '每月' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setUpdateFrequency(option.value as typeof updateFrequency)}
                          className={cn(
                            'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                            updateFrequency === option.value
                              ? 'bg-[#7948ea] text-white'
                              : 'bg-surface-tertiary text-text-secondary hover:bg-surface-hover'
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 时间选择 */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      {localize('com_ui_update_time') || '更新时间'}
                    </label>
                    <input
                      type="time"
                      value={updateTime}
                      onChange={(e) => setUpdateTime(e.target.value)}
                      className="w-full rounded-lg border border-border-light bg-surface-tertiary px-3 py-2 text-text-primary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea] dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:brightness-200"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 按钮区域 */}
            <div className="mt-6 flex justify-end gap-3">
              {isPublished ? (
                <>
                  <Button variant="outline" onClick={() => setIsOpen(false)}>
                    {localize('com_ui_close') || '关闭'}
                  </Button>
                  <Button
                    onClick={handleViewInGallery}
                    className="bg-[#7948ea] hover:bg-[#6b3dd4]"
                  >
                    {localize('com_ui_view_gallery') || '查看工作台'}
                  </Button>
                </>
              ) : (
                <>
                  <Dialog.Close asChild>
                    <Button variant="outline" disabled={isPublishing}>
                      {localize('com_ui_cancel') || '取消'}
                    </Button>
                  </Dialog.Close>
                  <Button
                    onClick={handlePublish}
                    disabled={!title.trim() || isPublishing}
                    className="bg-[#7948ea] hover:bg-[#6b3dd4]"
                  >
                    {isPublishing ? (
                      <Spinner size={16} />
                    ) : (
                      localize('com_ui_publish') || '发布'
                    )}
                  </Button>
                </>
              )}
            </div>

            <Dialog.Close asChild>
              <button
                className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100"
                aria-label="Close"
              >
              <span className="sr-only">{localize('com_ui_close')}</span>
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};

export default PublishArtifact;
