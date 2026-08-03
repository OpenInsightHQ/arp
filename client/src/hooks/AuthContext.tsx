import {
  useRef,
  useMemo,
  useState,
  useEffect,
  ReactNode,
  useContext,
  useCallback,
  createContext,
} from 'react';
import { debounce } from 'lodash';
import { useRecoilState } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { setTokenHeader, SystemRoles, dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import {
  useGetRole,
  useGetUserQuery,
  useLoginUserMutation,
  useLogoutUserMutation,
  useRefreshTokenMutation,
} from '~/data-provider';
import { TAuthConfig, TUserContext, TAuthContext, TResError } from '~/common';
import useTimeout from './useTimeout';
import store from '~/store';

const AuthContext = createContext<TAuthContext | undefined>(undefined);

const AuthContextProvider = ({
  authConfig,
  children,
}: {
  authConfig?: TAuthConfig;
  children: ReactNode;
}) => {
  const [user, setUser] = useRecoilState(store.user);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [ssoLoading, setSsoLoading] = useState<boolean>(false);
  const logoutRedirectRef = useRef<string | undefined>(undefined);

  // Fetch USER and ADMIN role definitions (the two system roles).
  // Additional roles from `user.roles` are checked server-side via checkAccess.
  const userRoleNames = useMemo(() => {
    const names = new Set<string>();
    if (user?.role) {
      names.add(user.role);
    }
    // Always ensure both system roles are fetched so useHasAccess works
    names.add(SystemRoles.USER);
    if (user?.roles) {
      user.roles.forEach((r) => r && names.add(r));
    }
    return [...names].filter(Boolean);
  }, [user?.role, user?.roles]);

  const { data: userRole = null } = useGetRole(SystemRoles.USER, {
    enabled: !!(isAuthenticated && (user?.role ?? '')),
  });
  const { data: adminRole = null } = useGetRole(SystemRoles.ADMIN, {
    enabled: !!(isAuthenticated && userRoleNames.includes(SystemRoles.ADMIN)),
  });

  const rolesMap = useMemo(() => {
    const map: Record<string, t.TRole | null | undefined> = {};
    map[SystemRoles.USER] = userRole;
    map[SystemRoles.ADMIN] = adminRole;
    return map;
  }, [userRole, adminRole]);

  const navigate = useNavigate();

  const ssoTokenParam = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const tokenName = 'ecdp-auth';
    const token = params.get(tokenName);
    if (token) {
      params.delete(tokenName);
      const remaining = params.toString();
      const newPath = remaining
        ? `${window.location.pathname}?${remaining}`
        : window.location.pathname;
      window.history.replaceState({}, '', newPath);
    }
    return token;
  }, []);

  const ssoLoginAttempted = useRef(false);

  useEffect(() => {
    if (ssoTokenParam) {
      setSsoLoading(true);
    }
  }, [ssoTokenParam]);

  const setUserContext = useMemo(
    () =>
      debounce((userContext: TUserContext) => {
        const { token, isAuthenticated, user, redirect, ssoLoading: newSsoLoading } = userContext;
        if (newSsoLoading !== undefined) {
          setSsoLoading(newSsoLoading);
        }
        setUser(user);
        setToken(token);
        //@ts-ignore - ok for token to be undefined initially
        setTokenHeader(token);
        setIsAuthenticated(isAuthenticated);

        // Use a custom redirect if set
        const finalRedirect = logoutRedirectRef.current || redirect;
        // Clear the stored redirect
        logoutRedirectRef.current = undefined;

        if (finalRedirect == null) {
          return;
        }

        if (finalRedirect.startsWith('http://') || finalRedirect.startsWith('https://')) {
          window.location.href = finalRedirect;
        } else {
          navigate(finalRedirect, { replace: true });
        }
      }, 50),
    [navigate, setUser],
  );
  const doSetError = useTimeout({ callback: (error) => setError(error as string | undefined) });

  const loginUser = useLoginUserMutation({
    onSuccess: (data: t.TLoginResponse) => {
      const { user, token, twoFAPending, tempToken } = data;
      if (twoFAPending) {
        // Redirect to the two-factor authentication route.
        navigate(`/login/2fa?tempToken=${tempToken}`, { replace: true });
        return;
      }
      setError(undefined);
      setUserContext({ token, isAuthenticated: true, user, redirect: '/c/new' });
    },
    onError: (error: TResError | unknown) => {
      const resError = error as TResError;
      doSetError(resError.message);
      navigate('/login', { replace: true });
    },
  });
  const logoutUser = useLogoutUserMutation({
    onSuccess: (data) => {
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: data.redirect ?? '/login',
      });
    },
    onError: (error) => {
      doSetError((error as Error).message);
      setUserContext({
        token: undefined,
        isAuthenticated: false,
        user: undefined,
        redirect: '/login',
      });
    },
  });
  const refreshToken = useRefreshTokenMutation();

  const logout = useCallback(
    (redirect?: string) => {
      if (redirect) {
        logoutRedirectRef.current = redirect;
      }
      logoutUser.mutate(undefined);
    },
    [logoutUser],
  );

  const userQuery = useGetUserQuery({ enabled: !!(token ?? '') });

  const login = (data: t.TLoginUser) => {
    loginUser.mutate(data);
  };

  const silentRefresh = useCallback(() => {
    if (authConfig?.test === true) {
      console.log('Test mode. Skipping silent refresh.');
      return;
    }

    if (ssoTokenParam) {
      if (ssoLoginAttempted.current) {
        return;
      }
      ssoLoginAttempted.current = true;
      dataService.ssoLogin(ssoTokenParam).then(
        (data: t.TLoginResponse) => {
          if (data.token && data.user) {
            setUserContext({
              token: data.token,
              isAuthenticated: true,
              user: data.user,
              ssoLoading: false,
            });
          } else {
            setSsoLoading(false);
            navigate('/login');
          }
        },
        () => {
          setSsoLoading(false);
          navigate('/login');
        },
      );
      return;
    }

    refreshToken.mutate(undefined, {
      onSuccess: (data: t.TRefreshTokenResponse | undefined) => {
        const { user, token = '' } = data ?? {};
        if (token) {
          setUserContext({ token, isAuthenticated: true, user });
        } else {
          console.log('Token is not present. User is not authenticated.');
          if (authConfig?.test === true) {
            return;
          }
          navigate('/login');
        }
      },
      onError: (error) => {
        console.log('refreshToken mutation error:', error);
        if (authConfig?.test === true) {
          return;
        }
        navigate('/login');
      },
    });
  }, [ssoTokenParam, navigate, setUserContext]);

  useEffect(() => {
    if (userQuery.data) {
      setUser(userQuery.data);
    } else if (userQuery.isError) {
      doSetError((userQuery.error as Error).message);
      navigate('/login', { replace: true });
    }
    if (error != null && error && isAuthenticated) {
      doSetError(undefined);
    }
    if (ssoLoading) {
      return;
    }
    if (token == null || !token || !isAuthenticated) {
      silentRefresh();
    }
  }, [
    token,
    isAuthenticated,
    ssoLoading,
    userQuery.data,
    userQuery.isError,
    userQuery.error,
    error,
    setUser,
    navigate,
    silentRefresh,
    setUserContext,
  ]);

  useEffect(() => {
    const handleTokenUpdate = (event) => {
      console.log('tokenUpdated event received event');
      const newToken = event.detail;
      setUserContext({
        token: newToken,
        isAuthenticated: true,
        user: user,
      });
    };

    window.addEventListener('tokenUpdated', handleTokenUpdate);

    return () => {
      window.removeEventListener('tokenUpdated', handleTokenUpdate);
    };
  }, [setUserContext, user]);

  // Make the provider update only when it should
  const memoedValue = useMemo(
    () => ({
      user,
      token,
      error,
      login,
      logout,
      setError,
      roles: rolesMap,
      isAuthenticated,
      ssoLoading,
    }),

    [user, error, isAuthenticated, ssoLoading, token, rolesMap],
  );

  return <AuthContext.Provider value={memoedValue}>{children}</AuthContext.Provider>;
};

const useAuthContext = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuthContext should be used inside AuthProvider');
  }

  return context;
};

export { AuthContextProvider, useAuthContext, AuthContext };
