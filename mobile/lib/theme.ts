// Shared design tokens — mirrors the web app's dark, mystical gold theme.
export const colors = {
  base: "#0b0a14", // app background
  panel: "#151320", // card / panel background (solid; web uses 60% alpha over base)
  panelAlt: "#1b1827", // slightly raised
  line: "#2a2740", // borders / dividers
  ink: "#ece9f5", // primary text
  muted: "#9a93b8", // secondary text
  gold: "#d8b25a", // primary accent (headings, highlights)
  goldDim: "#b9923f", // gold pressed / secondary
  accent: "#8b7bd8", // violet accent (labels, neutral state)
  danger: "#f87171", // destructive
  dangerDim: "rgba(248,113,113,0.7)",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const font = {
  // Headings render in heavy Space Grotesk; the `serif` key is kept so existing
  // heading usages pick up the display face automatically.
  serif: "SpaceGrotesk_700Bold" as const,
  // Explicit font-family tokens — Space Grotesk for display, Inter for body.
  family: {
    display: "SpaceGrotesk_700Bold",
    displayMedium: "SpaceGrotesk_500Medium",
    body: "Inter_400Regular",
    bodyMedium: "Inter_500Medium",
    bodySemibold: "Inter_600SemiBold",
  },
  sizes: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 30 },
};

// Convenience text colors for felt-state sentiment (matches Trends on web).
export const sentiment = {
  positive: colors.gold,
  neutral: colors.accent,
  negative: colors.danger,
} as const;
