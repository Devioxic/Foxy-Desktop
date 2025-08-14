import { useState, useEffect } from "react";

interface AuthData {
  accessToken?: string;
  serverAddress?: string;
  userId?: string;
}

export const useAuthData = () => {
  const [authData, setAuthData] = useState<AuthData>(() => {
    try {
      return JSON.parse(localStorage.getItem("authData") || "{}");
    } catch {
      return {};
    }
  });

  const updateAuthData = (newAuthData: AuthData) => {
    setAuthData(newAuthData);
    localStorage.setItem("authData", JSON.stringify(newAuthData));
  };

  const clearAuthData = () => {
    setAuthData({});
    localStorage.removeItem("authData");
  };

  const isAuthenticated = () => {
    return !!(authData.accessToken && authData.serverAddress);
  };

  return {
    authData,
    updateAuthData,
    clearAuthData,
    isAuthenticated,
  };
};
