// OAuth configuration and helpers
// This file is prepared for cloud source OAuth integrations
// To be used when adding Google Drive, Dropbox, OneDrive, Google Photos

export const OAUTH_CONFIG = {
  gdrive: {
    clientId: process.env.EXPO_PUBLIC_GDRIVE_CLIENT_ID || "",
    redirectUri: process.env.EXPO_PUBLIC_GDRIVE_REDIRECT_URI || "http://localhost:3000/oauth/gdrive",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  },
  dropbox: {
    clientId: process.env.EXPO_PUBLIC_DROPBOX_CLIENT_ID || "",
    redirectUri: process.env.EXPO_PUBLIC_DROPBOX_REDIRECT_URI || "http://localhost:3000/oauth/dropbox",
    authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["files.content.read"],
  },
  onedrive: {
    clientId: process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID || "",
    redirectUri: process.env.EXPO_PUBLIC_ONEDRIVE_REDIRECT_URI || "http://localhost:3000/oauth/onedrive",
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["Files.Read.All"],
  },
  gphotos: {
    clientId: process.env.EXPO_PUBLIC_GPHOTOS_CLIENT_ID || "",
    redirectUri: process.env.EXPO_PUBLIC_GPHOTOS_REDIRECT_URI || "http://localhost:3000/oauth/gphotos",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/photoslibrary.readonly"],
  },
};

export async function initiateOAuth(provider: "gdrive" | "dropbox" | "onedrive" | "gphotos") {
  // Placeholder: will be implemented when adding cloud source OAuth
  // This will redirect to provider login and return access token
  console.log(`OAuth flow for ${provider} not yet implemented`);
}
