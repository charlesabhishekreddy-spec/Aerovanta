import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { appClient } from "@/api/appClient";

const AuthContext = createContext();
const appPublicSettings = { id: "aerovanta-local", public_settings: { auth_required: true } };

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Compatibility with existing app gate checks.
  const [isLoadingPublicSettings] = useState(false);

  const checkAppState = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const currentUser = await appClient.auth.me();
      setUser(currentUser);
      setAuthError(null);
      return currentUser;
    } catch (error) {
      setUser(null);
      setAuthError({ type: "auth_required", message: error?.message || "Authentication required." });
      return null;
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const signInWithEmail = useCallback(async (payload) => {
    const currentUser = await appClient.auth.signInWithEmail(payload);
    setUser(currentUser);
    setAuthError(null);
    return currentUser;
  }, []);

  const signInWithSocial = useCallback(async (payload) => {
    const currentUser = await appClient.auth.signInWithSocial(payload);
    setUser(currentUser);
    setAuthError(null);
    return currentUser;
  }, []);

  const registerWithEmail = useCallback(async (payload) => {
    const currentUser = await appClient.auth.registerWithEmail(payload);
    setUser(currentUser);
    setAuthError(null);
    return currentUser;
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const currentUser = await appClient.auth.updateMe(payload);
    setUser(currentUser);
    setAuthError(null);
    return currentUser;
  }, []);

  const requestPasswordReset = useCallback(async (payload) => appClient.auth.requestPasswordReset(payload), []);
  const validateResetToken = useCallback(async (token) => appClient.auth.validateResetToken(token), []);
  const resetPassword = useCallback(async (payload) => appClient.auth.resetPassword(payload), []);
  const changePassword = useCallback(async (payload) => appClient.auth.changePassword(payload), []);

  const logout = useCallback(
    async (shouldRedirect = true) => {
      setUser(null);
      setAuthError({ type: "auth_required", message: "Authentication required." });
      if (shouldRedirect) await appClient.auth.logout("/login");
      else await appClient.auth.logout();
    },
    []
  );

  const navigateToLogin = useCallback(() => {
    appClient.auth.redirectToLogin(window.location.href);
  }, []);

  const refreshToken = useCallback(async () => checkAppState(), [checkAppState]);
  const isAuthenticated = Boolean(user);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated,

      isLoadingAuth,
      isLoadingPublicSettings,
      restoring: isLoadingAuth,

      authError,
      appPublicSettings,

      signInWithEmail,
      signInWithSocial,
      registerWithEmail,
      updateProfile,
      requestPasswordReset,
      validateResetToken,
      resetPassword,
      changePassword,
      logout,
      navigateToLogin,

      checkAppState,
      refreshToken,
    }),
    [
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      signInWithEmail,
      signInWithSocial,
      registerWithEmail,
      updateProfile,
      requestPasswordReset,
      validateResetToken,
      resetPassword,
      changePassword,
      logout,
      navigateToLogin,
      checkAppState,
      refreshToken,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
