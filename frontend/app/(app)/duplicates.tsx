import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, ImageBackground } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

function fmt(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function Duplicates() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.analyze();
      setData(r);
      // pre-select all non-keep files
      const ids = new Set<string>();
      (r.duplicate_groups || []).forEach((g: any) => {
        g.files.forEach((f: any) => {
          if (f.id !== g.keep_id) ids.add(f.id);
        });
      });
      setSelectedToDelete(ids);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to analyze");
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (id: string, isKeep: boolean) => {
    if (isKeep) return; // can't select the keep file in default action
    const s = new Set(selectedToDelete);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedToDelete(s);
  };

  const totalSpace = data?.duplicate_groups?.reduce((acc: number, g: any) => {
    return acc + g.files.filter((f: any) => selectedToDelete.has(f.id)).reduce((a: number, f: any) => a + (f.size || 0), 0);
  }, 0) || 0;

  const doBulkDelete = () => {
    if (selectedToDelete.size === 0) return;
    Alert.alert(
      "Delete duplicates?",
      `Permanently delete ${selectedToDelete.size} files (${fmt(totalSpace)})? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            for (const id of selectedToDelete) {
              try { await api.deleteFile(id); } catch (e) { /* empty */ }
            }
            setBusy(false);
            load();
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[typography.bodySm, { color: colors.textSecondary, marginTop: spacing.md }]}>Running AI analysis...</Text>
      </View>
    );
  }

  const groups: any[] = data?.duplicate_groups || [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity testID="btn-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Duplicates</Text>
        <TouchableOpacity testID="btn-refresh" onPress={load} style={styles.iconBtn}>
          <Ionicons name="refresh" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <ImageBackground source={{ uri: images.emptyClean }} imageStyle={{ borderRadius: 24 }} style={styles.emptyImg} />
          <Text style={[typography.h2, { textAlign: "center", marginTop: spacing.lg }]}>You're perfectly organized.</Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center", marginTop: 6 }]}>
            No duplicate files found. Run a scan to keep checking.
          </Text>
          <TouchableOpacity testID="btn-empty-scan" style={styles.scanCta} onPress={() => router.replace("/(app)/scan")}>
            <Text style={styles.scanCtaText}>Run another scan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 140 }}>
            <View style={[styles.summaryCard, shadow.card]}>
              <Text style={typography.label}>RECOVERABLE</Text>
              <Text style={{ fontSize: 40, fontWeight: "900", color: colors.primary, letterSpacing: -1 }}>{fmt(totalSpace)}</Text>
              <Text style={[typography.bodySm, { color: colors.textSecondary }]}>{selectedToDelete.size} files selected for deletion</Text>
            </View>

            {groups.map((g, gi) => (
              <View key={gi} style={[styles.group, shadow.card]} testID={`duplicate-group-${gi}`}>
                <View style={styles.groupHeader}>
                  <Text style={typography.label}>GROUP {gi + 1}</Text>
                  <Text style={[typography.bodySm, { color: colors.textSecondary }]}>{g.files.length} copies</Text>
                </View>
                <View style={styles.reasonRow}>
                  <Ionicons name="sparkles" size={14} color={colors.ai} />
                  <Text style={[typography.bodySm, { color: colors.textPrimary, flex: 1 }]}>{g.reason}</Text>
                </View>

                {g.files.map((f: any) => {
                  const isKeep = f.id === g.keep_id;
                  const willDelete = selectedToDelete.has(f.id);
                  return (
                    <TouchableOpacity
                      key={f.id}
                      testID={`file-row-${f.id}`}
                      style={[styles.fileRow, isKeep && styles.fileRowKeep, !isKeep && willDelete && styles.fileRowDelete]}
                      onPress={() => toggle(f.id, isKeep)}
                      disabled={isKeep}
                    >
                      <View style={[styles.fileIconBox, { backgroundColor: isKeep ? colors.surfaceElevated : colors.destructiveSoft }]}>
                        <Ionicons name={isKeep ? "checkmark-circle" : "trash-outline"} size={20} color={isKeep ? colors.primary : colors.destructive} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                        <Text style={styles.fileMeta} numberOfLines={1}>{f.source} · {fmt(f.size)} · {(f.mime_type || "").split("/")[1] || "file"}</Text>
                      </View>
                      {isKeep ? (
                        <View style={styles.keepBadge}>
                          <Text style={styles.keepBadgeText}>KEEP</Text>
                        </View>
                      ) : (
                        <Ionicons name={willDelete ? "checkbox" : "square-outline"} size={22} color={willDelete ? colors.destructive : colors.textSecondary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity
              testID="btn-bulk-delete"
              style={[styles.deleteBtn, selectedToDelete.size === 0 && { opacity: 0.4 }]}
              onPress={doBulkDelete}
              disabled={selectedToDelete.size === 0 || busy}
            >
              {busy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="trash" size={18} color="#fff" />
                  <Text style={styles.deleteBtnText}>Delete {selectedToDelete.size} files · {fmt(totalSpace)}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerTitle: { ...typography.h3 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyImg: { width: 220, height: 220 },
  scanCta: { marginTop: spacing.xl, backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: radius.button },
  scanCtaText: { color: "#fff", fontWeight: "700" },

  summaryCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },

  group: { backgroundColor: colors.surface, borderRadius: radius.card, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  reasonRow: { flexDirection: "row", gap: 6, alignItems: "flex-start", padding: spacing.md, backgroundColor: colors.aiSoft, borderBottomWidth: 1, borderBottomColor: colors.border },

  fileRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  fileRowKeep: { backgroundColor: colors.surface, borderLeftWidth: 4, borderLeftColor: colors.primary },
  fileRowDelete: { backgroundColor: colors.destructiveSoft },
  fileIconBox: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  fileName: { ...typography.bodyMd, color: colors.textPrimary, fontWeight: "600" },
  fileMeta: { ...typography.mono, marginTop: 2 },
  keepBadge: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  keepBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  stickyBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: 12, backgroundColor: colors.background + "EE", borderTopWidth: 1, borderTopColor: colors.border },
  deleteBtn: { backgroundColor: colors.destructive, borderRadius: radius.button, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, ...shadow.destructive },
  deleteBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
