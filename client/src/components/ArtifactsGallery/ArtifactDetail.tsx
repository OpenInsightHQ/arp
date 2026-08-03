import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSetRecoilState } from 'recoil';
import { Button, useToastContext, Spinner } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { apiBaseUrl, QueryKeys } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { ThemeContext } from '@librechat/client';
import { Trash, ArrowLeft, ThumbsUp, Download, MessageCircle, Share2, Settings, Edit, Link as LinkIcon } from 'lucide-react';
import { dataService } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { prepareArtifactHtml, prepareArtifactHtmlForDownload } from '~/utils/artifacts';
import { BlobIframe } from '~/components/Artifacts/ArtifactPreview';
import GenericGrantAccessDialog from '../Sharing/GenericGrantAccessDialog';
import ShareArtifactDialog from './ShareArtifactDialog';
import { ResourceType } from 'librechat-data-provider';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '~/utils';
import store from '~/store';
import type { ExtendedFile } from '~/common';
import { v4 } from 'uuid';

// 兼容 v4 导入
const generateUUID = v4;

export default function ArtifactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { theme } = useContext(ThemeContext);
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();
  const setFiles = useSetRecoilState(store.filesByIndex(0));


  const [artifact, setArtifact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  
  // 配置弹窗状态
  const [showConfigDialog, setShowConfigDialog] = useState(false);

  const [configTitle, setConfigTitle] = useState('');
  const [configAutoUpdate, setConfigAutoUpdate] = useState(false);
  const [configFrequency, setConfigFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [configTime, setConfigTime] = useState('09:00');
  const [configSaving, setConfigSaving] = useState(false);
  
  // 对话按钮状态
  const [startingChat, setStartingChat] = useState(false);

  // 版本历史状态
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<Array<any>>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [versionHtml, setVersionHtml] = useState<string | null>(null);
  const [loadingVersionHtml, setLoadingVersionHtml] = useState(false);
  const [prevCurrentVersion, setPrevCurrentVersion] = useState<number | null>(null);
  
  // 分页状态
  const [versionPage, setVersionPage] = useState(1);
  const [versionTotal, setVersionTotal] = useState(0);
  const VERSION_PAGE_SIZE = 10;
  
  // 手动更新状态
  const [manualUpdating, setManualUpdating] = useState(false);

  const displayHtml = useMemo(() => {
    const raw = viewingVersion ? (versionHtml ?? '') : (artifact?.content ?? '');
    return prepareArtifactHtml(raw, {
      tailwindCDNURL: startupConfig?.tailwindCDNURL,
      echartsCDNURL: startupConfig?.echartsCDNURL,
    });
  }, [
    viewingVersion,
    versionHtml,
    artifact?.content,
    startupConfig?.tailwindCDNURL,
    startupConfig?.echartsCDNURL,
  ]);

  // 当 currentVersion 变化时（新更新），自动切回最新版本
  useEffect(() => {
    if (artifact?.currentVersion && artifact.currentVersion !== prevCurrentVersion) {
      if (prevCurrentVersion !== null) {
        // currentVersion 变化了，说明有新更新，切回最新
        setViewingVersion(null);
        setVersionHtml(null);
      }
      setPrevCurrentVersion(artifact.currentVersion);
    }
  }, [artifact?.currentVersion]);

  useEffect(() => {
    const fetchArtifact = async () => {
      try {
        setLoading(true);
        
        const response = await fetch(`${apiBaseUrl()}/api/gallery/${id}`, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        setArtifact(data);
        
        // 初始化点赞状态（从API返回的数据中获取)
        setLiked(data.isLiked || false);
        setLikeCount(data.likeCount || 0);
      } catch (err: any) {
        console.error('Error fetching artifact:', err);
        setError(err.message || localize('com_ui_load_failed'));
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchArtifact();
    }
  }, [id, token]);

  const handleDelete = async () => {
    if (!artifact || !user) return;

    if (!confirm(localize('com_arp_confirm_delete_artifact', { title: artifact.title }))) {
      return;
    }

    try {
      setDeleting(true);
      await dataService.deleteArtifact(id, user.id);
      await queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'list']);
      navigate('/artifacts');
    } catch (err: any) {
      alert(localize('com_arp_delete_failed') + '：' + (err.message || localize('com_gallery_unknown_error')));
    } finally {
      setDeleting(false);
    }
  };

  const handleLike = async () => {
    if (!artifact || !user) return;

    try {
      const response = await fetch(`${apiBaseUrl()}/api/gallery/${id}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setLiked(data.isLiked);
      setLikeCount(data.likeCount || 0);
      await queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'list']);
    } catch (err: any) {
      console.error('Like failed:', err);
      alert(localize('com_arp_like_failed') + '：' + (err.message || localize('com_gallery_unknown_error')));
    }
  };

  // 获取版本列表
  const fetchVersions = async (page: number = 1) => {
    if (!id || !token) return;
    setLoadingVersions(true);
    try {
      const response = await fetch(`${apiBaseUrl()}/api/gallery/${id}/versions?page=${page}&limit=${VERSION_PAGE_SIZE}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch versions');
      const data = await response.json();
      setVersions(data.versions || data);
      setVersionTotal(data.total || (Array.isArray(data) ? data.length : 0));
      setVersionPage(page);
    } catch (err: any) {
      console.error('Error fetching versions:', err);
      showToast({ message: localize('com_gallery_load_versions_failed'), status: 'error' });
    } finally {
      setLoadingVersions(false);
    }
  };

  // 查看特定版本
  const handleViewVersion = async (version: number) => {
    if (!id || !token) return;
    setViewingVersion(version);
    setShowVersionHistory(false); // 选择后关闭弹窗
    setLoadingVersionHtml(true);
    try {
      const response = await fetch(`${apiBaseUrl()}/api/gallery/${id}/versions/${version}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch version');
      const data = await response.json();
      setVersionHtml(data.html);
    } catch (err: any) {
      console.error('Error fetching version:', err);
      showToast({ message: localize('com_arp_load_version_failed'), status: 'error' });
    } finally {
      setLoadingVersionHtml(false);
    }
  };

  // 回到当前版本
  const handleBackToCurrent = () => {
    setViewingVersion(null);
    setVersionHtml(null);
  };

  // 启动对话：创建新对话，上传 artifact 作为附件
  const handleStartChat = async () => {
    if (!artifact || !user || startingChat) return;

    setStartingChat(true);
    showToast({ message: localize('com_arp_preparing_conversation'), status: 'info' });

    try {
      // 1. 获取 artifact 原始内容
      const contentResponse = await fetch(`${apiBaseUrl()}/api/gallery/${id}/raw`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!contentResponse.ok) {
        throw new Error(localize('com_arp_fetch_content_failed'));
      }
      
      const htmlContent = await contentResponse.text();
      
      // 2. 创建 HTML 文件
      const filename = `${artifact.title || 'artifact'}.html`;
      const file = new File([htmlContent], filename, { type: 'text/html' });
      
      // 3. 上传文件（上传给文件解释器 sandbox）
      const formData = new FormData();
      formData.append('file', file, filename);
      const file_id = generateUUID();
      formData.append('file_id', file_id);
      formData.append('endpoint', 'chat');
      formData.append('message_file', 'true');
      formData.append('tool_resource', 'execute_code'); // 关键：上传给文件解释器
      formData.append('conversationId', generateUUID());

      const uploadData = await dataService.uploadFile(formData);
      
      // 4. 设置文件到新对话的 state
      const extendedFile: ExtendedFile = {
        file_id: uploadData.file_id,
        temp_file_id: uploadData.temp_file_id,
        filepath: uploadData.filepath,
        filename: uploadData.filename,
        type: uploadData.type || 'text/html',
        size: file.size,
        progress: 1,
        file: file,
      };
      
      setFiles(new Map([[extendedFile.file_id, extendedFile]]));

      // 5. 导航到新对话，传递完整文件信息（直接 JSON，不用 Base64）
      const agentId = artifact.agentId || '';
      const fileInfo = {
        file_id: uploadData.file_id,
        temp_file_id: uploadData.temp_file_id,
        filepath: uploadData.filepath,
        filename: uploadData.filename,
        type: uploadData.type || 'text/html',
        size: file.size,
        bytes: uploadData.bytes,
      };
      const encodedFileInfo = encodeURIComponent(JSON.stringify(fileInfo));
      navigate(`/c/new?agent_id=${agentId}&file_info=${encodedFileInfo}`);

    } catch (err: any) {
      console.error('启动对话失败:', err);
      showToast({ message: localize('com_arp_start_conversation_failed') + '：' + (err.message || localize('com_gallery_unknown_error')), status: 'error' });
    } finally {
      setStartingChat(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-text-secondary">{localize('com_arp_loading')}</div>
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-text-secondary">{error || localize('com_arp_artifact_not_found')}</div>
      </div>
    );
  }

  const isOwner = user && artifact.userId === user.id;


  // 检查定时任务是否被禁用（仅所有者可见）
  const isScheduleDisabled = isOwner && artifact.schedule && !artifact.schedule.enabled && artifact.schedule.disabledReason;

  return (
    <div className="flex h-screen flex-col bg-background-primary overflow-hidden">
      {/* 定时任务失败提示横幅 - 仅所有者可见 */}
      {isScheduleDisabled && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {localize('com_arp_schedule_disabled')}
              </p>
              <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">
                {artifact.schedule.disabledReason}
                {artifact.schedule.lastError && (
                  <span className="block mt-1 opacity-75">
                    {localize('com_arp_last_error')}: {artifact.schedule.lastError}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => {
                // 打开配置弹窗让用户重新启用
                const event = new CustomEvent('open-publish-artifact', {
                  detail: {
                    artifactId: artifact.id,
                    title: artifact.title,
                    type: artifact.type,
                  }
                });
                window.dispatchEvent(event);
              }}
              className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-800 rounded-md hover:bg-red-200 dark:hover:bg-red-700 transition-colors"
            >
              {localize('com_arp_reconfigure')}
            </button>
          </div>
        </div>
      )}

      {/* 触发区域 + 浮动操作栏 - 同一个容器 */}
      <div 
        className="absolute top-0 left-0 right-0 z-50"
        onMouseEnter={() => setShowToolbar(true)}
        onMouseLeave={() => setShowToolbar(false)}
      >
        {/* 触发区域 - 透明，覆盖整个上边栏 */}
        <div className="h-20 w-full" />

        {/* 浮动操作栏 */}
        <div 
          className={`absolute top-4 left-1/2 -translate-x-1/2 transition-all duration-300 ${
            showToolbar 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
        >
          <div className="bg-surface-primary dark:bg-surface-primary rounded-full px-4 py-2 shadow-2xl border border-border-light">
            <div className="flex items-center gap-3">
              {/* 返回 */}
              <button
                onClick={() => navigate('/artifacts')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-text-primary hover:bg-surface-hover transition-colors"
                title={localize('com_arp_back')}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>

              <div className="w-px h-6 bg-border-light" />

              {/* 标题 */}
              <div className="px-2">
                <h1 className="text-sm font-semibold text-text-primary truncate max-w-md">{artifact.title}</h1>
              </div>

              <div className="w-px h-6 bg-border-light" />

              {/* 操作按钮 */}
              <div className="flex items-center gap-1 relative">
                {/* 点赞 - 所有人 */}
                <button
                  onClick={handleLike}
                  className={`p-2 rounded-full transition-colors flex items-center gap-1 ${
                    liked
                      ? 'text-red-500 hover:bg-red-50'
                      : 'text-text-primary hover:bg-surface-hover'
                  }`}
                  title={localize('com_arp_like')}
                >
                  <ThumbsUp className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
                  {likeCount > 0 && (
                    <span className="text-xs font-medium">
                      {likeCount > 999 ? '999+' : likeCount}
                    </span>
                  )}
                </button>

                {/* 下载 - 所有人 */}
                <button
                  className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors"
                  title={localize('com_arp_download')}
                  onClick={() => {
                    const html = prepareArtifactHtmlForDownload(artifact.content ?? '');
                    const blob = new Blob([html], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${artifact.title}.html`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-4 w-4" />
                </button>

                {/* 对话 - 暂时隐藏，待优化 */}
                {/*
                <button
                  className={`p-2 rounded-full transition-colors ${
                    startingChat 
                      ? 'text-text-secondary cursor-wait' 
                      : 'text-text-primary hover:bg-surface-hover'
                  }`}
                  title="对话"
                  onClick={handleStartChat}
                  disabled={startingChat}
                >
                  {startingChat ? <Spinner size={16} /> : <MessageCircle className="h-4 w-4" />}
                </button>
                */}

                {/* 版本历史 - 所有人可见 */}
                <button
                  onClick={() => {
                    fetchVersions(1);
                    setShowVersionHistory(true);
                  }}
                  className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors"
                  title={localize('com_arp_version_history')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                </button>

                {/* Owner 操作 - 仅所有者可见 */}
                {isOwner && (
                  <>
                    <div className="w-px h-5 bg-border-light mx-1" />

                    {/* 配置 */}
                    <button
                      onClick={() => {
                        setConfigTitle(artifact.title || '');
                        setConfigAutoUpdate(artifact.autoUpdate || false);
                        setConfigFrequency(artifact.updateFrequency || 'daily');
                        setConfigTime(artifact.updateTime || '09:00');
                        setShowConfigDialog(true);
                      }}
                      className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors"
                      title={localize('com_arp_configure')}
                    >
                      <Settings className="h-4 w-4" />
                    </button>

                    {/* 编辑 */}
                    <button
                      onClick={() => {
                        if (artifact.conversationId) {
                          navigate(`/c/${artifact.conversationId}`);
                        } else {
                          showToast({ message: localize('com_arp_cannot_find_conversation'), status: 'error' });
                        }
                      }}
                      className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors"
                      title={localize('com_arp_edit')}
                    >
                      <Edit className="h-4 w-4" />
                    </button>

                    {/* 分享 */}
                    {isOwner && artifact && (
                      <GenericGrantAccessDialog
                        resourceName={artifact.title || ''}
                        resourceDbId={artifact._id || ''}
                        resourceId={artifact.id}
                        resourceType={ResourceType.GALLERY_ARTIFACT}
                        hideAdminSettings={true}
                        hideCopyUrl={true}
                      >
                        <button
                          className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors"
                          title={localize('com_arp_grant_access')}
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                      </GenericGrantAccessDialog>
                    )}

                    {/* 生成链接 */}
                    {isOwner && artifact && (
                      <ShareArtifactDialog
                        artifactId={artifact.id}
                        artifactTitle={artifact.title}
                        trigger={
                          <button className="p-2 rounded-full text-text-primary hover:bg-surface-hover transition-colors" title={localize('com_arp_generate_link')}>
                            <LinkIcon className="h-4 w-4" />
                          </button>
                        }
                      />
                    )}

                    {/* 取消发布 */}
                    <button
                      onClick={async () => {
                        if (!confirm(localize('com_arp_confirm_remove_from_gallery', { title: artifact.title }))) {
                          return;
                        }
                        try {
                          await fetch(`${apiBaseUrl()}/api/gallery/${artifact.id}`, {
                            method: 'DELETE',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`,
                            },
                          });
                          navigate('/artifacts');
                        } catch (err: any) {
                          alert(localize('com_arp_delete_failed') + '：' + (err.message || localize('com_gallery_unknown_error')));
                        }
                      }}
                      className="p-2 rounded-full text-text-primary hover:bg-surface-hover hover:text-red-500 transition-colors"
                      title={localize('com_arp_unpublish')}
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区域 - 全屏显示 */}
      <div className="flex-1 h-full relative">
        {loadingVersionHtml ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size={32} />
          </div>
        ) : (
          <BlobIframe
            html={displayHtml}
            mimeType="text/html"
            title={artifact?.title || 'Loading...'}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        )}
      </div>

      {/* 配置弹窗 */}
      <Dialog.Root open={showConfigDialog} onOpenChange={setShowConfigDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface-primary p-6 shadow-2xl">
            <Dialog.Title className="mb-4 text-lg font-semibold text-text-primary">
              {localize('com_arp_artifact_settings')}
            </Dialog.Title>

            <div className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  {localize('com_ui_title')}
                </label>
                <input
                  type="text"
                  value={configTitle}
                  onChange={(e) => setConfigTitle(e.target.value)}
                  className="w-full rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-text-primary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea]"
                />
              </div>

              {/* 自动更新 */}
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text-secondary">
                  {localize('com_ui_auto_update')}
                </label>
                <button
                  type="button"
                  onClick={() => setConfigAutoUpdate(!configAutoUpdate)}
                  className={cn(
                    'relative h-6 w-11 rounded-full transition-colors',
                    configAutoUpdate ? 'bg-[#7948ea]' : 'bg-surface-tertiary'
                  )}
                >
                  <span
                    className={cn(
                      'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                      configAutoUpdate ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>

              {/* 更新频率和时间 */}
              {configAutoUpdate && (
                <div className="space-y-3 rounded-lg border border-border-light bg-surface-secondary p-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      {localize('com_ui_update_frequency')}
                    </label>
                    <div className="flex gap-2">
                      {[
                        { value: 'daily', label: localize('com_ui_daily') },
                        { value: 'weekly', label: localize('com_ui_weekly') },
                        { value: 'monthly', label: localize('com_ui_monthly') },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setConfigFrequency(option.value as typeof configFrequency)}
                          className={cn(
                            'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                            configFrequency === option.value
                              ? 'bg-[#7948ea] text-white'
                              : 'bg-surface-tertiary text-text-secondary hover:bg-surface-hover'
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                      {localize('com_ui_update_time')}
                    </label>
                    <input
                      type="time"
                      value={configTime}
                      onChange={(e) => setConfigTime(e.target.value)}
                      className="w-full rounded-lg border border-border-light bg-surface-tertiary px-3 py-2 text-text-primary focus:border-[#7948ea] focus:outline-none focus:ring-1 focus:ring-[#7948ea] dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:brightness-200"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 按钮区域 */}
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowConfigDialog(false)}>
                {localize('com_ui_cancel')}
              </Button>
              <Button
                onClick={async () => {
                  if (!configTitle.trim()) {
                    showToast({ message: localize('com_arp_please_enter_title'), status: 'error' });
                    return;
                  }

                  setConfigSaving(true);
                  try {
                    const response = await fetch(`${apiBaseUrl()}/api/gallery/${artifact.id}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        title: configTitle,
                        autoUpdate: configAutoUpdate,
                        updateFrequency: configAutoUpdate ? configFrequency : null,
                        updateTime: configAutoUpdate ? configTime : null,
                      }),
                    });

                    if (!response.ok) throw new Error(localize('com_arp_save_failed'));

                    // 更新本地状态
                    setArtifact({
                      ...artifact,
                      title: configTitle,
                      autoUpdate: configAutoUpdate,
                      updateFrequency: configAutoUpdate ? configFrequency : null,
                      updateTime: configAutoUpdate ? configTime : null,
                    });
                    await queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'list']);

                    showToast({ message: localize('com_arp_settings_saved'), status: 'success' });
                    setShowConfigDialog(false);
                  } catch (err: any) {
                    showToast({ message: err.message || localize('com_arp_save_failed'), status: 'error' });
                  } finally {
                    setConfigSaving(false);
                  }
                }}
                disabled={configSaving}
                className="bg-[#7948ea] hover:bg-[#6b3dd4]"
              >
                {configSaving ? <Spinner size={16} /> : localize('com_arp_save')}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 版本历史弹窗 */}
      <Dialog.Root open={showVersionHistory} onOpenChange={setShowVersionHistory}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-primary rounded-xl p-0 w-full max-w-3xl max-h-[70vh] overflow-hidden z-50 shadow-xl flex flex-col">
            <Dialog.Title className="text-lg font-semibold text-text-primary px-6 py-4 border-b border-border-light flex-shrink-0">
              {localize('com_gallery_version_history')}
            </Dialog.Title>
            <div className="px-6 py-2 border-b border-border-light flex-shrink-0 flex items-center justify-between">
              <span className="text-xs text-text-secondary">
                {localize('com_gallery_viewing_version')} V{viewingVersion || artifact?.currentVersion || 1}
              </span>
              <button
                onClick={async () => {
                  if (!id || !token || manualUpdating) return;
                  setManualUpdating(true);
                  try {
                    const response = await fetch(`${apiBaseUrl()}/api/gallery/${id}/manual-update`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                      },
                    });
                    if (!response.ok) throw new Error('Update failed');
                    const data = await response.json();
                    showToast({ message: data.message || localize('com_gallery_success'), status: data.status === 'failed' ? 'error' : 'success' });
                    fetchVersions(1);
                    // 刷新 artifact 以获取新的 currentVersion
                    const artifactResponse = await fetch(`${apiBaseUrl()}/api/gallery/${id}`, {
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                      },
                    });
                    if (artifactResponse.ok) {
                      const artifactData = await artifactResponse.json();
                      setArtifact(artifactData);
                    }
                    await queryClient.invalidateQueries([QueryKeys.galleryArtifacts, 'list']);
                  } catch (err: any) {
                    showToast({ message: localize('com_gallery_manual_update_failed'), status: 'error' });
                  } finally {
                    setManualUpdating(false);
                  }
                }}
                disabled={manualUpdating}
                className="text-sm px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-50"
              >
                {manualUpdating ? localize('com_gallery_updating') : localize('com_gallery_manual_update')}
              </button>
            </div>
            
            {loadingVersions ? (
              <div className="flex justify-center py-12">
                <Spinner size={24} />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-text-secondary text-center py-12">
                {localize('com_arp_no_version_records')}
              </div>
            ) : (
              <>
                {/* 表头 - 吸顶 */}
                <div className="grid grid-cols-[60px_1fr_56px_64px_1fr_32px] gap-1 px-6 py-2 bg-surface-secondary border-b border-border-light text-xs font-medium text-text-secondary flex-shrink-0">
                  <span>{localize('com_gallery_version')}</span>
                  <span>{localize('com_gallery_update_time')}</span>
                  <span className="text-center">{localize('com_gallery_status')}</span>
                  <span className="text-center">{localize('com_gallery_source')}</span>
                  <span>{localize('com_arp_info')}</span>
                  <span></span>
                </div>
                
                {/* 列表内容 - 可滚动 */}
                <div className="overflow-y-auto flex-1">
                  {versions.map((v: any) => {
                    const isSelected = viewingVersion === v.version || (!viewingVersion && v.version === artifact?.currentVersion);
                    const isFailed = v.status === 'failed';
                    return (
                      <div
                        key={v.version}
                        onClick={() => {
                          if (!isFailed) handleViewVersion(v.version);
                        }}
                        className={cn(
                          'grid grid-cols-[60px_1fr_56px_64px_1fr_32px] gap-1 px-6 py-3 border-b border-border-light transition-colors items-center',
                          isFailed ? 'cursor-default' : 'cursor-pointer',
                          isSelected
                            ? 'bg-primary/10 dark:bg-primary/20'
                            : 'hover:bg-surface-hover'
                        )}
                      >
                        {/* 版本号 */}
                        <span className="font-medium text-text-primary text-sm">
                          V{v.version}
                        </span>
                        
                        {/* 更新时间 */}
                        <span className="text-xs text-text-secondary truncate">
                          {new Date(v.createdAt).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        
                        {/* 状态 */}
                        <span className={cn(
                          'text-sm text-center font-bold',
                          isFailed ? 'text-red-500' : 'text-green-600 dark:text-green-400'
                        )}>
                          {isFailed ? '✗' : '✓'}
                        </span>
                        
                        {/* 来源 */}
                        <span className="text-xs text-text-secondary text-center">
                          {v.createdBy === 'scheduler' || v.createdBy === 'update_agent' ? localize('com_gallery_auto') : v.createdBy === 'manual' ? localize('com_gallery_manual') : localize('com_gallery_publish')}
                        </span>

                        {/* 信息列：错误信息或SQL固化信息 */}
                        {isFailed ? (
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              className="text-xs text-red-500 dark:text-red-400 truncate flex-1 cursor-default"
                              title={v.errorMessage || localize('com_gallery_unknown_error')}
                            >
                              {v.errorMessage || localize('com_gallery_unknown_error')}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(v.errorMessage || '');
                                showToast({ message: localize('com_arp_error_copied'), status: 'success' });
                              }}
                              className="flex-shrink-0 p-0.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
                              title={localize('com_arp_copy_error')}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                            </button>
                          </div>
                        ) : v.sqlMessage ? (
                          <span className="text-xs text-green-600 dark:text-green-400 truncate" title={v.sqlMessage}>
                            {v.sqlMessage}
                          </span>
                        ) : (
                          <span className="text-xs text-text-secondary">-</span>
                        )}

                        {/* 选择/错误图标 */}
                        <div className="flex items-center justify-center">
                          {isFailed ? (
                            <span className="text-red-400 text-xs">⚠️</span>
                          ) : isSelected ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* 分页 */}
                {versionTotal > VERSION_PAGE_SIZE && (
                  <div className="flex items-center justify-between px-6 py-3 border-t border-border-light flex-shrink-0">
                    <span className="text-xs text-text-secondary">
                      {localize('com_gallery_total_count').replace('{{count}}', versionTotal)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fetchVersions(versionPage - 1)}
                        disabled={versionPage <= 1}
                        className="px-3 py-1 text-xs rounded border border-border-light hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-primary"
                      >
                        {localize('com_gallery_prev_page')}
                      </button>
                      <span className="text-xs text-text-secondary">
                        {versionPage} / {Math.ceil(versionTotal / VERSION_PAGE_SIZE)}
                      </span>
                      <button
                        onClick={() => fetchVersions(versionPage + 1)}
                        disabled={versionPage >= Math.ceil(versionTotal / VERSION_PAGE_SIZE)}
                        className="px-3 py-1 text-xs rounded border border-border-light hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-primary"
                      >
                        {localize('com_gallery_next_page')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <Dialog.Close asChild>
              <button
                className="absolute top-4 right-4 p-1 rounded-full hover:bg-surface-hover text-text-secondary"
                aria-label={localize('com_arp_close')}
              >
                ✕
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  );
}
