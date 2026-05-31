import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ImageBackground, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth-context";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email.trim() || !password) {
      setErr("Email and password are required");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(app)/dashboard");
    } catch (e: any) {
      setErr(e.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ImageBackground source={{ uri: images.auth }} style={styles.bg} resizeMode="cover">
        <View style={[styles.heroOverlay, { paddingTop: insets.top + spacing.xl }]}>
          <Text style={styles.brandLabel}>SMART FILE SCAN</Text>
          <Text style={styles.brandTitle}>One library.{"\n"}Zero clutter.</Text>
        </View>
      </ImageBackground>

      <KeyboardAwareScrollView
        style={styles.sheetWrap}
        contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.handle} />
        <Text style={styles.h1} testID="login-title">Welcome back</Text>
        <Text style={styles.sub}>Sign in to continue managing your files.</Text>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          testID="input-email"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#9CA3AF"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          testID="input-password"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
        />

        {err && (
          <Text testID="login-error" style={styles.error}>
            {err}
          </Text>
        )}

        <TouchableOpacity
          testID="btn-login"
          style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>Sign in</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity testID="link-signup" onPress={() => router.push("/(auth)/signup")} style={{ marginTop: spacing.lg, alignSelf: "center" }}>
          <Text style={styles.linkText}>
            New here? <Text style={{ color: colors.primary, fontWeight: "700" }}>Create an account</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { height: 260, justifyContent: "flex-start" },
  heroOverlay: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: 6 },
  brandLabel: { ...typography.label, color: "#FFFFFFCC" },
  brandTitle: { fontSize: 32, fontWeight: "900", color: "#fff", letterSpacing: -0.8, lineHeight: 38, marginTop: 4 },

  sheetWrap: { flex: 1, marginTop: -28 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    ...shadow.sheet,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", alignSelf: "center", marginBottom: spacing.md },
  h1: { ...typography.h1, color: colors.textPrimary },
  sub: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  label: { ...typography.label, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: "transparent",
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: 16,
    marginTop: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  error: { color: colors.destructive, marginTop: spacing.sm, ...typography.bodyMd },
  linkText: { color: colors.textSecondary, fontSize: 14 },
});
