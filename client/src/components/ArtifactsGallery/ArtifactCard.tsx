import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  BarChart3,
  Code,
  Presentation,
  Heart,
  Eye,
  User,
  MessageCircle,
} from 'lucide-react';
import { createAvatar } from '@dicebear/core';
import { initials } from '@dicebear/collection';
import type { GalleryArtifactItem } from 'librechat-data-provider';
import useLazyLoad from '~/hooks/Artifacts/useLazyLoad';
import { useLocalize } from '~/hooks';

export type ArtifactCardData = GalleryArtifactItem & {
  user?: {
    id?: string;
    username?: string;
    name?: string;
    avatar?: string;
  };
  likes?: number;
};

interface ArtifactCardProps {
  artifact: ArtifactCardData;
  onClick?: (artifact: ArtifactCardData) => void;
  index?: number;
  enableLazyLoading?: boolean;
}

const typeIcons: Record<string, React.ReactNode> = {
  HTML: <FileText className="h-5 w-5" />,
  SKILL: <Code className="h-5 w-5" />,
};

const typeLabelKeys: Record<string, string> = {
  HTML: 'com_ui_report',
  SKILL: 'com_ui_skill',
};

const typeColors: Record<string, string> = {
  HTML: 'bg-purple-500 text-white',
  SKILL: 'bg-purple-500 text-white',
};

// Hover 滚动预览组件 - 使用 iframe 隔离样式
const HoverScrollPreview: React.FC<{ content?: string; loaded?: boolean }> = ({
  content,
  loaded = true,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // 写入 HTML 到 iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !content) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    // 写入 HTML 内容到 iframe
    const cleanContent = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    doc.open();
    doc.write(cleanContent);
    doc.close();

    // 添加滚动容器包装
    const body = doc.body;
    const html = doc.documentElement;
    if (body && html) {
      // 设置样式使内容可滚动
      body.style.margin = '0';
      body.style.padding = '0';
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
    }
  }, [content, loaded]);

  // Hover 自动滚动 - 速度曲线：加速(2s) -> 匀速 -> 减速(最后300px)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !isHovered) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      // 重置滚动位置
      const doc = iframe?.contentDocument;
      if (doc?.defaultView) {
        doc.defaultView.scrollTo(0, 0);
      }
      return;
    }

    const doc = iframe.contentDocument;
    const win = doc?.defaultView;
    if (!doc || !win) return;

    // 计算滚动距离
    const maxScroll = Math.max(
      doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
      doc.body.scrollHeight - doc.body.clientHeight,
      0,
    );

    if (maxScroll <= 0) return;

    // 速度参数
    const minSpeed = 50; // 起始速度：50px/s
    const maxSpeed = 400; // 最高速度：400px/s
    const accelerationTime = 2000; // 加速时间：2秒
    const decelerationDistance = 300; // 减速距离：最后300px

    startTimeRef.current = performance.now();
    let lastTimestamp = startTimeRef.current;
    let currentScroll = 0;

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTimestamp) / 1000; // 转换为秒
      lastTimestamp = currentTime;

      // 计算当前应该的速度
      const elapsed = currentTime - startTimeRef.current;

      // 计算已滚动距离占总距离的比例
      const scrollProgress = currentScroll / maxScroll;
      const remainingDistance = maxScroll - currentScroll;

      let currentSpeed: number;

      if (remainingDistance <= decelerationDistance) {
        // 减速阶段：最后 300px 内，从当前速度减速回 minSpeed
        const decelerationProgress = 1 - remainingDistance / decelerationDistance;
        currentSpeed = maxSpeed - (maxSpeed - minSpeed) * decelerationProgress;
      } else if (elapsed < accelerationTime) {
        // 加速阶段：2秒内从 minSpeed 加速到 maxSpeed
        const accelerationProgress = elapsed / accelerationTime;
        // 线性加速
        currentSpeed = minSpeed + (maxSpeed - minSpeed) * accelerationProgress;
      } else {
        // 最高速阶段：保持 maxSpeed
        currentSpeed = maxSpeed;
      }

      // 限制速度范围
      currentSpeed = Math.max(minSpeed, Math.min(maxSpeed, currentSpeed));

      // 更新滚动位置
      currentScroll += currentSpeed * deltaTime;
      currentScroll = Math.min(currentScroll, maxScroll);

      win.scrollTo(0, currentScroll);

      if (currentScroll < maxScroll && isHovered) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isHovered, content]);

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        <FileText className="h-8 w-8 opacity-50" />
      </div>
    );
  }

  if (!loaded) {
    return <div className="h-full w-full animate-pulse bg-surface-tertiary" />;
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <iframe
        ref={iframeRef}
        className="h-full w-full border-0"
        style={{
          transform: 'scale(0.74)',
          transformOrigin: 'top left',
          width: '135%',
          height: '135%',
        }}
        title="artifact preview"
        sandbox="allow-same-origin"
      />
    </div>
  );
};

const ArtifactCard: React.FC<ArtifactCardProps> = ({
  artifact,
  onClick,
  index = 0,
  enableLazyLoading = true,
}) => {
  const localize = useLocalize();
  const { ref: lazyRef, loaded } = useLazyLoad({
    enabled: enableLazyLoading && !!artifact.content && !artifact.preview,
  });

  const handleClick = () => {
    onClick?.(artifact);
  };

  // 生成默认头像（与左下角设置一致，使用 DiceBear initials）
  const defaultAvatar = useMemo(() => {
    const username = artifact.user?.username || artifact.user?.name;
    if (!username) return null;

    try {
      const avatar = createAvatar(initials, {
        seed: username,
        fontFamily: ['Verdana'],
        fontSize: 36,
        backgroundType: ['solid'],
        backgroundColor: [
          'd81b60',
          '8e24aa',
          '5e35b1',
          '3949ab',
          'DB3733',
          '1B79CC',
          '027CB8',
          '008291',
          '008577',
          '58802F',
          '8A761D',
          '9C6D00',
          'B06200',
          'D1451A',
        ],
        textColor: ['ffffff'],
      });
      return avatar.toDataUri();
    } catch (e) {
      console.error('Failed to generate default avatar:', e);
      return null;
    }
  }, [artifact.user?.username, artifact.user?.name]);

  // 使用用户自定义头像或默认头像
  const displayAvatar = artifact.user?.avatar || defaultAvatar;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      className="group cursor-pointer"
      onClick={handleClick}
    >
      <div className="overflow-hidden rounded-xl border border-border-light bg-surface-primary shadow-sm transition-all group-hover:border-purple-300 group-hover:shadow-lg">
        {/* Preview Area with Hover Scroll */}
        <div ref={lazyRef} className="relative h-44 overflow-hidden bg-surface-secondary">
          {artifact.preview ? (
            <img
              src={artifact.preview}
              alt={artifact.title}
              className="h-full w-full object-cover"
            />
          ) : artifact.content ? (
            <HoverScrollPreview content={artifact.content} loaded={loaded} />
          ) : (
            <div className="flex h-full items-center justify-center text-text-secondary">
              {typeIcons[artifact.type] || typeIcons.HTML}
            </div>
          )}

          {/* Top overlay for labels - 不透明背景 */}
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-2">
            {/* Type Badge */}
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[artifact.type] || typeColors.HTML}`}
            >
              {typeIcons[artifact.type]}
              <span>{localize(typeLabelKeys[artifact.type] || 'com_ui_artifact')}</span>
            </div>

            {/* Stats: 点赞数 + 观看数 */}
            <div className="flex items-center gap-3 text-xs text-white">
              {/* 点赞数 */}
              <div className="flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" />
                <span className="font-medium">{artifact.likes ?? artifact.likeCount ?? 0}</span>
              </div>
              {/* 观看数 */}
              <div className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                <span className="font-medium">{artifact.viewCount ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Info - Xiaohongshu style bottom layout */}
        <div className="p-3">
          {/* Report Title */}
          <h3 className="mb-2 truncate text-sm font-medium text-text-primary">{artifact.title}</h3>

          {/* Bottom row: User info (left) + Interaction info (right) */}
          <div className="flex items-center justify-between">
            {/* Left: User avatar + username */}
            <div className="flex items-center gap-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt={artifact.user?.username || artifact.user?.name || 'User'}
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : (
                  <User className="h-3.5 w-3.5 text-white" />
                )}
              </div>
              <span className="max-w-[80px] truncate text-xs text-text-secondary">
                {artifact.user?.username ||
                  artifact.user?.name ||
                  localize('com_ui_anonymous_user')}
              </span>
            </div>

            {/* Right: Updated time */}
            <div className="text-xs text-text-secondary">
              {new Date(artifact.updatedAt).toLocaleString(undefined, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default ArtifactCard;
