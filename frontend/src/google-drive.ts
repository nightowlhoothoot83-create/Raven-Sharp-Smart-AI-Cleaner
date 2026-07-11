/**
 * Google Drive OAuth hook using expo-auth-session.
 * Returns a `connect()` function that opens Google's sign-in flow,
 * gets an access token, and POSTs it to /api/sources/gdrive.
 */
import { useEffect, useCallback, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { Platform } from "react-native";
import { api } from "./api";

WebBrowser.maybeCompleteAuthSession();

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

export type GoogleConnectStatus = "idle" | "authenticating" | "linking" | "success" | "error";

export function useGoogleDriveConnect(onSuccess?: () => void) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
    scopes: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/drive",
    ],
    extraParams: {
      prompt: "select_account consent",
    },
  });

  const [status, setStatus] = useState<GoogleConnectStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleTokens = useCallback(
    async (accessToken: string) => {
      setStatus("linking");
      try {
        const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const profile = profileRes.ok ? await profileRes.json() : {};
        const label = profile.email || profile.name || "My Drive";
        await api.connectGDrive(accessToken, label);
        setStatus("success");
        onSuccess?.();
      } catch (e: any) {
        setError(e.message || "Failed to link Google Drive");
        setStatus("error");
      }
    },
    [onSuccess],
  );

  useEffect(() => {
    if (!response) return;
    if (response.type === "success") {
      const token = response.authentication?.accessToken;
      if (token) {
        handleTokens(token);
      } else {
        setError("No access token returned from Google");
        setStatus("error");
      }
    } else if (response.type === "error") {
      setError(response.error?.message || "Google sign-in failed");
      setStatus("error");
    } else if (response.type === "cancel" || response.type === "dismiss") {
      setStatus("idle");
    }
  }, [response, handleTokens]);

  const connect = useCallback(async () => {
    if (!WEB_CLIENT_ID) {
      setError("Google OAuth not configured. Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
      setStatus("error");
      return;
    }
    if (!request) return;
    setError(null);
    setStatus("authenticating");
    try {
      await promptAsync();
    } catch (e: any) {
      setError(e.message || "Google sign-in failed");
      setStatus("error");
    }
  }, [request, promptAsync]);

  return {
    connect,
    status,
    error,
    ready: !!request,
    isWeb: Platform.OS === "web",
  };
}
