import { useMemo, useState, useEffect, useRef } from 'react';
import { Constants } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useResetRecoilState } from 'recoil';
import { useArtifactsContext } from '~/Providers';
import { logger } from '~/utils';
import store from '~/store';

export default function useArtifacts() {
  const [activeTab, setActiveTab] = useState('preview');
  const { isSubmitting, latestMessageId, latestMessageText, conversationId } =
    useArtifactsContext();

  const artifacts = useRecoilValue(store.artifactsState);
  const resetArtifacts = useResetRecoilState(store.artifactsState);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);
  const [currentArtifactId, setCurrentArtifactId] = useRecoilState(store.currentArtifactId);

  const orderedArtifactIds = useMemo(() => {
    return Object.keys(artifacts ?? {}).sort(
      (a, b) => (artifacts?.[a]?.lastUpdateTime ?? 0) - (artifacts?.[b]?.lastUpdateTime ?? 0),
    );
  }, [artifacts]);

  const prevIsSubmittingRef = useRef<boolean>(false);
  const lastContentRef = useRef<string | null>(null);
  const hasEnclosedArtifactRef = useRef<boolean>(false);
  const lastRunMessageIdRef = useRef<string | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const resetState = () => {
      resetArtifacts();
      resetCurrentArtifactId();
      prevConversationIdRef.current = conversationId;
      lastRunMessageIdRef.current = null;
      lastContentRef.current = null;
      hasEnclosedArtifactRef.current = false;
    };
    if (conversationId !== prevConversationIdRef.current && prevConversationIdRef.current != null) {
      resetState();
    } else if (conversationId === Constants.NEW_CONVO) {
      resetState();
    }
    prevConversationIdRef.current = conversationId;
    /** Resets artifacts when unmounting */
    return () => {
      logger.log('artifacts_visibility', 'Unmounting artifacts');
      resetState();
    };
  }, [conversationId, resetArtifacts, resetCurrentArtifactId]);

  useEffect(() => {
    if (orderedArtifactIds.length > 0) {
      const latestArtifactId = orderedArtifactIds[orderedArtifactIds.length - 1];
      setCurrentArtifactId(latestArtifactId);
    }
  }, [setCurrentArtifactId, orderedArtifactIds]);

  /**
   * Manage artifact selection during generation
   * Runs when artifact content changes
   */
  useEffect(() => {
    // Check if we just finished submitting (transition from true to false)
    const justFinishedSubmitting = prevIsSubmittingRef.current && !isSubmitting;
    prevIsSubmittingRef.current = isSubmitting;

    // Only process during submission OR when just finished
    if (!isSubmitting && !justFinishedSubmitting) {
      return;
    }
    if (orderedArtifactIds.length === 0) {
      return;
    }
    if (latestMessageId == null) {
      return;
    }
    const latestArtifactId = orderedArtifactIds[orderedArtifactIds.length - 1];
    const latestArtifact = artifacts?.[latestArtifactId];
    if (latestArtifact?.content === lastContentRef.current && !justFinishedSubmitting) {
      return;
    }

    setCurrentArtifactId(latestArtifactId);
    lastContentRef.current = latestArtifact?.content ?? null;
  }, [
    artifacts,
    isSubmitting,
    latestMessageId,
    latestMessageText,
    orderedArtifactIds,
    setCurrentArtifactId,
  ]);

  /**
   * Watch for enclosed artifact pattern during message generation
   * Optimized: Exits early if already detected, only checks during streaming
   */
  useEffect(() => {
    if (!isSubmitting || hasEnclosedArtifactRef.current) {
      return;
    }

    const hasEnclosedArtifact =
      /:::artifact(?:\{[^}]*\})?(?:\s|\n)*(?:```[\s\S]*?```(?:\s|\n)*)?:::/m.test(
        latestMessageText.trim(),
      );

    if (hasEnclosedArtifact) {
      logger.log('artifacts', 'Enclosed artifact detected during generation, switching to preview');
      setActiveTab('preview');
      hasEnclosedArtifactRef.current = true;
    }
  }, [isSubmitting, latestMessageText]);

  useEffect(() => {
    if (latestMessageId !== lastRunMessageIdRef.current) {
      lastRunMessageIdRef.current = latestMessageId;
      hasEnclosedArtifactRef.current = false;
    }
  }, [latestMessageId]);

  const currentArtifact = currentArtifactId != null ? artifacts?.[currentArtifactId] : null;

  const currentIndex = orderedArtifactIds.indexOf(currentArtifactId ?? '');

  return {
    activeTab,
    setActiveTab,
    currentIndex,
    currentArtifact,
    orderedArtifactIds,
    setCurrentArtifactId,
  };
}
