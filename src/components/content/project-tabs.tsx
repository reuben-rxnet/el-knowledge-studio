"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [["", "Overview"], ["video", "Video"], ["guide", "Guide"], ["knowledge", "Knowledge"], ["translations", "Translations"], ["review", "Review"], ["publishing", "Publishing"], ["activity", "Activity"]];

export function ProjectTabs({ projectId, openComments, studio = false }: { projectId: string; openComments: number; studio?: boolean }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  // Studio (beta) sits right after Video while the feature flag is on.
  const tabs: [string, string][] = studio ? [TABS[0]!, TABS[1]!, ["studio", "Studio (beta)"], ...TABS.slice(2)] : TABS;
  return (
    <nav className="tabs" aria-label="Project sections">
      {tabs.map(([k, l]) => {
        const href = k ? `${base}/${k}` : base;
        const active = k ? path.startsWith(href) : path === base;
        return (
          <Link key={l} href={href} aria-current={active ? "page" : undefined} className={active ? "tab-on" : undefined}>
            {l}{k === "review" && openComments > 0 && <span className="pill s-warn" style={{ padding: "0 6px", marginLeft: 6 }}>{openComments}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
