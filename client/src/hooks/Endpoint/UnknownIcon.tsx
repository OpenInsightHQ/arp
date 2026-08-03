import { memo } from 'react';
import { EModelEndpoint, KnownEndpoints } from 'librechat-data-provider';
import { CustomMinimalIcon, XAIcon, MoonshotIcon } from '@librechat/client';
import { IconContext } from '~/common';
import { cn } from '~/utils';

const knownEndpointAssets = {
  [KnownEndpoints.anyscale]: 'assets/anyscale.png',
  [KnownEndpoints.apipie]: 'assets/apipie.png',
  [KnownEndpoints.cohere]: 'assets/cohere.png',
  [KnownEndpoints.deepseek]: 'assets/deepseek.svg',
  [KnownEndpoints.fireworks]: 'assets/fireworks.png',
  [KnownEndpoints.google]: 'assets/google.svg',
  [KnownEndpoints.groq]: 'assets/groq.png',
  [KnownEndpoints.helicone]: 'assets/helicone.png',
  [KnownEndpoints.huggingface]: 'assets/huggingface.svg',
  [KnownEndpoints.mistral]: 'assets/mistral.png',
  [KnownEndpoints.mlx]: 'assets/mlx.png',
  [KnownEndpoints.ollama]: 'assets/ollama.png',
  [KnownEndpoints.openai]: 'assets/openai.svg',
  [KnownEndpoints.openrouter]: 'assets/openrouter.png',
  [KnownEndpoints.perplexity]: 'assets/perplexity.png',
  [KnownEndpoints.qwen]: 'assets/qwen.svg',
  [KnownEndpoints.shuttleai]: 'assets/shuttleai.png',
  [KnownEndpoints['together.ai']]: 'assets/together.png',
  [KnownEndpoints.unify]: 'assets/unify.webp',
};

const knownEndpointClasses = {
  [KnownEndpoints.cohere]: {
    [IconContext.landing]: 'p-2',
  },
};

const getKnownClass = ({
  currentEndpoint,
  context = '',
  className,
}: {
  currentEndpoint: string;
  context?: string;
  className: string;
}) => {
  if (currentEndpoint === KnownEndpoints.openrouter) {
    return className;
  }

  const match = knownEndpointClasses[currentEndpoint]?.[context] ?? '';
  const defaultClass = context === IconContext.landing ? '' : className;

  return cn(match, defaultClass);
};

function UnknownIcon({
  className = '',
  endpoint: _endpoint,
  iconURL = '',
  context,
}: {
  iconURL?: string;
  className?: string;
  endpoint?: EModelEndpoint | string | null;
  context?: 'landing' | 'menu-item' | 'nav' | 'message';
}) {
  const endpoint = _endpoint ?? '';
  if (!endpoint) {
    return <CustomMinimalIcon className={className} />;
  }

  const currentEndpoint = endpoint.toLowerCase();

  if (currentEndpoint === 'pi') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (currentEndpoint === KnownEndpoints.xai) {
    return <XAIcon className={cn(className, 'text-black dark:text-white')} />;
  }

  if (currentEndpoint === KnownEndpoints.moonshot) {
    return <MoonshotIcon className={cn(className, 'text-black dark:text-white')} />;
  }

  if (iconURL) {
    return <img className={className} src={iconURL} alt={`${endpoint} Icon`} />;
  }

  const assetPath: string = knownEndpointAssets[currentEndpoint] ?? '';

  if (!assetPath) {
    return <CustomMinimalIcon className={className} />;
  }

  return (
    <img
      className={getKnownClass({
        currentEndpoint,
        context: context,
        className,
      })}
      src={assetPath}
      alt={`${currentEndpoint} Icon`}
    />
  );
}

export default memo(UnknownIcon);
