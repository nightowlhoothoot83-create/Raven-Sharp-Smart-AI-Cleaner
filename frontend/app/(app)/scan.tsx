import { useState, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ImageBackground, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";

import { api } from "@/src/api";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

export default function Scan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; name?: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const cancelRef = useRef(false);

  const pushLog = (line: string) => setLog((l) => [line, ...l].slice(0, 8));

  const scanInternal = async () => {
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
        pushLog(`Hashing ${a.name}...`);
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

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 80, alignItems: "center" }}>
        {!busy && !result && (
          <>
            <Text style={styles.heroLabel}>CHOOSE WHAT TO SCAN</Text>
            <Text style={styles.hero}>Pick a source.{"\n"}We do the rest.</Text>

            <TouchableOpacity testID="btn-scan-internal" style={[styles.bigBtn, shadow.card]} onPress={scanInternal}>
              <View style={[styles.bigIcon, { backgroundColor: "#EEF2FF" }]}>
                <Ionicons name="phone-portrait-outline" size={26} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigTitle}>Scan internal storage</Text>
                <Text style={styles.bigBody}>Pick files & folders from this device</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity testID="btn-scan-remote" style={[styles.bigBtn, shadow.card]} onPress={scanRemote}>
              <View style={[styles.bigIcon, { backgroundColor: "#E8F0FE" }]}>
                <Ionicons name="cloud-outline" size={26} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bigTitle}>Scan cloud sources</Text>
                <Text style={styles.bigBody}>Google Drive & Dropbox accounts</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </>
        )}

        {busy && (
          <View style={styles.progressBox}>
            <View style={styles.progressRing}>
              <Text style={styles.progressPct}>{pct}%</Text>
              <Text style={styles.progressLabel}>{progress ? `${progress.current}/${progress.total}` : "..."}</Text>
            </View>
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
            <View style={{ marginTop: spacing.lg, width: "100%", gap: 6 }}>
              {log.map((l, i) => (
                <Text key={i} style={styles.logLine} numberOfLines={1}>{l}</Text>
              ))}
            </View>
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

  bigBtn: { width: "100%", flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)", marginBottom: spacing.md },
  bigIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  bigTitle: { ...typography.h3, fontSize: 17 },
  bigBody: { ...typography.bodySm, color: colors.textSecondary },

  progressBox: { width: "100%", alignItems: "center", marginTop: spacing.xxl },
  progressRing: { width: 200, height: 200, borderRadius: 100, borderWidth: 8, borderColor: colors.primary, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  progressPct: { fontSize: 56, fontWeight: "900", color: colors.primary, letterSpacing: -2 },
  progressLabel: { ...typography.bodySm, color: colors.textSecondary, marginTop: 4 },
  logLine: { ...typography.mono, color: "#999", textAlign: "left" },

  resultBox: { width: "100%", alignItems: "center", padding: spacing.xl, marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.card },
  resultTitle: { ...typography.h2, marginTop: spacing.md },
  resultStat: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 16, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { backgroundColor: colors.surfaceHover, borderRadius: radius.button, paddingVertical: 16, alignItems: "center" },
  secondaryText: { color: colors.textPrimary, fontWeight: "700", fontSize: 15 },
});
