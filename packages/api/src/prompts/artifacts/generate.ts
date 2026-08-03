import dedent from 'dedent';
import type { ShadcnComponent } from './components';

export const SHADCN_PREFIX = dedent`## Additional Artifact Instructions for React Components: "application/vnd.react"

There are some prestyled components (primitives) available for use. Please use your best judgement to use any of these components if the app calls for one.

Here are the components that are available, along with how to import them, and how to use them:`;

/**
 * Generate system prompt for AI-assisted React component creation
 * @param options - Configuration options
 * @param options.components - Documentation for shadcn components
 * @param options.useXML - Whether to use XML-style formatting for component instructions
 * @param options.prefixOverride - Optional override for the prefix template from DB
 * @returns The generated system prompt
 */
export function generateShadcnPrompt(options: {
  components: Record<string, ShadcnComponent>;
  useXML?: boolean;
  prefixOverride?: string | null;
}): string {
  const { components, useXML = false, prefixOverride } = options;
  const prefix = prefixOverride ?? SHADCN_PREFIX;

  const componentDocs = Object.values(components)
    .map((component) => {
      if (useXML) {
        return dedent`
          <component>
            <name>${component.componentName}</name>
            <import-instructions>${component.importDocs}</import-instructions>
            <usage-instructions>${component.usageDocs}</usage-instructions>
          </component>
        `;
      }
      return dedent`
          # ${component.componentName}

          ## Import Instructions
          ${component.importDocs}

          ## Usage Instructions
          ${component.usageDocs}
        `;
    })
    .join('\n\n');

  return `${prefix}\n\n${componentDocs}`;
}