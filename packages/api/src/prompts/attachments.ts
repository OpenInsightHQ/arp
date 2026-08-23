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
 * Returns null when there are no workspace files.
 */
export function buildPiAttachmentsPrompt(files: PiSessionFile[]): string | null {
  if (files.length === 0) {
    return null;
  }

  const entries = files
    .slice(0, MAX_ATTACHMENT_PROMPT_FILES)
    .map((file) => {
      const size = formatSize(file.size);
      const meta = size ? ` (${size})` : '';
      return `  <file>\n    <path>${file.path}</path>${meta}\n  </file>`;
    })
    .join('\n');

  const truncated =
    files.length > MAX_ATTACHMENT_PROMPT_FILES
      ? `\n  <!-- ${files.length - MAX_ATTACHMENT_PROMPT_FILES} more files omitted -->`
      : '';

  return `<attachments>
The following files are available in the user's file workspace for this conversation:
${entries}${truncated}

Usage rules:
- The user's message may reference files as [附件:filename] or [Attachment:filename]; these tags are the same workspace files listed above.
- Use the read_text_file tool to read the content of text files. Pass the <path> value above EXACTLY as-is (workspace-relative, e.g. report.pdf, data/values.csv). Do NOT use /mnt/data/ paths with read_text_file — that prefix only exists inside the execute_code sandbox.
- Binary and non-text files (e.g. images, PDF, office documents, archives) cannot be read with read_text_file: process them with the execute_code tool or a configured skill instead (inside execute_code the same files appear under /mnt/data/<name>).
</attachments>`;
}
