import { createContext, useContext, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';

interface AgentConfigContextType {
  toolCallVisible: boolean;
}

const defaultConfig: AgentConfigContextType = {
  toolCallVisible: false,
};

const AgentConfigContext = createContext<AgentConfigContextType>(defaultConfig);

export function useAgentConfig() {
  return useContext(AgentConfigContext);
}

interface AgentConfigProviderProps {
  agentId?: string | null;
  fallbackToolCallVisible?: boolean;
  children: React.ReactNode;
}

export function AgentConfigProvider({
  agentId,
  fallbackToolCallVisible = false,
  children,
}: AgentConfigProviderProps) {
  const queryClient = useQueryClient();

  const agentConfig = useMemo<AgentConfigContextType>(() => {
    if (!agentId) {
      return { toolCallVisible: fallbackToolCallVisible };
    }
    const agent = queryClient.getQueryData<Agent>([QueryKeys.agent, agentId]);
    if (agent?.model_parameters?.toolCallVisible === false) {
      return { toolCallVisible: false };
    }
    // Default: tool calls collapsed
    return { toolCallVisible: agent?.model_parameters?.toolCallVisible === true };
  }, [agentId, queryClient, fallbackToolCallVisible]);

  return (
    <AgentConfigContext.Provider value={agentConfig}>
      {children}
    </AgentConfigContext.Provider>
  );
}

export default AgentConfigContext;
