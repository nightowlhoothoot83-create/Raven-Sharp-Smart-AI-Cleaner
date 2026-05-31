import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, ImageBackground } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

function formatBytes(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function Dashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, sr] = await Promise.all([api.stats(), api.listSources()]);
      setStats(s);
      setSources(sr.sources || []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const greeting = user?.full_name ? user.full_name.split(" ")[0] : (user?.email || "").split("@")[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greetingLabel}>HELLO, {String(greeting).toUpperCase()}</Text>
            <Text style={styles.h1} testID="dashboard-title">Reclaim your{"\n"}storage.</Text>
          </View>
          <TouchableOpacity testID="btn-signout" onPress={signOut} style={styles.signOutBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* HERO STATS */}
        <View style={[styles.heroCard, shadow.card]} testID="hero-card">
          <Text style={styles.heroLabel}>SPACE RECOVERABLE</Text>
          <Text style={styles.heroValue}>{formatBytes(stats?.space_recoverable || 0)}</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroChip}>
              <Ionicons name="copy-outline" size={14} color={colors.primary} />
              <Text style={styles.heroChipText}>{stats?.duplicate_groups_count || 0} duplicates</Text>
            </View>
            <View style={styles.heroChip}>
              <Ionicons name="sparkles-outline" size={14} color={colors.ai} />
              <Text style={[styles.heroChipText, { color: colors.ai }]}>{stats?.generic_named_files || 0} need renaming</Text>
            </View>
          </View>
        </View>

        {/* BENTO STATS */}
        <View style={styles.bentoRow}>
          <View style={[styles.bentoCard, shadow.card]}>
            <Ionicons name="folder-outline" size={20} color={colors.primary} />
            <Text style={styles.bentoValue}>{stats?.total_files || 0}</Text>
            <Text style={styles.bentoLabel}>Total Files</Text>
          </View>
          <View style={[styles.bentoCard, shadow.card]}>
            <Ionicons name="cloud-outline" size={20} color={colors.primary} />
            <Text style={styles.bentoValue}>{stats?.sources_count || 0}</Text>
            <Text style={styles.bentoLabel}>Sources</Text>
          </View>
        </View>

        {/* SOURCES */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Storage Sources</Text>
          <TouchableOpacity testID="btn-add-source" onPress={() => router.push("/(app)/sources")}>
            <Text style={styles.linkText}>Manage</Text>
          </TouchableOpacity>
        </View>

        {sources.length === 0 ? (
          <ImageBackground source={{ uri: images.storage }} imageStyle={{ borderRadius: radius.card, opacity: 0.85 }} style={[styles.emptySources, shadow.card]}>
            <View style={styles.emptyOverlay}>
              <Text style={styles.emptyTitle}>Connect your first source</Text>
              <Text style={styles.emptyBody}>Internal storage, Google Drive, or Dropbox — scan them all from one place.</Text>
              <TouchableOpacity testID="btn-connect-first" style={styles.emptyBtn} onPress={() => router.push("/(app)/sources")}>
                <Text style={styles.emptyBtnText}>Connect a source</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </ImageBackground>
        ) : (
          <View style={{ gap: spacing.md }}>
            {sources.map((s) => (
              <View key={s.id} style={[styles.sourceCard, shadow.card]}>
                <View style={[styles.sourceIcon, { backgroundColor: s.type === "gdrive" ? "#E8F0FE" : s.type === "dropbox" ? "#E3F2FD" : "#F4F4F5" }]}>
                  <Ionicons
                    name={s.type === "gdrive" ? "logo-google" : s.type === "dropbox" ? "logo-dropbox" : "phone-portrait-outline"}
                    size={22}
                    color={colors.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sourceLabel}>{s.label}</Text>
                  <Text style={styles.sourceType}>{s.type === "gdrive" ? "Google Drive" : s.type === "dropbox" ? "Dropbox" : s.type}</Text>
                </View>
                <View style={styles.sourceBadge}>
                  <View style={styles.dot} />
                  <Text style={styles.sourceBadgeText}>Linked</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* QUICK ACTIONS */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quick actions</Text>
        </View>
        <View style={{ gap: spacing.md }}>
          <TouchableOpacity testID="btn-go-duplicates" style={[styles.actionRow, shadow.card]} onPress={() => router.push("/(app)/duplicates")}>
            <View style={[styles.sourceIcon, { backgroundColor: "#EEF2FF" }]}>
              <Ionicons name="copy-outline" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Review duplicates</Text>
              <Text style={styles.actionBody}>AI chose what to keep. You approve.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity testID="btn-go-rename" style={[styles.actionRow, shadow.card]} onPress={() => router.push("/(app)/rename")}>
            <View style={[styles.sourceIcon, { backgroundColor: "#FFF9EC" }]}>
              <Ionicons name="sparkles-outline" size={22} color={colors.ai} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Rename generic files</Text>
              <Text style={styles.actionBody}>AI suggests better names. Tap to approve.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* STICKY SCAN CTA */}
      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity testID="btn-start-scan" style={styles.scanBtn} onPress={() => router.push("/(app)/scan")}>
          <Ionicons name="scan-outline" size={20} color="#fff" />
          <Text style={styles.scanBtnText}>Start Smart Scan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },

  header: { flexDirection: "row", alignItems: "flex-start", marginTop: spacing.lg, marginBottom: spacing.md },
  greetingLabel: { ...typography.label, marginBottom: 6 },
  h1: { ...typography.h1, color: colors.textPrimary, letterSpacing: -0.8 },
  signOutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },

  heroCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  heroLabel: { ...typography.label },
  heroValue: { fontSize: 44, fontWeight: "900", letterSpacing: -1.2, color: colors.primary, marginTop: 4 },
  heroRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  heroChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceHover, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  heroChipText: { ...typography.bodySm, color: colors.primary, fontWeight: "600" },

  bentoRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  bentoCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)", gap: 8 },
  bentoValue: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  bentoLabel: { ...typography.bodySm, color: colors.textSecondary },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  linkText: { color: colors.primary, fontWeight: "700", fontSize: 14 },

  emptySources: { borderRadius: radius.card, minHeight: 180, overflow: "hidden", borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  emptyOverlay: { flex: 1, padding: spacing.lg, backgroundColor: "rgba(255,255,255,0.85)", borderRadius: radius.card, gap: 10 },
  emptyTitle: { ...typography.h3, color: colors.textPrimary },
  emptyBody: { ...typography.body, color: colors.textSecondary },
  emptyBtn: { marginTop: 8, flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.button },
  emptyBtnText: { color: "#fff", fontWeight: "700" },

  sourceCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  sourceIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sourceLabel: { ...typography.h3, fontSize: 16, color: colors.textPrimary },
  sourceType: { ...typography.bodySm, color: colors.textSecondary },
  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#E8F5E9", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  sourceBadgeText: { color: colors.success, fontSize: 11, fontWeight: "700" },

  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  actionTitle: { ...typography.h3, fontSize: 16, color: colors.textPrimary },
  actionBody: { ...typography.bodySm, color: colors.textSecondary },

  stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: 12, backgroundColor: "rgba(250,250,250,0.95)", borderTopWidth: 1, borderTopColor: colors.border },
  scanBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 16, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 },
  scanBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.3 },
});
