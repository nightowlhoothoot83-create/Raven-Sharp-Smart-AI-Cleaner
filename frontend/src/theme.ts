/**
 * RavenSharp / Ascension Digital Group Brand System
 * Dark cosmic premium theme — black + electric blue + violet + gold accents.
 */
export const colors = {
  // Base
  background: "#05050D",         // near-black space
  surface: "#0E0E1F",             // card bg
  surfaceElevated: "#171732",     // elevated card
  surfaceHover: "#1D1D3A",
  border: "#23234D",
  borderSubtle: "#16162E",

  // Brand
  primary: "#7c5cbf",             // Raven Sharp purple — matches Image Optimiser/POD/Book Creator/Content Creator/Ad Manager
  primaryGlow: "#a78bfa",
  cyan: "#00D9FF",
  violet: "#7B3FF2",
  violetSoft: "#9D4EDD",
  gold: "#FFC857",
  goldDeep: "#F4B41A",
  raven: "#0A0A1F",
  ascensionPurple: "#5B2D8C",

  // Status
  success: "#34D399",
  destructive: "#FF4D6D",
  destructiveSoft: "#3D0F1C",
  warn: "#FFC857",
  warnSoft: "#2B2410",
  ai: "#9D4EDD",
  aiSoft: "#1F1233",

  // Text
  textPrimary: "#F4F4FF",
  textSecondary: "#9BA3D9",
  textMuted: "#6066A6",

  // Legacy aliases (kept for fewer downstream changes)
  amberBg: "#2B2410",
  redBg: "#3D0F1C",
};

export const radius = {
  card: 20,
  button: 999,
  sheet: 28,
  preview: 14,
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
  h1: { fontSize: 34, fontWeight: "900" as const, letterSpacing: -0.8, lineHeight: 40, color: colors.textPrimary },
  h2: { fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.4, lineHeight: 30, color: colors.textPrimary },
  h3: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2, lineHeight: 26, color: colors.textPrimary },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24, color: colors.textPrimary },
  bodyMd: { fontSize: 14, fontWeight: "500" as const, lineHeight: 22, color: colors.textPrimary },
  bodySm: { fontSize: 13, fontWeight: "400" as const, lineHeight: 20, color: colors.textPrimary },
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 2.2,
    textTransform: "uppercase" as const,
    color: colors.textSecondary,
  },
  mono: { fontSize: 12, lineHeight: 16, color: colors.textMuted, fontVariant: ["tabular-nums" as const] },
};

export const brand = {
  ravenSharpLogo: require("../assets/images/ravenSharpLogo.png"),  // now bundled locally — was pointing at Emergent's own asset CDN (customer-assets.emergentagent.com), a real reliability risk if that ever goes away
  ascensionLogo: "https://customer-assets.emergentagent.com/job_file-unifier-8/artifacts/hhf9rjxw_file_00000000154871f8b0ad91c463eb38d9.png",  // TODO: same risk — bundle locally once you have this file
  portfolio: "https://customer-assets.emergentagent.com/job_file-unifier-8/artifacts/cjmcdzid_file_0000000060c87207adeb8b66396e89e6.png",  // TODO: same risk — bundle locally once you have this file
  tagline: "Cyber Intelligence. Digital Protection.",
  group: "Part of the Ascension Digital Group",
  groupTagline: "One Vision. Endless Possibilities.",
};

export const images = {
  auth: brand.ravenSharpLogo,
  emptyClean: brand.ravenSharpLogo,
  storage: brand.portfolio,
};

export type BrandItem = {
  name: string;
  desc: string;
  url: string;
  status: "live" | "soon";
  icon: keyof typeof import("@expo/vector-icons/Ionicons").glyphMap;
  accent: string;
  category: string;
};

export const brandFamily: BrandItem[] = [
  { name: "Ascension Digital Group", desc: "The parent umbrella for all brands", url: "https://ascensiondigitalgroup.com", status: "live", icon: "eye", accent: "#7B3FF2", category: "Parent" },
  { name: "MyCalcTools", desc: "38 calculators across 7 categories", url: "https://mycalctools.net", status: "live", icon: "calculator", accent: "#2F7FFF", category: "Utilities" },
  { name: "MyCalendarTools", desc: "Date, countdown & holiday tools", url: "https://mycalendartools.net", status: "live", icon: "calendar", accent: "#9D4EDD", category: "Utilities" },
  { name: "WheelNamePicker", desc: "Spinning decision wheel, multi-mode", url: "https://wheelnamepicker.com.au", status: "live", icon: "disc", accent: "#FFC857", category: "Utilities" },
  { name: "RavenSharp Image Optimiser", desc: "AI image optimisation & upscaling SaaS", url: "https://ravensharp.com.au", status: "soon", icon: "image", accent: "#00D9FF", category: "RavenSharp" },
  { name: "RavenSharp POD Suite", desc: "Print-on-demand pipeline across 9 platforms", url: "https://ravensharp.com.au", status: "soon", icon: "git-network", accent: "#7B3FF2", category: "RavenSharp" },
  { name: "Mystical Moments", desc: "Nature & owl photography prints", url: "https://mysticalmoments.pages.dev", status: "live", icon: "moon", accent: "#9D4EDD", category: "Creative" },
  { name: "Zyia Creations", desc: "Cosmic art, sacred geometry, POD", url: "https://zyiacreations.etsy.com", status: "live", icon: "sparkles", accent: "#FF6B9D", category: "Creative" },
  { name: "Spew Crew Kids", desc: "Kids characters teaching emotional regulation", url: "https://youtube.com/@spewcrewkids", status: "live", icon: "happy", accent: "#34D399", category: "Content" },
  { name: "Feed the Feed", desc: "Dystopian social commentary brand", url: "https://ascensiondigitalgroup.com", status: "soon", icon: "flame", accent: "#FF4D6D", category: "Content" },
];

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 4,
  },
  glow: {
    shadowColor: "#7c5cbf",
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 20,
    elevation: 6,
  },
  destructive: {
    shadowColor: "#FF4D6D",
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    elevation: 4,
  },
  sheet: {
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: -10 },
    shadowRadius: 40,
    elevation: 8,
  },
};
