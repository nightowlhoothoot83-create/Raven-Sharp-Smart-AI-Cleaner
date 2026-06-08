import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Modal, ImageBackground } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

export default function Rename() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.renameCandidates();
      setItems(r.candidates || []);
    } catch (e) { /* empty */ }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const approve = async (item: any, finalName?: string) => {
    setBusy(true);
    try {
      await api.renameFile(item.id, finalName || item.ai_suggested_name);
      setItems((prev) => prev.filter((p) => p.id !== item.id));
    } catch (e) { /* empty */ }
    setBusy(false);
    setEditing(null);
  };

  const reject = async (item: any) => {
    // mark non-generic so it stops appearing
    await api.renameFile(item.id, item.name);
    setItems((prev) => prev.filter((p) => p.id !== item.id));
  };

  if (loading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={colors.ai} />
        <Text style={[typography.bodySm, { color: colors.textSecondary, marginTop: spacing.md }]}>AI is naming your files...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity testID="btn-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Rename</Text>
        <TouchableOpacity testID="btn-refresh" onPress={load} style={styles.iconBtn}>
          <Ionicons name="sparkles" size={20} color={colors.ai} />
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <ImageBackground source={{ uri: images.emptyClean }} imageStyle={{ borderRadius: 24 }} style={styles.emptyImg} />
          <Text style={[typography.h2, { textAlign: "center", marginTop: spacing.lg }]}>Everything is named clearly.</Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center", marginTop: 6 }]}>
            No generic file names detected. Scan more files to surface candidates.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}>
          <Text style={[typography.label, { marginVertical: spacing.md }]}>
            {items.length} FILES NEED A BETTER NAME
          </Text>

          {items.map((item) => (
            <View key={item.id} style={styles.card} testID={`rename-card-${item.id}`}>
              <View style={styles.cardHeader}>
                <Ionicons name="sparkles" size={16} color={colors.violetSoft} />
                <Text style={styles.cardHeaderText}>AI SUGGESTION</Text>
              </View>
              <View style={styles.namePair}>
                <Text style={styles.fromLabel}>Current</Text>
                <Text style={styles.fromName} numberOfLines={1}>{item.name}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.namePair}>
                <Text style={[styles.fromLabel, { color: colors.violetSoft }]}>Suggested</Text>
                <Text style={styles.toName} numberOfLines={2}>{item.ai_suggested_name}</Text>
              </View>

              {item.text_preview ? (
                <Text style={styles.preview} numberOfLines={2}>{item.text_preview}</Text>
              ) : null}

              <View style={styles.btnRow}>
                <TouchableOpacity testID={`btn-reject-${item.id}`} style={styles.rejectBtn} onPress={() => reject(item)}>
                  <Ionicons name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity testID={`btn-edit-${item.id}`} style={styles.editBtn} onPress={() => { setEditing(item); setEditName(item.ai_suggested_name); }}>
                  <Ionicons name="create-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity testID={`btn-approve-${item.id}`} style={styles.approveBtn} onPress={() => approve(item)} disabled={busy}>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }} bottomOffset={20} keyboardShouldPersistTaps="handled">
            <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
              <View style={styles.handle} />
              <Text style={typography.h2}>Edit name</Text>
              <Text style={[typography.bodySm, { color: colors.textSecondary, marginBottom: spacing.md }]}>
                Fine-tune the AI suggestion.
              </Text>
              <TextInput
                testID="input-edit-name"
                style={styles.input}
                value={editName}
                onChangeText={setEditName}
                autoCapitalize="none"
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
                <TouchableOpacity testID="btn-cancel-edit" style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setEditing(null)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="btn-save-edit" style={[styles.approveBtn, { flex: 1 }]} onPress={() => approve(editing, editName)} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </Modal>
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

  card: { backgroundColor: colors.aiSoft, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.violet + "55", marginBottom: spacing.md, ...shadow.card },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md },
  cardHeaderText: { ...typography.label, color: colors.violetSoft },
  namePair: { gap: 4 },
  fromLabel: { ...typography.label, color: colors.textMuted, fontSize: 10 },
  fromName: { ...typography.bodyMd, color: colors.textSecondary, textDecorationLine: "line-through" },
  toName: { fontSize: 18, fontWeight: "800", color: colors.violetSoft, letterSpacing: -0.3 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  preview: { ...typography.mono, marginTop: spacing.md, color: colors.textMuted },

  btnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rejectBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  editBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.button, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  editText: { color: colors.textPrimary, fontWeight: "700" },
  approveBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.button, backgroundColor: colors.violet },
  approveText: { color: "#fff", fontWeight: "800" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.lg, gap: 8, borderTopWidth: 1, borderTopColor: colors.border },
  handle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  input: { backgroundColor: colors.surfaceElevated, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: colors.textPrimary, marginTop: 6, borderWidth: 1, borderColor: colors.border },
  cancelBtn: { backgroundColor: colors.surfaceElevated, borderRadius: radius.button, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.textPrimary, fontWeight: "700" },
});
