import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Image, Linking } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth-context";
import { api } from "@/src/api";
import { colors, typography, spacing, radius, brand, brandFamily, shadow } from "@/src/theme";

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
    } catch (e) { /* ignore */ }
    finally {
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
      {/* cosmic glow accents */}
      <View style={styles.cosmicBg1} />
      <View style={styles.cosmicBg2} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {/* Branded header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <Image source={{ uri: brand.ravenSharpLogo }} style={styles.headerLogo} resizeMode="contain" />
            <View>
              <Text style={styles.brandText}>RAVEN<Text style={{ color: colors.primary }}>SHARP</Text></Text>
              <Text style={styles.brandGroup}>{brand.group}</Text>
            </View>
          </View>
          <TouchableOpacity testID="btn-signout" onPress={signOut} style={styles.signOutBtn}>
            <Ionicons name="log-out-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.greeting}>
          <Text style={styles.greetingLabel}>WELCOME, {String(greeting).toUpperCase()}</Text>
          <Text style={styles.h1}>Reclaim your{"\n"}<Text style={{ color: colors.primary }}>digital space.</Text></Text>
        </View>

        {/* HERO STATS */}
        <View style={[styles.heroCard, shadow.glow]} testID="hero-card">
          <View style={styles.heroGlow} />
          <Text style={styles.heroLabel}>SPACE RECOVERABLE</Text>
          <Text style={styles.heroValue}>{formatBytes(stats?.space_recoverable || 0)}</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroChip}>
              <Ionicons name="copy-outline" size={14} color={colors.cyan} />
              <Text style={styles.heroChipText}>{stats?.duplicate_groups_count || 0} duplicates</Text>
            </View>
            <View style={[styles.heroChip, { backgroundColor: colors.aiSoft }]}>
              <Ionicons name="sparkles-outline" size={14} color={colors.violetSoft} />
              <Text style={[styles.heroChipText, { color: colors.violetSoft }]}>{stats?.generic_named_files || 0} need renaming</Text>
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
            <Ionicons name="cloud-outline" size={20} color={colors.violetSoft} />
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
          <View style={[styles.emptyCard, shadow.card]}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Connect your first source</Text>
            <Text style={styles.emptyBody}>Internal storage, Google Drive, or Dropbox — scan them all from one place.</Text>
            <TouchableOpacity testID="btn-connect-first" style={styles.emptyBtn} onPress={() => router.push("/(app)/sources")}>
              <Text style={styles.emptyBtnText}>Connect a source</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg }}>
            {sources.map((s) => (
              <View key={s.id} style={[styles.sourceCard, shadow.card]}>
                <View style={[styles.sourceIcon, { backgroundColor: colors.surfaceElevated }]}>
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
        <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg }}>
          <TouchableOpacity testID="btn-go-duplicates" style={[styles.actionRow, shadow.card]} onPress={() => router.push("/(app)/duplicates")}>
            <View style={[styles.sourceIcon, { backgroundColor: colors.surfaceElevated }]}>
              <Ionicons name="copy-outline" size={22} color={colors.cyan} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Review duplicates</Text>
              <Text style={styles.actionBody}>AI chose what to keep. You approve.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity testID="btn-go-rename" style={[styles.actionRow, shadow.card]} onPress={() => router.push("/(app)/rename")}>
            <View style={[styles.sourceIcon, { backgroundColor: colors.aiSoft }]}>
              <Ionicons name="sparkles-outline" size={22} color={colors.violetSoft} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Rename generic files</Text>
              <Text style={styles.actionBody}>AI suggests better names. Tap to approve.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* MORE FROM ASCENSION DIGITAL */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>More from Ascension Digital</Text>
            <Text style={styles.sectionSub}>{brand.groupTagline}</Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
          testID="brand-family-carousel"
        >
          {brandFamily.map((b) => (
            <TouchableOpacity
              key={b.name}
              testID={`brand-${b.name.replace(/\s+/g, "-").toLowerCase()}`}
              style={[styles.brandCard, shadow.card]}
              onPress={() => b.url && Linking.openURL(b.url)}
              activeOpacity={0.8}
            >
              <View style={[styles.brandIcon, { backgroundColor: `${b.accent}22` }]}>
                <Ionicons name={b.icon as any} size={24} color={b.accent} />
              </View>
              {b.status === "soon" ? (
                <View style={styles.soonBadge}>
                  <Text style={styles.soonText}>SOON</Text>
                </View>
              ) : (
                <View style={[styles.soonBadge, { backgroundColor: colors.success + "22" }]}>
                  <Text style={[styles.soonText, { color: colors.success }]}>LIVE</Text>
                </View>
              )}
              <Text style={styles.brandCardTitle} numberOfLines={1}>{b.name}</Text>
              <Text style={styles.brandCardCat}>{b.category}</Text>
              <Text style={styles.brandCardDesc} numberOfLines={3}>{b.desc}</Text>
              {b.url && (
                <View style={styles.brandCardCta}>
                  <Text style={[styles.brandCardCtaText, { color: b.accent }]}>Visit</Text>
                  <Ionicons name="arrow-forward" size={12} color={b.accent} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ASCENSION DIGITAL FOOTER */}
        <View style={styles.ascensionFooter}>
          <Image source={{ uri: brand.ascensionLogo }} style={styles.ascensionLogo} resizeMode="contain" />
          <Text style={styles.ascensionTagline}>Elevating Your Digital Future</Text>
          <TouchableOpacity testID="link-ascension" onPress={() => Linking.openURL("https://ascensiondigitalgroup.com")}>
            <Text style={styles.ascensionLink}>ascensiondigitalgroup.com →</Text>
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
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },

  cosmicBg1: { position: "absolute", top: -160, right: -100, width: 360, height: 360, borderRadius: 180, backgroundColor: colors.violet, opacity: 0.12 },
  cosmicBg2: { position: "absolute", top: 100, left: -120, width: 320, height: 320, borderRadius: 160, backgroundColor: colors.primary, opacity: 0.1 },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.md },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerLogo: { width: 44, height: 44 },
  brandText: { fontSize: 16, fontWeight: "900", color: colors.textPrimary, letterSpacing: 2 },
  brandGroup: { fontSize: 9, color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  signOutBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },

  greeting: { paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.lg },
  greetingLabel: { ...typography.label, marginBottom: 6 },
  h1: { ...typography.h1, color: colors.textPrimary, letterSpacing: -0.8 },

  heroCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, marginHorizontal: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.primary + "44", overflow: "hidden" },
  heroGlow: { position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: colors.primary, opacity: 0.15 },
  heroLabel: { ...typography.label, color: colors.primary },
  heroValue: { fontSize: 44, fontWeight: "900", letterSpacing: -1.2, color: colors.textPrimary, marginTop: 4 },
  heroRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  heroChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceElevated, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  heroChipText: { ...typography.bodySm, color: colors.cyan, fontWeight: "600" },

  bentoRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  bentoCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: 8 },
  bentoValue: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  bentoLabel: { ...typography.bodySm, color: colors.textSecondary },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: spacing.lg, marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  sectionSub: { ...typography.bodySm, color: colors.textMuted, marginTop: 2 },
  linkText: { color: colors.primary, fontWeight: "700", fontSize: 14 },

  emptyCard: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, gap: 8, alignItems: "flex-start" },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: 8 },
  emptyBody: { ...typography.body, color: colors.textSecondary },
  emptyBtn: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.button },
  emptyBtnText: { color: "#fff", fontWeight: "700" },

  sourceCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  sourceIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sourceLabel: { ...typography.h3, fontSize: 16, color: colors.textPrimary },
  sourceType: { ...typography.bodySm, color: colors.textSecondary },
  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.success + "22", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  sourceBadgeText: { color: colors.success, fontSize: 11, fontWeight: "700" },

  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  actionTitle: { ...typography.h3, fontSize: 16, color: colors.textPrimary },
  actionBody: { ...typography.bodySm, color: colors.textSecondary },

  brandCard: { width: 200, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, gap: 6 },
  brandIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  soonBadge: { position: "absolute", top: spacing.md, right: spacing.md, backgroundColor: colors.warn + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  soonText: { fontSize: 9, fontWeight: "800", color: colors.warn, letterSpacing: 0.5 },
  brandCardTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, marginTop: 4 },
  brandCardCat: { fontSize: 10, color: colors.textMuted, letterSpacing: 1, fontWeight: "700", textTransform: "uppercase" },
  brandCardDesc: { ...typography.bodySm, color: colors.textSecondary, minHeight: 50, marginTop: 4 },
  brandCardCta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  brandCardCtaText: { fontSize: 12, fontWeight: "700" },

  ascensionFooter: { alignItems: "center", marginTop: spacing.xl, paddingHorizontal: spacing.lg, gap: 6 },
  ascensionLogo: { width: 120, height: 120, opacity: 0.9 },
  ascensionTagline: { ...typography.label, color: colors.cyan, fontSize: 10 },
  ascensionLink: { color: colors.primary, fontSize: 13, fontWeight: "700", marginTop: 4 },

  stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: 12, backgroundColor: colors.background + "EE", borderTopWidth: 1, borderTopColor: colors.border },
  scanBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 16, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, ...shadow.glow },
  scanBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
});
