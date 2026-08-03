import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '~/hooks';

export default function useAuthRedirect() {
  const { user, roles, isAuthenticated, ssoLoading } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (ssoLoading) {
      return;
    }
    const timeout = setTimeout(() => {
      if (!isAuthenticated) {
        navigate('/login', { replace: true });
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [isAuthenticated, navigate, ssoLoading]);

  return {
    user,
    roles,
    isAuthenticated,
  };
}
