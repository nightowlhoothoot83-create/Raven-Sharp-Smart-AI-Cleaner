import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ImageBackground, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth-context";
import { colors, typography, spacing, radius, images, shadow } from "@/src/theme";

export default function Signup() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email.trim() || password.length < 6) {
      setErr("Email required, password min 6 characters");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
      router.replace("/(app)/dashboard");
    } catch (e: any) {
      setErr(e.message || "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ImageBackground source={{ uri: images.auth }} style={styles.bg} resizeMode="cover">
        <View style={[styles.heroOverlay, { paddingTop: insets.top + spacing.xl }]}>
          <Text style={styles.brandLabel}>SMART FILE SCAN</Text>
          <Text style={styles.brandTitle}>Get started{"\n"}in 60 seconds.</Text>
        </View>
      </ImageBackground>

      <KeyboardAwareScrollView
        style={styles.sheetWrap}
        contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.handle} />
        <Text style={styles.h1} testID="signup-title">Create account</Text>
        <Text style={styles.sub}>Free forever for personal scans.</Text>

        <Text style={styles.label}>FULL NAME</Text>
        <TextInput
          testID="input-name"
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Jane Doe"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="words"
        />

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
          placeholder="At least 6 characters"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
        />

        {err && (
          <Text testID="signup-error" style={styles.error}>
            {err}
          </Text>
        )}

        <TouchableOpacity
          testID="btn-signup"
          style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={submit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>Create account</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity testID="link-login" onPress={() => router.back()} style={{ marginTop: spacing.lg, alignSelf: "center" }}>
          <Text style={styles.linkText}>
            Already have an account? <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { height: 220 },
  heroOverlay: { paddingHorizontal: spacing.lg, gap: 6 },
  brandLabel: { ...typography.label, color: "#FFFFFFCC" },
  brandTitle: { fontSize: 30, fontWeight: "900", color: "#fff", letterSpacing: -0.8, lineHeight: 36, marginTop: 4 },

  sheetWrap: { flex: 1, marginTop: -28 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    ...shadow.sheet,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E5E5", alignSelf: "center", marginBottom: spacing.md },
  h1: { ...typography.h1, color: colors.textPrimary },
  sub: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  label: { ...typography.label, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
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
