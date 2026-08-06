/** Shared Recharts theming so every chart in the app reads as one system. */

export const CHART_COLORS = ["#9CF04A", "#4C8F1C", "#A98BFF", "#4ADE80", "#F5B94C", "#FF6B7E"];

export const chartGrid = { stroke: "rgba(255,255,255,0.07)", vertical: false };
export const chartAxis = {
  stroke: "rgba(255,255,255,0.07)",
  tick: { fill: "#626C7A", fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

export const tooltipContentStyle = {
  background: "#151B23",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "#F4F7FB",
  boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
};
export const tooltipLabelStyle = { color: "#919AAA", marginBottom: 4, fontSize: 11 };
export const tooltipItemStyle = { color: "#F4F7FB" };
