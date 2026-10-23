import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon size={24} aria-hidden /></div>
      <h3 className="card-h">{title}</h3>
      <p style={{ margin: 0, maxWidth: "48ch" }}>{children}</p>
      {action}
    </div>
  );
}
