import { Tools } from 'librechat-data-provider';
import { replaceSpecialVars } from 'librechat-data-provider';

const WEB_SEARCH_CONTEXT_TEMPLATE = `# \`${Tools.web_search}\`:
Current Date & Time: {{iso_datetime}}

**Execute immediately without preface.** After search, provide a brief summary addressing the query directly, then structure your response with clear Markdown formatting (## headers, lists, tables). Cite sources properly, tailor tone to query type, and provide comprehensive details.

**CITATION FORMAT - UNICODE ESCAPE SEQUENCES ONLY:**
Use these EXACT escape sequences (copy verbatim): \\ue202 (before each anchor), \\ue200 (group start), \\ue201 (group end), \\ue203 (highlight start), \\ue204 (highlight end)

Anchor pattern: \\ue202turn{N}{type}{index} where N=turn number, type=search|news|image|ref, index=0,1,2...

**Examples (copy these exactly):**
- Single: "Statement.\\ue202turn0search0"
- Multiple: "Statement.\\ue202turn0search0\\ue202turn0news1"
- Group: "Statement. \\ue200\\ue202turn0search0\\ue202turn0news1\\ue201"
- Highlight: "\\ue203Cited text.\\ue204\\ue202turn0search0"
- Image: "See photo\\ue202turn0image0."

**CRITICAL:** Output escape sequences EXACTLY as shown. Do NOT substitute with † or other symbols. Place anchors AFTER punctuation. Cite every non-obvious fact/quote. NEVER use markdown links, [1], footnotes, or HTML tags.`;

/** Returns the raw template with {{iso_datetime}} placeholder (for seeding to DB) */
export function getWebSearchContextTemplate(): string {
  return WEB_SEARCH_CONTEXT_TEMPLATE.trim();
}

/** Builds the web search tool context, resolving dynamic variables at runtime */
export function buildWebSearchContext(): string {
  return replaceSpecialVars({ text: WEB_SEARCH_CONTEXT_TEMPLATE.trim() });
}