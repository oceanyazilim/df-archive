import { AnalysisStage, type StageState } from "../analyzer/AnalysisStage";

export interface LoaderStage {
  label: string;
  state: StageState;
}

/** Reuses the existing done/active/pending stage visual language (app/components/analyzer/AnalysisStage.tsx) rather than inventing a second one. */
export function LoaderStageList({ stages, className }: { stages: LoaderStage[]; className?: string }) {
  if (!stages.length) return null;
  return (
    <div className={className}>
      <ol className="space-y-1.5">
        {stages.map((s) => (
          <li key={s.label}>
            <AnalysisStage label={s.label} state={s.state} />
          </li>
        ))}
      </ol>
    </div>
  );
}
