import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import { useSetRecoilState } from 'recoil';
import { SystemRoles } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import {
  useSearchEnabled,
  useAssistantsMap,
  useAuthContext,
  useAgentsMap,
  useFileMap,
} from '~/hooks';
import {
  PromptGroupsProvider,
  AssistantsMapContext,
  AgentsMapContext,
  SetConvoProvider,
  FileMapContext,
} from '~/Providers';
import { useUserTermsQuery, useGetStartupConfig } from '~/data-provider';
import { Nav, MobileNav, NAV_WIDTH } from '~/components/Nav';
import { TermsAndConditionsModal } from '~/components/ui';
import { useHealthCheck } from '~/data-provider';
import { Banner } from '~/components/Banners';
import store from '~/store';

// 检测 embed 模式（用于 iframe 嵌入）
const isEmbedMode = typeof window !== 'undefined' && window.location.search.includes('embed=true');

export default function Root() {
  const [showTerms, setShowTerms] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const { data: config } = useGetStartupConfig();

  const [navVisible, setNavVisible] = useState(() => {
    if (isEmbedMode) return false;
    if (config?.leftSidebarHidden) return false;
    const savedNavVisible = localStorage.getItem('navVisible');
    return savedNavVisible !== null ? JSON.parse(savedNavVisible) : true;
  });

  const { isAuthenticated, logout, user } = useAuthContext();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const setHideSidePanel = useSetRecoilState(store.hideSidePanel);

  useEffect(() => {
    if (user?.role === SystemRoles.USER) {
      setHideSidePanel(true);
      localStorage.setItem('hideSidePanel', 'true');
    }
  }, [user, setHideSidePanel]);

  useHealthCheck(isAuthenticated);

  const assistantsMap = useAssistantsMap({ isAuthenticated });
  const agentsMap = useAgentsMap({ isAuthenticated });
  const fileMap = useFileMap({ isAuthenticated });

  const { data: termsData } = useUserTermsQuery({
    enabled: isAuthenticated && config?.interface?.termsOfService?.modalAcceptance === true,
  });

  useSearchEnabled(isAuthenticated);

  useEffect(() => {
    if (config?.leftSidebarHidden && navVisible) {
      setNavVisible(false);
      localStorage.setItem('navVisible', 'false');
    }
  }, [config?.leftSidebarHidden]);

  useEffect(() => {
    if (termsData) {
      setShowTerms(!termsData.termsAccepted);
    }
  }, [termsData]);

  const handleAcceptTerms = () => {
    setShowTerms(false);
  };

  const handleDeclineTerms = () => {
    setShowTerms(false);
    logout('/login?redirect=false');
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SetConvoProvider>
      <FileMapContext.Provider value={fileMap}>
        <AssistantsMapContext.Provider value={assistantsMap}>
          <AgentsMapContext.Provider value={agentsMap}>
            <PromptGroupsProvider>
              <Banner onHeightChange={setBannerHeight} />
              <div className="flex" style={{ height: `calc(100dvh - ${bannerHeight}px)` }}>
                <div className="relative z-0 flex h-full w-full overflow-hidden">
                  {!isEmbedMode && <Nav navVisible={navVisible} setNavVisible={setNavVisible} />}
                  <div
                    className="relative flex h-full max-w-full flex-1 flex-col overflow-hidden"
                    style={
                      isSmallScreen
                        ? {
                            transform: navVisible
                              ? `translateX(${NAV_WIDTH.MOBILE}px)`
                              : 'translateX(0)',
                            transition: 'transform 0.2s ease-out',
                          }
                        : undefined
                    }
                  >
                    {!isEmbedMode && <MobileNav navVisible={navVisible} setNavVisible={setNavVisible} />}
                    <Outlet context={{ navVisible, setNavVisible } satisfies ContextType} />
                  </div>
                </div>
              </div>
            </PromptGroupsProvider>
          </AgentsMapContext.Provider>
          {config?.interface?.termsOfService?.modalAcceptance === true && (
            <TermsAndConditionsModal
              open={showTerms}
              onOpenChange={setShowTerms}
              onAccept={handleAcceptTerms}
              onDecline={handleDeclineTerms}
              title={config.interface.termsOfService.modalTitle}
              modalContent={config.interface.termsOfService.modalContent}
            />
          )}
        </AssistantsMapContext.Provider>
      </FileMapContext.Provider>
    </SetConvoProvider>
  );
}
