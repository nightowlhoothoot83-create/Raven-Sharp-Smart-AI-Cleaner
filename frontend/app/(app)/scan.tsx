import { useState, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ImageBackground, ScrollView, Alert, Linking, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";

import { api } from "@/src/api";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

const BATCH_SIZE = 50;
const HASH_BYTES = 65536; // hash first 64KB for speed; collisions handled by AI dedup pass

async function hashAssetUri(uri: string): Promise<string> {
  // Read up to HASH_BYTES bytes as base64 and hash. Fast, collision-acceptable for media dedup
  // since AI dedup pass handles edge cases via filename + size.
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      length: HASH_BYTES,
      position: 0,
    });
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
  } catch {
    // fallback to filename-based id
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uri);
  }
}

function mediaTypeToMime(mediaType: string, filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (mediaType === "photo") {
    if (ext === "png") return "image/png";
    if (ext === "heic" || ext === "heif") return "image/heic";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    return "image/jpeg";
  }
  if (mediaType === "video") {
    if (ext === "mov") return "video/quicktime";
    return "video/mp4";
  }
  return "application/octet-stream";
}

export default function Scan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; name?: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const cancelRef = useRef(false);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 8));

  const requestMediaPermission = async (): Promise<boolean> => {
    const cur = await MediaLibrary.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain) {
      const res = await MediaLibrary.requestPermissionsAsync();
      if (res.granted) return true;
      if (!res.canAskAgain) {
        Alert.alert(
          "Photo access blocked",
          "Enable photo & video access in Settings to scan your library.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ],
        );
      }
      return false;
    }
    Alert.alert(
      "Photo access blocked",
      "We need photo & video access to scan your library. Enable it in Settings.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ],
    );
    return false;
  };

  const scanAllMedia = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not available on web", "Full media library scan only works on iOS/Android. Try 'Pick documents' instead.");
      return;
    }
    const ok = await requestMediaPermission();
    if (!ok) return;

    setBusy(true);
    setLog([]);
    cancelRef.current = false;
    pushLog("Enumerating media library...");

    try {
      // First, count total
      const first = await MediaLibrary.getAssetsAsync({ first: 1, mediaType: ["photo", "video"] });
      const total = first.totalCount;
      pushLog(`Found ${total} photos & videos`);

      if (total === 0) {
        setBusy(false);
        Alert.alert("Empty library", "No photos or videos found on this device.");
        return;
      }

      setProgress({ current: 0, total });

      let after: string | undefined;
      let processed = 0;
      let totalAdded = 0;

      while (processed < total) {
        if (cancelRef.current) break;
        const page = await MediaLibrary.getAssetsAsync({
          first: BATCH_SIZE,
          after,
          mediaType: ["photo", "video"],
          sortBy: [MediaLibrary.SortBy.modificationTime],
        });

        const batch: any[] = [];
        for (const asset of page.assets) {
          if (cancelRef.current) break;
          setProgress({ current: processed, total, name: asset.filename });
          try {
            // get full info to access localUri
            const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: false });
            const uri = info.localUri || asset.uri;
            if (!uri) {
              processed++;
              continue;
            }
            const sha = await hashAssetUri(uri);
            // size may not be on asset; try FileSystem
            let size = 0;
            try {
              const stat = await FileSystem.getInfoAsync(uri, { size: true });
              if (stat.exists && "size" in stat) size = (stat as any).size || 0;
            } catch { /* ignore */ }

            batch.push({
              name: asset.filename,
              size,
              mime_type: mediaTypeToMime(asset.mediaType, asset.filename),
              sha256: sha,
              external_id: asset.id,
              created_at: new Date(asset.modificationTime || asset.creationTime || Date.now()).toISOString(),
            });
          } catch (e: any) {
            // ignore single-asset failure
          }
          processed++;
        }

        if (batch.length > 0) {
          try {
            const r = await api.registerFiles(batch);
            totalAdded += r.added;
            pushLog(`+${r.added} new (${processed}/${total})`);
          } catch (e: any) {
            pushLog(`✗ batch failed (${(e.message || "").slice(0, 30)})`);
          }
        }

        setProgress({ current: processed, total });
        if (!page.hasNextPage || !page.endCursor) break;
        after = page.endCursor;
      }

      pushLog(`Indexed ${totalAdded} new files. Running AI analysis...`);
      const analyzed = await api.analyze();
      setResult({ ...analyzed, indexed: totalAdded });
      pushLog(`Found ${analyzed.duplicate_groups_count} duplicate groups.`);
    } catch (e: any) {
      Alert.alert("Scan failed", e.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const scanFolderAndroid = async () => {
    if (Platform.OS !== "android") {
      Alert.alert(
        "Android only",
        "Folder-level scanning uses Android's Storage Access Framework. On iOS, use 'Add documents' to pick files individually (Apple's sandbox doesn't allow folder access).",
      );
      return;
    }
    try {
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const rootUri = perm.directoryUri;

      setBusy(true);
      setLog([]);
      cancelRef.current = false;
      pushLog("Walking folder tree...");

      // Recursive walk
      const allFiles: { uri: string; name: string }[] = [];
      const stack: string[] = [rootUri];
      while (stack.length) {
        if (cancelRef.current) break;
        const dir = stack.pop()!;
        try {
          const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(dir);
          for (const entry of entries) {
            // SAF returns content URIs for both files and dirs; we can't easily distinguish without statting.
            try {
              const info = await FileSystem.getInfoAsync(entry, { size: true });
              if (info.exists && (info as any).isDirectory) {
                stack.push(entry);
              } else if (info.exists) {
                const decoded = decodeURIComponent(entry);
                const name = decoded.split("/").pop()?.split("%2F").pop() || "file";
                allFiles.push({ uri: entry, name });
              }
            } catch { /* ignore broken entry */ }
          }
          setProgress({ current: 0, total: allFiles.length, name: `${allFiles.length} files found...` });
        } catch (e: any) {
          pushLog(`✗ Could not read ${dir.slice(-40)}`);
        }
      }

      const total = allFiles.length;
      pushLog(`Found ${total} files. Hashing...`);
      if (total === 0) {
        setBusy(false);
        Alert.alert("Empty folder", "No files found in the selected folder.");
        return;
      }

      let processed = 0;
      let totalAdded = 0;
      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (cancelRef.current) break;
        const slice = allFiles.slice(i, i + BATCH_SIZE);
        const batch: any[] = [];
        for (const f of slice) {
          if (cancelRef.current) break;
          setProgress({ current: processed, total, name: f.name });
          try {
            const sha = await hashAssetUri(f.uri);
            let size = 0;
            try {
              const stat = await FileSystem.getInfoAsync(f.uri, { size: true });
              if (stat.exists && "size" in stat) size = (stat as any).size || 0;
            } catch { /* ignore */ }
            const ext = (f.name.split(".").pop() || "").toLowerCase();
            const mime =
              ["jpg", "jpeg"].includes(ext) ? "image/jpeg"
              : ext === "png" ? "image/png"
              : ext === "pdf" ? "application/pdf"
              : ext === "mp4" ? "video/mp4"
              : ext === "mov" ? "video/quicktime"
              : ext === "txt" ? "text/plain"
              : "application/octet-stream";
            batch.push({
              name: f.name,
              size,
              mime_type: mime,
              sha256: sha,
              external_id: f.uri,
              created_at: new Date().toISOString(),
            });
          } catch { /* ignore single file */ }
          processed++;
        }
        if (batch.length > 0) {
          try {
            const r = await api.registerFiles(batch);
            totalAdded += r.added;
            pushLog(`+${r.added} new (${processed}/${total})`);
          } catch (e: any) {
            pushLog(`✗ batch failed`);
          }
        }
      }

      pushLog(`Indexed ${totalAdded} files. Running AI analysis...`);
      const analyzed = await api.analyze();
      setResult({ ...analyzed, indexed: totalAdded });
      pushLog(`Found ${analyzed.duplicate_groups_count} duplicate groups.`);
    } catch (e: any) {
      Alert.alert("Folder scan failed", e.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const pickDocuments = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: "*/*" });
      if (picked.canceled) return;
      const assets = picked.assets || [];
      if (assets.length === 0) return;
      setBusy(true);
      setProgress({ current: 0, total: assets.length });
      setLog([]);
      cancelRef.current = false;
      for (let i = 0; i < assets.length; i++) {
        if (cancelRef.current) break;
        const a = assets[i];
        setProgress({ current: i, total: assets.length, name: a.name });
        pushLog(`Uploading ${a.name}...`);
        try {
          await api.uploadFile(a.uri, a.name || `file_${i}`, a.mimeType || "application/octet-stream");
          pushLog(`✓ ${a.name}`);
        } catch (e: any) {
          pushLog(`✗ ${a.name} (${e.message?.slice(0, 30) || "error"})`);
        }
        setProgress({ current: i + 1, total: assets.length });
      }
      pushLog("Running AI analysis...");
      const analyzed = await api.analyze();
      setResult(analyzed);
      pushLog(`Found ${analyzed.duplicate_groups_count} duplicate groups.`);
    } catch (e: any) {
      Alert.alert("Scan failed", e.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const scanRemote = async () => {
    setBusy(true);
    setLog([]);
    pushLog("Connecting to remote sources...");
    try {
      const { sources } = await api.listSources();
      const remote = sources.filter((s: any) => s.type !== "internal");
      if (remote.length === 0) {
        Alert.alert("No remote sources", "Connect Google Drive or Dropbox first.");
        setBusy(false);
        return;
      }
      setProgress({ current: 0, total: remote.length });
      for (let i = 0; i < remote.length; i++) {
        const s = remote[i];
        setProgress({ current: i, total: remote.length, name: s.label });
        pushLog(`Scanning ${s.label}...`);
        try {
          const r = s.type === "gdrive" ? await api.scanGDrive(s.id) : await api.scanDropbox(s.id);
          pushLog(`✓ ${s.label}: +${r.added} new files`);
        } catch (e: any) {
          pushLog(`✗ ${s.label} (${(e.message || "").slice(0, 40)})`);
        }
        setProgress({ current: i + 1, total: remote.length });
      }
      pushLog("Running AI analysis...");
      const analyzed = await api.analyze();
      setResult(analyzed);
      pushLog(`Found ${analyzed.duplicate_groups_count} duplicate groups.`);
    } catch (e: any) {
      Alert.alert("Scan failed", e.message || "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  const pct = progress ? Math.round((progress.current / Math.max(progress.total, 1)) * 100) : 0;

  return (
    <ImageBackground source={{ uri: images.storage }} style={[styles.root, { paddingTop: insets.top }]} imageStyle={{ opacity: 0.12 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity testID="btn-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Smart scan</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 80, alignItems: "stretch" }}>
        {!busy && !result && (
          <>
            <Text style={styles.heroLabel}>CHOOSE WHAT TO SCAN</Text>
            <Text style={styles.hero}>Pick a source.{"\n"}We do the rest.</Text>

            <TouchableOpacity testID="btn-scan-all-media" style={[styles.bigBtn, styles.bigBtnPrimary, shadow.card]} onPress={scanAllMedia}>
              <View style={[styles.bigIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                <Ionicons name="images-outline" size={26} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bigTitle, { color: "#fff" }]}>Scan all photos & videos</Text>
                <Text style={[styles.bigBody, { color: "rgba(255,255,255,0.85)" }]}>Auto-index your entire device library</Text>
              </View>
              <Ionicons name="flash" size={20} color="#fff" />
            </TouchableOpacity>

            {Platform.OS === "android" && (
              <TouchableOpacity testID="btn-scan-folder" style={[styles.bigBtn, shadow.card]} onPress={scanFolderAndroid}>
              <View style={[styles.bigIcon, { backgroundColor: colors.aiSoft }]}>
                <Ionicons name="folder-open-outline" size={26} color={colors.ai} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bigTitle}>Scan a folder</Text>
                  <Text style={styles.bigBody}>Downloads, WhatsApp media, any folder</Text>
                </View>
                <View style={styles.androidBadge}>
                  <Text style={styles.androidBadgeText}>ANDROID</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity testID="btn-scan-internal" style={[styles.bigBtn, shadow.card]} onPress={pickDocuments}>
              <View style={[styles.bigIcon, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="document-attach-outline" size={26} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigTitle}>Add documents</Text>
                <Text style={styles.bigBody}>Pick PDFs, docs, or other files</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity testID="btn-scan-remote" style={[styles.bigBtn, shadow.card]} onPress={scanRemote}>
              <View style={[styles.bigIcon, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="cloud-outline" size={26} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigTitle}>Scan cloud sources</Text>
                <Text style={styles.bigBody}>Google Drive & Dropbox accounts</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <View style={styles.infoCard}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
              <Text style={styles.infoText}>
                Photos & videos are hashed locally — only fingerprints (not your media) leave your device.
              </Text>
            </View>
          </>
        )}

        {busy && (
          <View style={styles.progressBox}>
            <View style={styles.progressRing}>
              <Text style={styles.progressPct}>{pct}%</Text>
              <Text style={styles.progressLabel}>{progress ? `${progress.current}/${progress.total}` : "..."}</Text>
            </View>
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
            {progress?.name && (
              <Text style={[styles.logLine, { marginTop: 6 }]} numberOfLines={1}>
                {progress.name}
              </Text>
            )}
            <View style={{ marginTop: spacing.lg, width: "100%", gap: 6 }}>
              {log.map((l, i) => (
                <Text key={i} style={styles.logLine} numberOfLines={1}>{l}</Text>
              ))}
            </View>
            <TouchableOpacity testID="btn-cancel-scan" style={styles.cancelBtn} onPress={() => { cancelRef.current = true; }}>
              <Text style={styles.cancelText}>Stop scan</Text>
            </TouchableOpacity>
          </View>
        )}

        {!busy && result && (
          <View style={styles.resultBox}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.resultTitle}>Scan complete</Text>
            <Text style={styles.resultStat}>{result.total_files} files indexed</Text>
            <Text style={styles.resultStat}>{result.duplicate_groups_count} duplicate groups</Text>

            <View style={{ gap: spacing.md, marginTop: spacing.lg, width: "100%" }}>
              <TouchableOpacity testID="btn-view-duplicates" style={styles.primaryBtn} onPress={() => router.replace("/(app)/duplicates")}>
                <Text style={styles.primaryText}>Review duplicates</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity testID="btn-view-rename" style={styles.secondaryBtn} onPress={() => router.replace("/(app)/rename")}>
                <Text style={styles.secondaryText}>Review rename suggestions</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3, color: colors.textPrimary },

  heroLabel: { ...typography.label, marginTop: spacing.lg, alignSelf: "flex-start" },
  hero: { fontSize: 32, fontWeight: "900", letterSpacing: -0.8, lineHeight: 38, color: colors.textPrimary, marginVertical: spacing.md, alignSelf: "flex-start" },

  bigBtn: { width: "100%", flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  bigBtnPrimary: { backgroundColor: colors.primary, borderColor: "transparent" },
  bigIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  bigTitle: { ...typography.h3, fontSize: 17 },
  bigBody: { ...typography.bodySm, color: colors.textSecondary },

  infoCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceElevated, padding: spacing.md, borderRadius: 16, marginTop: spacing.md, alignItems: "flex-start", borderWidth: 1, borderColor: colors.border },
  infoText: { ...typography.bodySm, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  androidBadge: { backgroundColor: colors.surfaceElevated, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  androidBadgeText: { color: colors.cyan, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  progressBox: { width: "100%", alignItems: "center", marginTop: spacing.xxl },
  progressRing: { width: 200, height: 200, borderRadius: 100, borderWidth: 8, borderColor: colors.primary, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  progressPct: { fontSize: 56, fontWeight: "900", color: colors.primary, letterSpacing: -2 },
  progressLabel: { ...typography.bodySm, color: colors.textSecondary, marginTop: 4 },
  logLine: { ...typography.mono, color: colors.textMuted, textAlign: "left" },
  cancelBtn: { marginTop: spacing.lg, paddingVertical: 12, paddingHorizontal: 24, borderRadius: radius.button, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.textPrimary, fontWeight: "700" },

  resultBox: { width: "100%", alignItems: "center", padding: spacing.xl, marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  resultTitle: { ...typography.h2, marginTop: spacing.md },
  resultStat: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 16, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { backgroundColor: colors.surfaceElevated, borderRadius: radius.button, paddingVertical: 16, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.textPrimary, fontWeight: "700", fontSize: 15 },
});
