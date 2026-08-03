import { Lock } from "lucide-react";
import { PageHead } from "./PageHead";
import { EmptyState } from "./EmptyState";

/** Full-page fallback for a view whose data is every past query across the
 *  tool — reserved for the admin. Shown even if a stale nav link reaches
 *  here, since the API routes underneath also enforce this. */
export function AdminOnlyView({ title }: { title: string }) {
  return (
    <div>
      <PageHead title={title} />
      <EmptyState
        icon={<Lock className="size-5" aria-hidden />}
        title="Admin access required"
        description="Contact the admin of this website for access to this information."
      />
    </div>
  );
}
