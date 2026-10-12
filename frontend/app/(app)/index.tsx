import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, ImageBackground, Modal, FlatList, Switch } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, getToken } from "@/src/api";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

function fmt(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

const INTERNAL_SOURCES = [
  { id: "gallery", label: "Image Gallery", icon: "images-outline" },
  { id: "pictures", label: "Pictures", icon: "images-outline" },
  { id: "downloads", label: "Downloads", icon: "download-outline" },
  { id: "documents", label: "Documents", icon: "document-text-outline" },
  { id: "all_folders", label: "All Folders", icon: "folder-open-outline" },
];

const EXTERNAL_SOURCES = [
  { id: "gdrive", label: "Google Drive", icon: "logo-google" },
  { id: "dropbox", label: "Dropbox", icon: "logo-dropbox" },
  { id: "onedrive", label: "OneDrive", icon: "logo-microsoft" },
  { id: "gphotos", label: "Google Photos", icon: "image-outline" },
];

export default function Dashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [data, setData] = useState<any>(null);
  const [connectedSources, setConnectedSources] = useState<any[]>([]);
  const [selectedInternal, setSelectedInternal] = useState<Set<string>>(new Set());
  const [selectedExternal, setSelectedExternal] = useState<Set<string>>(new Set());
  const [showInternalMenu, setShowInternalMenu] = useState(false);
  const [showExternalMenu, setShowExternalMenu] = useState(false);
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set());
  const [renameEditing, setRenameEditing] = useState<{ id: string; newName: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await api.stats();
      const result = await api.analyze();
      setData(result);

      const ids = new Set<string>();
      (result.duplicate_groups || []).forEach((g: any) => {
        g.files.forEach((f: any) => {
          if (f.id !== g.keep_id) ids.add(f.id);
        });
      });
      setSelectedToDelete(ids);

      const sources = await api.listSources();
      setConnectedSources(sources.sources || []);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to load");
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleInternal = (id: string) => {
    const s = new Set(selectedInternal);
    if (id === "all") {
      if (s.size === INTERNAL_SOURCES.length) {
        s.clear();
      } else {
        INTERNAL_SOURCES.forEach(src => s.add(src.id));
      }
    } else {
      if (s.has(id)) s.delete(id);
      else s.add(id);
    }
    setSelectedInternal(s);
  };

  const toggleExternal = (id: string) => {
    const s = new Set(selectedExternal);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelectedExternal(s);
  };

  const doScanAll = async () => {
    if (selectedInternal.size === 0 && selectedExternal.size === 0) {
      Alert.alert("No sources", "Select at least one source to scan.");
      return;
    }

    setScanning(true);
    try {
      // For now, just call analyze (local sources are auto-registered via buttons)
      const result = await api.analyze();
      setData(result);
      Alert.alert("Scan complete", `Found ${result.duplicate_groups_count} duplicate groups.`);
    } catch (e: any) {
      Alert.alert("Scan failed", e.message || "Unknown error");
    }
    setScanning(false);
  };

  const handleDeleteSelected = () => {
    if (selectedToDelete.size === 0) return;
    const totalSpace = data?.duplicate_groups?.reduce((acc: number, g: any) => {
      return acc + g.files.filter((f: any) => selectedToDelete.has(f.id)).reduce((a: number, f: any) => a + (f.size || 0), 0);
    }, 0) || 0;

    Alert.alert(
      "Delete duplicates?",
      `Permanently delete ${selectedToDelete.size} files (${fmt(totalSpace)})? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            for (const id of selectedToDelete) {
              try { await api.deleteFile(id); } catch (e) { }
            }
            load();
          },
        },
      ],
    );
  };

  const handleApproveRename = async (fileId: string, newName: string) => {
    if (!newName.trim()) return;
    setRenameBusy(true);
    try {
      await api.renameFile(fileId, newName);
      setRenameEditing(null);
      load();
    } catch (e: any) {
      Alert.alert("Rename failed", e.message);
    }
    setRenameBusy(false);
  };

  const toggleDeleteFile = (id: string) => {
    const s = new Set(selectedToDelete);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelectedToDelete(s);
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const totalRecoverable = data?.space_recoverable || 0;
  const duplicateCount = data?.duplicate_groups_count || 0;
  const hasRenameables = data?.duplicate_groups ? data.duplicate_groups.some((g: any) => g.files.some((f: any) => f.is_generic_name)) : false;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Smart Cleaner</Text>
        <TouchableOpacity testID="btn-settings" onPress={() => router.push("/(app)/settings")} style={styles.iconBtn}>
          <Ionicons name="settings-outline" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 200 }}>
        {/* Stats Cards */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, shadow.card]}>
            <Text style={styles.statLabel}>Total Files</Text>
            <Text style={styles.statValue}>{data?.total_files || 0}</Text>
          </View>
          <View style={[styles.statCard, shadow.card]}>
            <Text style={styles.statLabel}>Duplicates</Text>
            <Text style={styles.statValue}>{duplicateCount}</Text>
          </View>
          <View style={[styles.statCard, shadow.card]}>
            <Text style={styles.statLabel}>Recoverable</Text>
            <Text style={styles.statValue}>{fmt(totalRecoverable)}</Text>
          </View>
        </View>

        {/* Add Sources */}
        <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.md }]}>ADD SOURCES</Text>

        <View style={styles.sourceButtonsRow}>
          <TouchableOpacity
            style={[styles.sourceBtn, shadow.card]}
            onPress={() => setShowInternalMenu(true)}
          >
            <Ionicons name="phone-portrait-outline" size={20} color={colors.primary} />
            <Text style={styles.sourceBtnText}>Add Internal Source</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sourceBtn, shadow.card]}
            onPress={() => setShowExternalMenu(true)}
          >
            <Ionicons name="cloud-outline" size={20} color={colors.primary} />
            <Text style={styles.sourceBtnText}>Add External Source</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Connected Sources */}
        <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.md }]}>CONNECTED SOURCES</Text>
        {connectedSources.length === 0 ? (
          <View style={[styles.emptyCard, shadow.card]}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
            <Text style={[typography.bodySm, { color: colors.textSecondary, marginTop: spacing.sm }]}>No sources connected yet</Text>
          </View>
        ) : (
          connectedSources.map((src) => (
            <View key={src.id} style={[styles.sourceCard, shadow.card]}>
              <View style={styles.sourceCardContent}>
                <Ionicons name={src.type === "gdrive" ? "logo-google" : src.type === "dropbox" ? "logo-dropbox" : "cloud-outline"} size={20} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={typography.bodyMd}>{src.label}</Text>
                  <Text style={[typography.mono, { color: colors.textSecondary, fontSize: 11 }]}>{src.type}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => { /* disconnect */ }}>
                <Ionicons name="close-circle-outline" size={20} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Selected Internal Sources Preview */}
        {selectedInternal.size > 0 && (
          <View style={[styles.selectedPreview, shadow.card]}>
            <Text style={[typography.label, { marginBottom: spacing.sm }]}>READY TO SCAN</Text>
            {INTERNAL_SOURCES.filter(s => selectedInternal.has(s.id)).map(src => (
              <Text key={src.id} style={[typography.bodySm, { color: colors.primary, marginBottom: 4 }]}>
                ✓ {src.label}
              </Text>
            ))}
          </View>
        )}

        {/* Scan All Button */}
        <TouchableOpacity
          style={[styles.scanBtn, shadow.card, scanning && { opacity: 0.6 }]}
          onPress={doScanAll}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Ionicons name="play-circle" size={20} color={colors.primary} />
              <Text style={styles.scanBtnText}>SCAN ALL SOURCES</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Duplicates Section */}
        {data?.duplicate_groups && data.duplicate_groups.length > 0 && (
          <View>
            <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.md }]}>DUPLICATES TO DELETE</Text>
            {data.duplicate_groups.map((g: any, gi: number) => (
              <View key={gi} style={[styles.group, shadow.card]}>
                <View style={styles.groupHeader}>
                  <Text style={typography.label}>
                    {g.kind === "exact_duplicate" ? "EXACT" : g.kind === "draft_cluster" ? "VARIANTS" : "SIMILAR"} · {g.files.length} files
                  </Text>
                </View>
                {g.files.map((f: any) => {
                  const isKeep = f.id === g.keep_id;
                  const willDelete = selectedToDelete.has(f.id);
                  return (
                    <TouchableOpacity
                      key={f.id}
                      style={[styles.fileRow, isKeep && styles.fileRowKeep]}
                      onPress={() => !isKeep && toggleDeleteFile(f.id)}
                      disabled={isKeep}
                    >
                      <View style={[styles.checkbox, willDelete && styles.checkboxChecked]}>
                        {willDelete && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[typography.bodyMd, { fontWeight: "600" }]} numberOfLines={1}>{f.name}</Text>
                        <Text style={[typography.mono, { fontSize: 10 }]}>{fmt(f.size)}</Text>
                      </View>
                      {isKeep && <Text style={styles.keepBadge}>KEEP</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
            <TouchableOpacity
              style={[styles.deleteBtn, shadow.card, selectedToDelete.size === 0 && { opacity: 0.4 }]}
              onPress={handleDeleteSelected}
              disabled={selectedToDelete.size === 0}
            >
              <Ionicons name="trash" size={18} color={colors.destructive} />
              <Text style={styles.deleteBtnText}>Delete {selectedToDelete.size} files</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Rename Section */}
        {hasRenameables && (
          <View>
            <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.md }]}>FILES TO RENAME</Text>
            {data.duplicate_groups?.map((g: any, gi: number) =>
              g.files.filter((f: any) => f.is_generic_name).map((f: any) => (
                <View key={f.id} style={[styles.renameCard, shadow.card]}>
                  <Text style={[typography.bodyMd, { fontWeight: "600", marginBottom: spacing.sm }]}>{f.name}</Text>
                  {f.ai_suggested_name && (
                    <View style={styles.suggestionBox}>
                      <Ionicons name="sparkles" size={14} color={colors.ai} />
                      <Text style={[typography.bodySm, { color: colors.ai, marginLeft: spacing.sm, flex: 1 }]}>
                        {f.ai_suggested_name}
                      </Text>
                    </View>
                  )}
                  {renameEditing?.id === f.id ? (
                    <View style={styles.editBox}>
                      <TextInput
                        value={renameEditing.newName}
                        onChangeText={(t) => setRenameEditing({ ...renameEditing, newName: t })}
                        placeholder="Enter new name..."
                        style={styles.input}
                      />
                      <TouchableOpacity
                        onPress={() => handleApproveRename(f.id, renameEditing.newName)}
                        disabled={renameBusy}
                      >
                        <Text style={styles.approveText}>{renameBusy ? "..." : "Save"}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      {f.ai_suggested_name && (
                        <TouchableOpacity
                          style={styles.approveBtn}
                          onPress={() => handleApproveRename(f.id, f.ai_suggested_name)}
                        >
                          <Text style={styles.approveBtnText}>Approve</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => setRenameEditing({ id: f.id, newName: f.name })}
                      >
                        <Text style={styles.editBtnText}>Edit manually</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Internal Sources Menu */}
      <Modal visible={showInternalMenu} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingTop: insets.top + spacing.lg }]}>
            <View style={styles.modalHeader}>
              <Text style={typography.h3}>Add Internal Source</Text>
              <TouchableOpacity onPress={() => setShowInternalMenu(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={[{ id: "all", label: "Select All Folders", icon: "checkmark-all" }, ...INTERNAL_SOURCES]}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => toggleInternal(item.id)}
                >
                  <Ionicons
                    name={selectedInternal.has(item.id) ? "checkbox" : "square-outline"}
                    size={20}
                    color={selectedInternal.has(item.id) ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[typography.body, { marginLeft: spacing.md, flex: 1 }]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.modalBtn, shadow.card]}
              onPress={() => setShowInternalMenu(false)}
            >
              <Text style={styles.modalBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* External Sources Menu */}
      <Modal visible={showExternalMenu} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingTop: insets.top + spacing.lg }]}>
            <View style={styles.modalHeader}>
              <Text style={typography.h3}>Add External Source</Text>
              <TouchableOpacity onPress={() => setShowExternalMenu(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={EXTERNAL_SOURCES}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    // TODO: trigger OAuth flow for each provider
                    Alert.alert("Coming soon", `${item.label} OAuth flow will be added next.`);
                  }}
                >
                  <Ionicons name={item.icon} size={20} color={colors.primary} />
                  <Text style={[typography.body, { marginLeft: spacing.md, flex: 1 }]}>{item.label}</Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.modalBtn, shadow.card]}
              onPress={() => setShowExternalMenu(false)}
            >
              <Text style={styles.modalBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const { TextInput } = require("react-native");

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },

  statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  statLabel: { ...typography.mono, color: colors.textSecondary, fontSize: 10, marginBottom: 4 },
  statValue: { fontSize: 24, fontWeight: "900", color: colors.primary },

  sourceButtonsRow: { gap: spacing.md, marginBottom: spacing.lg },
  sourceBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  sourceBtnText: { ...typography.bodyMd, flex: 1, fontWeight: "600" },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  sourceCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sourceCardContent: { flexDirection: "row", alignItems: "center", flex: 1 },

  selectedPreview: { backgroundColor: colors.aiSoft, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.ai + "40", marginBottom: spacing.md },

  scanBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, marginBottom: spacing.lg },
  scanBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  group: { backgroundColor: colors.surface, borderRadius: radius.card, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  groupHeader: { backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  fileRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  fileRowKeep: { backgroundColor: colors.aiSoft },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: colors.destructive, borderColor: colors.destructive },
  keepBadge: { ...typography.mono, color: colors.primary, fontSize: 10, fontWeight: "800" },

  deleteBtn: { backgroundColor: colors.destructiveSoft, borderRadius: radius.button, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.destructive + "40" },
  deleteBtnText: { color: colors.destructive, fontWeight: "700" },

  renameCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  suggestionBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.aiSoft, borderRadius: radius.button, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
  editBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.button, paddingHorizontal: spacing.md, paddingVertical: 8, color: colors.textPrimary },
  actionRow: { flexDirection: "row", gap: spacing.md },
  approveBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 10, alignItems: "center" },
  approveBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  editBtn: { flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.button, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  editBtnText: { color: colors.textPrimary, fontWeight: "700", fontSize: 13 },
  approveText: { color: colors.primary, fontWeight: "700" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%", paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  menuItem: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  modalBtnText: { color: "#fff", fontWeight: "800" },
});
