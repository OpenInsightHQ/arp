/** Update Report Tool - Auto-update report with latest data */
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { logger } from '@librechat/data-schemas';

export const createUpdateReportTool = ({
  galleryArtifactId,
  userId,
  onUpdateReport,
}: {
  galleryArtifactId: string;
  userId: string;
  onUpdateReport: (data: { galleryArtifactId: string; userId: string }) => Promise<{ version: number; success: boolean; error?: string }>;
}) => {
  return tool(
    async () => {
      try {
        const result = await onUpdateReport({
          galleryArtifactId,
          userId,
        });

        if (result.success) {
          return `✅ 报告已更新为 V${result.version} 版本`;
        } else {
          return `❌ 更新失败: ${result.error || '未知错误'}`;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('UpdateReport tool failed', error);
        return `❌ 更新失败: ${errorMessage}`;
      }
    },
    {
      name: 'update_report',
      description: `更新报告数据。调用此工具将自动执行已保存的SQL查询并用最新数据更新报告。无需额外参数，直接调用即可。调用后请简短回复用户结果，不要输出技术细节。`,
      schema: z.object({}),
    }
  );
};
