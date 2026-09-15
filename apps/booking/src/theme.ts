import { StyleSheet } from "react-native";

export const colors = {
  bg: "#f4f5f7",
  card: "#ffffff",
  primary: "#1e3a8a",
  primaryText: "#ffffff",
  accent: "#0d9488",
  text: "#1f2937",
  muted: "#6b7280",
  border: "#e5e7eb",
  danger: "#c0392b",
  locked: "#eef2ff",
  warn: "#b45309",
  warnBg: "#fef3c7",
};

export function statusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case "PLACED":
      return { bg: "#dbeafe", fg: "#1e40af" };
    case "PREPARING":
      return { bg: "#fef3c7", fg: "#b45309" };
    case "DISPATCHED":
      return { bg: "#e0e7ff", fg: "#4338ca" };
    case "DELIVERED":
      return { bg: "#dcfce7", fg: "#15803d" };
    case "CLOSED":
      return { bg: "#e5e7eb", fg: "#374151" };
    default:
      return { bg: "#e5e7eb", fg: "#374151" };
  }
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, paddingBottom: 40 },
  // app header bar
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { color: "#fff", fontWeight: "800", fontSize: 18, letterSpacing: 0.2 },
  brandSub: { color: "#c7d2fe", fontSize: 12, marginTop: 2 },
  headerAction: { color: "#dbeafe", fontWeight: "700", fontSize: 14 },
  shadow: {
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  h1: { fontSize: 24, fontWeight: "800", color: colors.text, marginBottom: 2 },
  h2: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 18, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  label: { fontSize: 12, color: colors.muted, marginBottom: 6, fontWeight: "700", letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    backgroundColor: "#fff",
    color: colors.text,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 10,
  },
  btnText: { color: colors.primaryText, fontWeight: "800", fontSize: 16 },
  btnGhost: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  btnGhostText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  // big selectable option card (meal type, menu choice)
  option: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  optionActive: { borderColor: colors.primary, backgroundColor: "#f5f7ff" },
  optionTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  optionSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  error: { color: colors.danger, marginTop: 10 },
  ok: { color: colors.accent, marginTop: 10, fontWeight: "700" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
