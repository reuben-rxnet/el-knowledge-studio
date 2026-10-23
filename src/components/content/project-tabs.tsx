"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [["", "Overview"], ["video", "Video"], ["guide", "Guide"], ["knowledge", "Knowledge"], ["translations", "Translations"], ["review", "Review"], ["publishing", "Publishing"], ["activity", "Activity"]];

export function ProjectTabs({ projectId, openComments }: { projectId: string; openComments: number }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  return (
    <nav className="tabs" aria-label="Project sections">
      {TABS.map(([k, l]) => {
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
