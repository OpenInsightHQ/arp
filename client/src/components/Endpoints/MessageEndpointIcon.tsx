import { memo } from 'react';
import { Feather } from 'lucide-react';
import { EModelEndpoint, isAssistantsEndpoint, alternateName } from 'librechat-data-provider';
import {
  Plugin,
  GPTIcon,
  PaLMIcon,
  CodeyIcon,
  GeminiIcon,
  BedrockIcon,
  AssistantIcon,
  AnthropicIcon,
  AzureMinimalIcon,
  CustomMinimalIcon,
} from '@librechat/client';
import UnknownIcon from '~/hooks/Endpoint/UnknownIcon';
import { IconProps } from '~/common';
import { cn } from '~/utils';

type EndpointIcon = {
  icon: React.ReactNode | React.JSX.Element;
  bg?: string;
  name?: string | null;
};

function getOpenAIColor(_model: string | null | undefined) {
  const model = _model?.toLowerCase() ?? '';
  if (model && (/\b(o\d)\b/i.test(model) || /\bgpt-[5-9](?:\.\d+)?\b/i.test(model))) {
    return '#000000';
  }
  return model.includes('gpt-4') ? '#AB68FF' : '#19C37D';
}

function getGoogleIcon(model: string | null | undefined, size: number) {
  if (model?.toLowerCase().includes('code') === true) {
    return <CodeyIcon size={size * 0.75} />;
  } else if (/gemini|learnlm|gemma/.test(model?.toLowerCase() ?? '')) {
    return <GeminiIcon size={size * 0.7} />;
  } else {
    return <PaLMIcon size={size * 0.7} />;
  }
}

function getGoogleModelName(model: string | null | undefined) {
  if (model?.toLowerCase().includes('code') === true) {
    return 'Codey';
  } else if (
    model?.toLowerCase().includes('gemini') === true ||
    model?.toLowerCase().includes('learnlm') === true
  ) {
    return 'Gemini';
  } else if (model?.toLowerCase().includes('gemma') === true) {
    return 'Gemma';
  } else {
    return 'PaLM2';
  }
}

const MessageEndpointIcon: React.FC<IconProps> = (props) => {
  const { error, iconURL = '', endpoint, size = 30, model = '', assistantName, agentName } = props;

  const assistantsIcon = {
    icon: iconURL ? (
      <div className="relative flex h-6 w-6 items-center justify-center">
        <div
          title={assistantName}
          style={{
            width: size,
            height: size,
          }}
          className={cn('overflow-hidden rounded-full', props.className ?? '')}
        >
          <img
            className="shadow-stroke h-full w-full object-cover"
            src={iconURL}
            alt={assistantName}
            style={{ height: '80', width: '80' }}
          />
        </div>
      </div>
    ) : (
      <div className="h-6 w-6">
        <div className="shadow-stroke flex h-6 w-6 items-center justify-center overflow-hidden rounded-full">
          <AssistantIcon className="h-2/3 w-2/3 text-gray-400" />
        </div>
      </div>
    ),
    name: endpoint,
  };

  const agentsIcon = {
    icon: iconURL ? (
      <div className="relative flex h-6 w-6 items-center justify-center">
        <div
          title={agentName}
          style={{
            width: size,
            height: size,
          }}
          className={cn('overflow-hidden rounded-full', props.className ?? '')}
        >
          <img
            className="shadow-stroke h-full w-full object-cover"
            src={iconURL}
            alt={agentName}
            style={{ height: '80', width: '80' }}
          />
        </div>
      </div>
    ) : (
      <div className="h-6 w-6">
        <div className="shadow-stroke flex h-6 w-6 items-center justify-center overflow-hidden rounded-full">
          <img src="assets/agent-default.png?v=20260710-square" className="h-2/3 w-2/3 rounded-full object-cover" alt="Agent" />
        </div>
      </div>
    ),
    name: endpoint,
  };

  const endpointIcons: {
    [key: string]: EndpointIcon | undefined;
  } = {
    [EModelEndpoint.assistants]: assistantsIcon,
    [EModelEndpoint.agents]: agentsIcon,
    [EModelEndpoint.azureAssistants]: assistantsIcon,
    [EModelEndpoint.azureOpenAI]: {
      icon: <AzureMinimalIcon size={size * 0.5555555555555556} />,
      bg: 'linear-gradient(0.375turn, #61bde2, #4389d0)',
      name: 'ChatGPT',
    },
    [EModelEndpoint.openAI]: {
      icon: <GPTIcon size={size * 0.5555555555555556} />,
      bg: getOpenAIColor(model),
      name: 'ChatGPT',
    },
    [EModelEndpoint.google]: {
      icon: getGoogleIcon(model, size),
      name: getGoogleModelName(model),
    },
    [EModelEndpoint.anthropic]: {
      icon: <AnthropicIcon size={size * 0.5555555555555556} />,
      bg: '#d09a74',
      name: 'Claude',
    },
    [EModelEndpoint.bedrock]: {
      icon: <BedrockIcon className="icon-xl text-white" />,
      bg: '#268672',
      name: alternateName[EModelEndpoint.bedrock],
    },
    [EModelEndpoint.custom]: {
      icon: <CustomMinimalIcon size={size * 0.7} />,
      name: 'Custom',
    },
    ['pi' as string]: {
      icon: (
        <div className="h-6 w-6">
          <div className="overflow-hidden rounded-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-full w-full object-contain text-text-primary"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      ),
      name: 'One Pi',
    },
    null: { icon: <GPTIcon size={size * 0.7} />, bg: 'grey', name: 'N/A' },
    default: {
      icon: (
        <div className="h-6 w-6">
          <div className="overflow-hidden rounded-full">
            <UnknownIcon
              iconURL={iconURL}
              endpoint={endpoint ?? ''}
              className="h-full w-full object-contain"
              context="message"
            />
          </div>
        </div>
      ),
      name: endpoint,
    },
  };

  let { icon, bg, name } =
    endpoint != null && endpoint && endpointIcons[endpoint]
      ? (endpointIcons[endpoint] ?? {})
      : (endpointIcons.default as EndpointIcon);

  if (iconURL && endpointIcons[iconURL]) {
    ({ icon, bg, name } = endpointIcons[iconURL]);
  }

  if (isAssistantsEndpoint(endpoint)) {
    return icon;
  }

  return (
    <div
      title={name ?? ''}
      style={{
        background: bg != null ? bg || 'transparent' : 'transparent',
        width: size,
        height: size,
      }}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-sm p-1 text-white',
        props.className ?? '',
      )}
    >
      {icon}
      {error === true && (
        <span className="absolute right-0 top-[20px] -mr-2 flex h-3 w-3 items-center justify-center rounded-full border border-white bg-red-500 text-[10px] text-white">
          !
        </span>
      )}
    </div>
  );
};

export default memo(MessageEndpointIcon);
