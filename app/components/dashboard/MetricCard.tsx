import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { StatCard, type StatTone } from "../shared/StatCard";
import { staggerItem } from "../../lib/motion";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
}

/** Dashboard KPI tile — animates in as part of the post-analysis stagger reveal. */
export function MetricCard(props: MetricCardProps) {
  return (
    <motion.div variants={staggerItem}>
      <StatCard {...props} />
    </motion.div>
  );
}
