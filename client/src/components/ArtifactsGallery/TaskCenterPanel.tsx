/* eslint-disable i18next/no-literal-string */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetRecoilState } from 'recoil';
import { Bell, CheckCircle2, Clock, ExternalLink, Trash2, Users, RefreshCw, Loader2, MessageSquare, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '~/utils';
import { useLocalize } from '~/hooks';
import { useNewConvo } from '~/hooks';
import { getTaskQueue, updateTaskQueueItem, deleteTaskQueueItem, respondTaskQueueItem, type TaskQueueItem } from 'librechat-data-provider';
import store from '~/store';

const statusConfig: Record<string, { labelKey: string; dotClass: string; bgClass: string }> = {
  pending: {
    labelKey: 'com_task_status_pending',
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
  },
  in_progress: {
    labelKey: 'com_task_status_in_progress',
    dotClass: 'bg-blue-500',
    bgClass: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
  },
  completed: {
    labelKey: 'com_task_status_completed',
    dotClass: 'bg-emerald-500',
    bgClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  approved: {
    labelKey: 'com_task_status_approved',
    dotClass: 'bg-blue-500',
    bgClass: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
  },
  rejected: {
    labelKey: 'com_task_status_rejected',
    dotClass: 'bg-red-500',
    bgClass: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
  },
};

const TaskCenterPanel: React.FC = () => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { newConversation } = useNewConvo();
  const setSubmission = useSetRecoilState(store.submissionByIndex(0));
  const setIsSubmitting = useSetRecoilState(store.isSubmittingFamily(0));
  const [tasks, setTasks] = useState<TaskQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [respondingTaskId, setRespondingTaskId] = useState<string | null>(null);
  const [userResponse, setUserResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  const handleViewExecutionSession = (task: TaskQueueItem) => {
    // 方案2：优先跳转到对话
    const conversationId = getConversationId(task);
    if (conversationId) {
      navigate(`/c/${conversationId}`);
      return;
    }
    // 方案1 兼容：跳转到 PI 执行会话文件浏览页面
    const sessionId = task.metadata?.executionSessionId as string | undefined;
    const agentId = task.metadata?.executionAgentId as string | undefined;
    if (sessionId && agentId) {
      navigate(`/arp/api/pi/files?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`);
    } else {
      // 没有执行会话，展开显示结果摘要
      setExpandedResult(expandedResult === task._id ? null : task._id);
    }
  };
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setError(null);
      const result = await getTaskQueue({ limit: 100 });
      setTasks(result?.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
      console.error('Failed to fetch task queue:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // IntersectionObserver: 面板可见时刷新
  useEffect(() => {
    const el = panelRef.current;
    if (!el) { return; }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { fetchTasks(); } },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchTasks]);

  // in_progress 任务轮询（10秒）
  useEffect(() => {
    const hasInProgress = tasks.some((t) => t.status === 'in_progress');
    if (!hasInProgress) { return; }
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, [tasks, fetchTasks]);

  const handleRefresh = () => { setRefreshing(true); fetchTasks(); };

  const handleJumpToConversation = async (task: TaskQueueItem) => {
    const conversationId = task.sourceConversationId || (task.metadata?.conversationId as string | undefined);
    if (!conversationId) { return; }
    setSubmission(null);
    setIsSubmitting(false);
    navigate(`/c/${conversationId}`);
    updateTaskQueueItem(task._id, { status: 'completed' }).then(() => {
      setTasks((prev) => prev.map((t) => (t._id === task._id ? { ...t, status: 'completed' } : t)));
    });
  };

  const handleRespond = async (taskId: string) => {
    if (!userResponse.trim()) { return; }
    setSubmitting(true);
    try {
      const result = await respondTaskQueueItem(taskId, userResponse.trim());
      // 更新本地状态
      setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, status: 'in_progress', userResponse: userResponse.trim() } : t)));

      // 查找任务
      const task = tasks.find((t) => t._id === taskId);
      if (!task) { return; }

      // 构造初始消息：需求上下文 + 用户回复意见
      const initialMessage = `【协作请求】来自: ${task.fromUserName || '未知用户'}\n标题: ${task.title}\n描述: ${task.description || '无描述'}\n\n【我的回复意见】\n${userResponse.trim()}\n\n请根据以上协作请求和我的意见，判断是否执行。如果执行，完成后简要总结结果。`;

      // 先创建新 PI 对话（buildDefault: false 防止覆盖 endpoint）
      newConversation({
        template: { endpoint: 'pi', model: 'one-pie' },
        preset: { endpoint: 'pi' },
        buildDefault: false,
      });

      // 延迟设置 pendingTaskMessage，确保 newConversation 的 navigate 完成后再写入
      // 这样 ChatView 重新挂载时能检测到
      setTimeout(() => {
        sessionStorage.setItem('pendingTaskMessage', JSON.stringify({
          taskId,
          message: initialMessage,
          timestamp: Date.now(),
        }));
      }, 100);

      setRespondingTaskId(null);
      setUserResponse('');
    } catch (err) {
      console.error('Failed to respond:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    await deleteTaskQueueItem(taskId);
    setTasks(tasks.filter((t) => t._id !== taskId));
  };

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) { return localize('com_just_now'); }
    if (diffMin < 60) { return `${diffMin} ${localize('com_min_ago')}`; }
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) { return `${diffHour} ${localize('com_hour_ago')}`; }
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) { return `${diffDay} ${localize('com_day_ago')}`; }
    return date.toLocaleDateString();
  };

  const getConversationId = (task: TaskQueueItem): string | undefined =>
    task.sourceConversationId || (task.metadata?.conversationId as string | undefined);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-text-secondary" /></div>;
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-red-500 mb-4">{error}</p>
        <button onClick={handleRefresh} className="rounded-lg border border-border-light px-4 py-2 text-sm text-text-secondary hover:text-text-primary">{localize('com_retry')}</button>
      </div>
    );
  }

  const aiTasks = tasks.filter((t) => t.type === 'ai_pending');
  const myAiTasks = aiTasks.filter((t) => t.fromUserId === t.toUserId);
  const otherAiTasks = aiTasks.filter((t) => t.fromUserId !== t.toUserId);
  const collabTasks = tasks.filter((t) => t.type === 'collaboration');
  const manualTasks = tasks.filter((t) => t.type === 'manual');
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;

  const renderSection = (labelKey: string, icon: React.ReactNode, colorClass: string, sectionTasks: TaskQueueItem[]) => {
    if (sectionTasks.length === 0) { return null; }
    const pendingInSection = sectionTasks.filter((t) => t.status === 'pending').length;
    return (
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <span className={colorClass}>{icon}</span>
          <h3 className="text-base font-semibold text-text-primary">{localize(labelKey)}</h3>
          {pendingInSection > 0 && <span className={cn('ml-1 rounded-full px-2 py-0.5 text-xs font-medium', 'bg-surface-tertiary text-text-secondary')}>{pendingInSection}</span>}
        </div>
        <div className="space-y-2">
          {sectionTasks.map((task) => {
            const sConfig = statusConfig[task.status] || statusConfig.pending;
            const hasConversation = !!getConversationId(task);
            const isFromOther = task.fromUserId !== task.toUserId;
            const isResponding = respondingTaskId === task._id;
            const isResultExpanded = expandedResult === task._id;

            return (
              <div key={task._id} className={cn('group rounded-lg border border-border-light bg-white dark:bg-[#1e1e1e] dark:border-white/10 transition-all duration-200')}>
                {/* 卡片主行 */}
                <div className="flex items-start gap-3 p-3">
                  <div className={cn('mt-1 h-2.5 w-2.5 rounded-full shrink-0', sConfig.dotClass)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-secondary mb-0.5">
                      {isFromOther ? `${localize('com_task_from')}: ${task.fromUserName || localize('com_task_creator')}` : `${localize('com_task_creator')}: ${task.fromUserName || localize('com_task_creator')}`}
                    </p>
                    <p className={cn('text-sm font-medium', task.status === 'pending' ? 'text-text-primary' : 'text-text-secondary')}>{task.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
                      {task.fromAgentId && <span>Agent: {task.fromAgentId}</span>}
                      <span>{formatTime(task.createdAt)}</span>
                    </div>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', sConfig.bgClass)}>{localize(sConfig.labelKey)}</span>

                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-1">
                    {/* 跳转对话按钮（自己的AI待办，有对话） */}
                    {task.status === 'pending' && hasConversation && !isFromOther && (
                      <button onClick={() => handleJumpToConversation(task)} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', 'text-[#7948ea] hover:bg-[#7948ea]/10 transition-colors')} title={localize('com_task_jump_conversation')}>
                        <ExternalLink className="h-3.5 w-3.5" /><span>{localize('com_task_jump_conversation')}</span>
                      </button>
                    )}

                    {/* 回复按钮（来自他人的待办） */}
                    {task.status === 'pending' && isFromOther && (
                      <button onClick={() => setRespondingTaskId(task._id)} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', 'text-[#7948ea] hover:bg-[#7948ea]/10 transition-colors')} title={localize('com_task_respond')}>
                        <MessageSquare className="h-3.5 w-3.5" /><span>{localize('com_task_respond')}</span>
                      </button>
                    )}

                    {task.status === 'completed' && (task.resultSummary || getConversationId(task)) && (
                      <button onClick={() => handleViewExecutionSession(task)} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 transition-colors">
                        {getConversationId(task) ? <ExternalLink className="h-3.5 w-3.5" /> : (isResultExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />)}
                        <span>{localize('com_task_view_result')}</span>
                      </button>
                    )}

                    <button onClick={() => handleDeleteTask(task._id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="h-4 w-4 text-text-secondary hover:text-red-500" />
                    </button>
                  </div>
                </div>

                {/* 回复面板 */}
                {isResponding && (
                  <div className="border-t border-border-light px-3 py-3 bg-surface-secondary">
                    <div className="mb-2">
                      <p className="text-xs font-medium text-text-secondary mb-1">{localize('com_task_original_request')}</p>
                      <p className="text-sm text-text-primary bg-surface-default rounded-md px-3 py-2 border border-border-light">{task.description || task.title}</p>
                    </div>
                    <div className="mb-2">
                      <label className="text-xs font-medium text-text-secondary mb-1 block">{localize('com_task_your_response')}</label>
                      <textarea
                        value={userResponse}
                        onChange={(e) => setUserResponse(e.target.value)}
                        placeholder={localize('com_task_response_placeholder')}
                        rows={3}
                        className="w-full rounded-md border border-border-light bg-surface-default px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-[#7948ea] resize-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => { setRespondingTaskId(null); setUserResponse(''); }} className="rounded-lg border border-border-light px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">{localize('com_task_cancel')}</button>
                      <button onClick={() => handleRespond(task._id)} disabled={!userResponse.trim() || submitting} className={cn('rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors', (!userResponse.trim() || submitting) ? 'bg-[#7948ea]/50 cursor-not-allowed' : 'bg-[#7948ea] hover:bg-[#7948ea]/90')}>
                        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : localize('com_task_confirm_execute')}
                      </button>
                    </div>
                  </div>
                )}

                {/* 结果摘要面板 */}
                {isResultExpanded && task.resultSummary && (
                  <div className="border-t border-border-light px-3 py-3 bg-emerald-50/50 dark:bg-emerald-500/5">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">{localize('com_task_result')}</p>
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{task.resultSummary}</p>
                    {task.userResponse && (
                      <>
                        <p className="text-xs font-medium text-text-secondary mt-2 mb-1">{localize('com_task_your_response')}</p>
                        <p className="text-sm text-text-secondary italic">{task.userResponse}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl" ref={panelRef}>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5', 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200')}>
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">{pendingCount} {localize('com_task_pending_items')}</span>
          </div>
        </div>
        <button onClick={handleRefresh} className={cn('rounded-full p-2 text-text-secondary hover:text-text-primary transition-colors', refreshing && 'animate-spin')} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {renderSection('com_task_section_my_ai', <Bell className="h-4 w-4" />, 'text-[#7948ea]', myAiTasks)}
      {renderSection('com_task_section_other_ai', <Users className="h-4 w-4" />, 'text-blue-600 dark:text-blue-400', otherAiTasks)}
      {renderSection('com_task_section_collab', <Users className="h-4 w-4" />, 'text-blue-600 dark:text-blue-400', collabTasks)}
      {renderSection('com_task_section_manual', <CheckCircle2 className="h-4 w-4" />, 'text-emerald-600 dark:text-emerald-400', manualTasks)}

      {tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <h2 className="mb-2 text-xl font-medium text-text-primary">{localize('com_task_all_clear')}</h2>
          <p className="max-w-md text-center text-sm text-text-secondary">{localize('com_task_all_clear_hint')}</p>
        </div>
      )}
    </div>
  );
};

export default TaskCenterPanel;
