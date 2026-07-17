import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth-context";
import { colors, typography, spacing, radius, brand, shadow } from "@/src/theme";

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
      <View style={styles.cosmicBg1} />
      <View style={styles.cosmicBg2} />

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandWrap}>
          <Image source={brand.ravenSharpLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandName}>RAVEN<Text style={{ color: colors.primary }}>SHARP</Text></Text>
          <Text style={styles.tagline}>{brand.tagline}</Text>
        </View>

        <View style={[styles.card, shadow.card]}>
          <Text style={styles.h1} testID="signup-title">Create account</Text>
          <Text style={styles.sub}>Free forever for personal scans.</Text>

          <Text style={styles.label}>FULL NAME</Text>
          <TextInput
            testID="input-name"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            testID="input-email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
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
            placeholderTextColor={colors.textMuted}
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
        </View>

        <Text style={styles.footer}>{brand.group}</Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cosmicBg1: { position: "absolute", top: -120, left: -80, width: 360, height: 360, borderRadius: 180, backgroundColor: colors.violet, opacity: 0.18 },
  cosmicBg2: { position: "absolute", top: 200, right: -100, width: 320, height: 320, borderRadius: 160, backgroundColor: colors.primary, opacity: 0.15 },

  scroll: { paddingHorizontal: spacing.lg, alignItems: "stretch" },

  brandWrap: { alignItems: "center", marginBottom: spacing.lg, gap: 6 },
  logo: { width: 110, height: 110 },
  brandName: { fontSize: 26, fontWeight: "900", color: colors.textPrimary, letterSpacing: 4, marginTop: 2 },
  tagline: { ...typography.bodySm, color: colors.textSecondary, letterSpacing: 1 },

  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  h1: { ...typography.h2, color: colors.textPrimary, marginBottom: 4 },
  sub: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  label: { ...typography.label, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
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
    ...shadow.glow,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  error: { color: colors.destructive, marginTop: spacing.sm, ...typography.bodyMd },
  linkText: { color: colors.textSecondary, fontSize: 14 },
  footer: { ...typography.label, fontSize: 10, color: colors.textMuted, textAlign: "center", marginTop: spacing.xl, letterSpacing: 2 },
});
