/**
 * Design tokens from /app/design_guidelines.json
 * Mapped to StyleSheet-friendly values.
 */
export const colors = {
  background: "#FAFAFA",
  surface: "#FFFFFF",
  textPrimary: "#0A0A0A",
  textSecondary: "#666666",
  primary: "#0052FF", // cobalt
  destructive: "#FF3B30",
  ai: "#FF9F0A",
  success: "#34C759",
  border: "#E5E5E5",
  surfaceHover: "#F4F4F5",
  amberBg: "#FFF9EC",
  redBg: "#FFF1F0",
};

export const radius = {
  card: 24,
  button: 999,
  sheet: 32,
  preview: 16,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const typography = {
  h1: { fontSize: 34, fontWeight: "900" as const, letterSpacing: -0.8, lineHeight: 40 },
  h2: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.4, lineHeight: 30 },
  h3: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  bodyMd: { fontSize: 14, fontWeight: "500" as const, lineHeight: 22 },
  bodySm: { fontSize: 13, fontWeight: "400" as const, lineHeight: 20 },
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 2.2,
    textTransform: "uppercase" as const,
    color: "#666666",
  },
  mono: { fontSize: 12, lineHeight: 16, color: "#666", fontVariant: ["tabular-nums" as const] },
};

export const images = {
  auth: "https://static.prod-images.emergentagent.com/jobs/72bca499-1276-43a4-8281-13fffeff925b/images/fa0d59f128e2ff6e8ec1d51648cda1c5596b617d555e9d5c36b1cbf0e9aef3ce.png",
  emptyClean: "https://static.prod-images.emergentagent.com/jobs/72bca499-1276-43a4-8281-13fffeff925b/images/8a477f531820bfd24d1cbdc779f392fb8cbc446c4b441c387352e61ba11dad3b.png",
  storage: "https://static.prod-images.emergentagent.com/jobs/72bca499-1276-43a4-8281-13fffeff925b/images/387d3c0e295fac5f5f910628664b88bd7ef90dcdcd69ef7067c9b1a65682d824.png",
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 30,
    elevation: 2,
  },
  destructive: {
    shadowColor: "#FF3B30",
    shadowOpacity: 0.39,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    elevation: 4,
  },
  sheet: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: -10 },
    shadowRadius: 40,
    elevation: 8,
  },
};
