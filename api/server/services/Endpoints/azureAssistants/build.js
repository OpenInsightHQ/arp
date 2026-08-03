const { removeNullishValues } = require('librechat-data-provider');
const { buildVisualizationPrompt, generateArtifactsPrompt, getSystemPromptOrSeed } = require('@librechat/api');
const { getAssistant } = require('~/models/Assistant');

const buildOptions = async (endpoint, parsedBody) => {
  const {
    promptPrefix,
    assistant_id,
    iconURL,
    greeting,
    spec,
    artifacts,
    echartsPrompt,
    ...modelOptions
  } = parsedBody;
  const endpointOption = removeNullishValues({
    endpoint,
    promptPrefix,
    assistant_id,
    iconURL,
    greeting,
    spec,
    modelOptions,
  });

  if (assistant_id) {
    const assistantDoc = await getAssistant({ assistant_id });
    if (assistantDoc) {
      endpointOption.assistant = {
        append_current_datetime: assistantDoc.append_current_datetime,
        assistant_id: assistantDoc.assistant_id,
        conversation_starters: assistantDoc.conversation_starters,
        createdAt: assistantDoc.createdAt,
        updatedAt: assistantDoc.updatedAt,
      };
    }
  }

  if (typeof artifacts === 'string') {
    const [dbArtifactsPrompt, dbShadcnPrefix] = await Promise.all([
      getSystemPromptOrSeed('artifacts.openai'),
      getSystemPromptOrSeed('artifacts.shadcn_prefix'),
    ]);
    endpointOption.artifactsPrompt = generateArtifactsPrompt({
      endpoint,
      artifacts,
      dbPrompt: dbArtifactsPrompt,
      dbShadcnPrefix,
    });
  }

  const visualizationPrompt = buildVisualizationPrompt({
    echartsPrompt,
    dbPrompt: await getSystemPromptOrSeed('visualization.echarts'),
  });
  if (visualizationPrompt) {
    endpointOption.visualizationPrompt = visualizationPrompt;
  }

  return endpointOption;
};

module.exports = buildOptions;
