import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, typography, spacing, radius, shadow } from "@/src/theme";

type SourceType = "gdrive" | "dropbox" | null;

export default function Sources() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState<SourceType>(null);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listSources();
      setSources(r.sources || []);
    } catch (e) { /* empty */ }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    setErr(null);
    if (!token.trim()) { setErr("Access token required"); return; }
    setConnecting(true);
    try {
      if (showAdd === "gdrive") await api.connectGDrive(token.trim(), label.trim() || "My Drive");
      if (showAdd === "dropbox") await api.connectDropbox(token.trim(), label.trim() || "My Dropbox");
      setShowAdd(null);
      setToken("");
      setLabel("");
      load();
    } catch (e: any) {
      setErr(e.message || "Connection failed. Check your token.");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = (id: string) => {
    Alert.alert("Disconnect source?", "This will remove all scanned files from this source.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: async () => { await api.disconnectSource(id); load(); } },
    ]);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity testID="btn-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Storage sources</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 80, gap: spacing.md }}>
        <Text style={[typography.label, { marginTop: 8 }]}>CONNECTED ACCOUNTS</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : sources.length === 0 ? (
          <View style={[styles.emptyCard, shadow.card]}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} />
            <Text style={[typography.bodyMd, { color: colors.textSecondary, marginTop: 8 }]}>No sources connected yet.</Text>
          </View>
        ) : (
          sources.map((s) => (
            <View key={s.id} style={[styles.sourceCard, shadow.card]}>
              <View style={[styles.iconWrap, { backgroundColor: s.type === "gdrive" ? "#E8F0FE" : "#E3F2FD" }]}>
                <Ionicons name={s.type === "gdrive" ? "logo-google" : "logo-dropbox"} size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle}>{s.label}</Text>
                <Text style={styles.sourceMeta}>{s.type === "gdrive" ? "Google Drive" : "Dropbox"}</Text>
              </View>
              <TouchableOpacity testID={`btn-disconnect-${s.id}`} onPress={() => disconnect(s.id)} style={styles.disconnectBtn}>
                <Ionicons name="close" size={16} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={[typography.label, { marginTop: spacing.lg }]}>ADD A NEW SOURCE</Text>

        <TouchableOpacity testID="btn-add-gdrive" style={[styles.addCard, shadow.card]} onPress={() => setShowAdd("gdrive")}>
          <View style={[styles.iconWrap, { backgroundColor: "#E8F0FE" }]}>
            <Ionicons name="logo-google" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle}>Google Drive</Text>
            <Text style={styles.sourceMeta}>Connect one or more accounts</Text>
          </View>
          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity testID="btn-add-dropbox" style={[styles.addCard, shadow.card]} onPress={() => setShowAdd("dropbox")}>
          <View style={[styles.iconWrap, { backgroundColor: "#E3F2FD" }]}>
            <Ionicons name="logo-dropbox" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle}>Dropbox</Text>
            <Text style={styles.sourceMeta}>Connect with access token</Text>
          </View>
          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
        </TouchableOpacity>

        <View style={[styles.infoCard]}>
          <Ionicons name="information-circle" size={18} color={colors.primary} />
          <Text style={styles.infoText}>
            Google Drive: get a token at https://developers.google.com/oauthplayground (scope: drive). Dropbox: generate from your Dropbox App Console.
          </Text>
        </View>
      </ScrollView>

      {/* Add modal */}
      <Modal visible={!!showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(null)}>
        <View style={styles.modalBg}>
          <KeyboardAwareScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
            bottomOffset={20}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
              <View style={styles.handle} />
              <Text style={typography.h2}>Connect {showAdd === "gdrive" ? "Google Drive" : "Dropbox"}</Text>
              <Text style={[typography.bodySm, { color: colors.textSecondary, marginBottom: spacing.md }]}>
                Paste an access token from your provider.
              </Text>
              <Text style={typography.label}>ACCOUNT LABEL</Text>
              <TextInput
                testID="input-label"
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder={showAdd === "gdrive" ? "Personal Drive" : "Work Dropbox"}
                placeholderTextColor="#9CA3AF"
              />
              <Text style={typography.label}>ACCESS TOKEN</Text>
              <TextInput
                testID="input-token"
                style={[styles.input, { minHeight: 80 }]}
                value={token}
                onChangeText={setToken}
                placeholder="Paste token here"
                placeholderTextColor="#9CA3AF"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
              />
              {err && <Text style={{ color: colors.destructive, marginTop: 6 }}>{err}</Text>}
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.lg }}>
                <TouchableOpacity testID="btn-cancel-add" style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => { setShowAdd(null); setErr(null); setToken(""); setLabel(""); }}>
                  <Text style={styles.secondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="btn-confirm-add" style={[styles.primaryBtn, { flex: 1 }]} onPress={submit} disabled={connecting}>
                  {connecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Connect</Text>}
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
  headerTitle: { ...typography.h3, color: colors.textPrimary },

  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, alignItems: "center", borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  sourceCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  addCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md, borderWidth: 1, borderColor: "rgba(0,0,0,0.04)" },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sourceTitle: { ...typography.h3, fontSize: 16 },
  sourceMeta: { ...typography.bodySm, color: colors.textSecondary },
  disconnectBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FFF1F0", alignItems: "center", justifyContent: "center" },

  infoCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: "#EEF2FF", padding: spacing.md, borderRadius: 16, marginTop: spacing.md },
  infoText: { ...typography.bodySm, color: "#1E3A8A", flex: 1, lineHeight: 18 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.lg, gap: 8 },
  handle: { width: 40, height: 4, backgroundColor: "#E5E5E5", borderRadius: 2, alignSelf: "center", marginBottom: spacing.md },
  input: { backgroundColor: colors.surfaceHover, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.textPrimary, marginTop: 6, marginBottom: spacing.sm },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.button, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { backgroundColor: colors.surfaceHover, borderRadius: radius.button, paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: colors.textPrimary, fontWeight: "700", fontSize: 15 },
});
