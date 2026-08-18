import type { AgentSkill } from 'librechat-data-provider';

/**
 * Builds the `<available_skills>` XML appended to the agent system prompt so
 * the LLM knows which skills it may trigger via the `execute_skill` tool.
 */
export function buildAvailableSkillsPrompt(skills: AgentSkill[] | undefined): string | null {
  if (!skills || skills.length === 0) {
    return null;
  }

  const entries = skills
    .filter((skill) => skill && skill.name)
    .map(
      (skill) =>
        `  <skill>\n    <name>${skill.name}</name>\n    <description>${skill.description ?? ''}</description>\n  </skill>`,
    )
    .join('\n');

  if (!entries) {
    return null;
  }

  return `<available_skills>\n${entries}\n</available_skills>`;
}
