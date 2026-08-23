/**
 * PI workspace attachment prompt for agent/model endpoints.
 *
 * The PI backend stores every conversation's uploaded files in a workspace
 * keyed by (agentId, sessionId=conversationId); the canonical inventory is
 * fetched via the existing PIService.listPiFiles (api/server/services).
 * This module only renders the `<attachments>` system-prompt section that
 * tells the LLM which files exist and how to use them (read_text_file for
 * text files; execute_code / skills for the rest).
 */

export interface PiSessionFile {
  name: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  lastModified?: string | null;
  /** Computed by PIService.listPiFiles (MIME/extension whitelist) */
  isText?: boolean;
}

const MAX_ATTACHMENT_PROMPT_FILES = 200;

function formatSize(bytes: number | null): string {
  if (bytes == null) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Builds the `<attachments>` section appended to the agent system prompt.
 * Each file is tagged kind="text" or kind="binary" so the model picks the
 * right tool per file without trial and error. Returns null when there are
 * no workspace files.
 */
export function buildPiAttachmentsPrompt(files: PiSessionFile[]): string | null {
  if (files.length === 0) {
    return null;
  }

  const hasTextFiles = files.some((file) => file.isText !== false);

  const entries = files
    .slice(0, MAX_ATTACHMENT_PROMPT_FILES)
    .map((file) => {
      const size = formatSize(file.size);
      const meta = size ? ` (${size})` : '';
      const kind = file.isText === false ? 'binary' : 'text';
      return `  <file kind="${kind}">\n    <path>${file.path}</path>${meta}\n  </file>`;
    })
    .join('\n');

  const truncated =
    files.length > MAX_ATTACHMENT_PROMPT_FILES
      ? `\n  <!-- ${files.length - MAX_ATTACHMENT_PROMPT_FILES} more files omitted -->`
      : '';

  const textRule = hasTextFiles
    ? '- Files marked kind="text": read with the read_text_file tool, passing the <path> value EXACTLY as listed (workspace-relative, e.g. report.pdf → never /mnt/data/ paths).'
    : '';

  return `<attachments>
The following files are available in the user's file workspace for this conversation:
${entries}${truncated}

Usage rules:
- The user's message may reference files as [附件:filename] or [Attachment:filename]; these tags are the same workspace files listed above.
- ALWAYS check each file's kind attribute BEFORE choosing a tool.
${textRule}
- Files marked kind="binary" (e.g. xlsx/xls, docx/pptx, pdf, images, audio/video, archives): NEVER call read_text_file on them — it will only return an error. Process them with execute_skill or execute_code instead.
- Tool preference for kind="binary" files: FIRST try execute_skill if any skill listed in <available_skills> matches the task (e.g. document/data processing skills); only fall back to execute_code when no listed skill matches.
- Inside execute_code the same files are mounted under /mnt/data/<name>; /mnt/data/ paths are valid ONLY inside execute_code code.
</attachments>`;
}
