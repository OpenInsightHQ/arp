import { useRef, useEffect, useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useRecoilValue } from 'recoil';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react/unstyled';
import type { CodeEditorRef } from '@codesandbox/sandpack-react';
import type { Artifact } from '~/common';
import { useCodeState } from '~/Providers/EditorContext';
import { useArtifactsContext } from '~/Providers';
import useArtifactProps from '~/hooks/Artifacts/useArtifactProps';
import { useAutoScroll } from '~/hooks/Artifacts/useAutoScroll';
import { ArtifactCodeEditor } from './ArtifactCodeEditor';
import { useGetStartupConfig } from '~/data-provider';
import { ArtifactPreview } from './ArtifactPreview';
import { StackedSvgPreview, getGroupedSvgArtifacts, SVG_ARTIFACT_TYPE } from './StackedSvgPreview';
import store from '~/store';

export default function ArtifactTabs({
  artifact,
  editorRef,
  previewRef,
  isSharedConvo,
  refreshNonce,
}: {
  artifact: Artifact;
  editorRef: React.MutableRefObject<CodeEditorRef>;
  previewRef: React.MutableRefObject<SandpackPreviewRef>;
  isSharedConvo?: boolean;
  refreshNonce?: number;
}) {
  const { isSubmitting } = useArtifactsContext();
  const { currentCode, setCurrentCode } = useCodeState();
  const { data: startupConfig } = useGetStartupConfig();
  const previewCodeHidden = startupConfig?.previewCodeHidden === true;
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (artifact.id !== lastIdRef.current) {
      setCurrentCode(undefined);
    }
    lastIdRef.current = artifact.id;
  }, [setCurrentCode, artifact.id]);

  const content = artifact.content ?? '';
  const contentRef = useRef<HTMLDivElement>(null);
  useAutoScroll({ ref: contentRef, content, isSubmitting });

  const { files, fileKey, template, sharedProps } = useArtifactProps({ artifact });

  const artifacts = useRecoilValue(store.artifactsState);
  const artifactGroup = artifact.group?.trim() ?? '';
  const useStackedPreview = useMemo(() => {
    if (artifact.type !== SVG_ARTIFACT_TYPE || !artifactGroup) {
      return false;
    }
    return getGroupedSvgArtifacts(artifacts, artifactGroup).length >= 1;
  }, [artifacts, artifact.type, artifactGroup]);

  return (
    <div className="flex h-full w-full flex-col">
      {!previewCodeHidden && (
        <Tabs.Content
          ref={contentRef}
          value="code"
          id="artifacts-code"
          className="h-full w-full flex-grow overflow-auto"
          tabIndex={-1}
        >
          <ArtifactCodeEditor
            files={files}
            fileKey={fileKey}
            template={template}
            artifact={artifact}
            editorRef={editorRef}
            sharedProps={sharedProps}
            readOnly={isSharedConvo}
          />
        </Tabs.Content>
      )}

      <Tabs.Content value="preview" className="h-full w-full flex-grow overflow-auto" tabIndex={-1}>
        {useStackedPreview ? (
          <StackedSvgPreview group={artifactGroup} refreshNonce={refreshNonce} />
        ) : (
          <ArtifactPreview
            files={files}
            fileKey={fileKey}
            template={template}
            previewRef={previewRef}
            sharedProps={sharedProps}
            currentCode={currentCode}
            startupConfig={startupConfig}
            artifactType={artifact.type}
            refreshNonce={refreshNonce}
            isSubmitting={isSubmitting}
          />
        )}
      </Tabs.Content>
    </div>
  );
}
