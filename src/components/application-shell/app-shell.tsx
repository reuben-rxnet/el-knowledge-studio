"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3, Bell, BookOpen, CheckCircle2, CircleHelp, Clock3, FileText, Folder, Globe2, Home, LayoutTemplate, Menu,
  MessageSquare, Network, Palette, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Upload, Users, Video, Disc,
} from "lucide-react";
import { signInAsPersona, signOut, switchWorkspace } from "@/server/actions/auth";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { ToastProvider } from "@/components/common/toast";

export type NavKey = "home" | "create" | "mine" | "library" | "hub" | "reviews" | "translations" | "publishing" | "analytics" | "templates" | "brand" | "admin" | "help" | "feedback" | "audit" | "settings";

const NAV: { key: NavKey; href: string; label: string; icon: typeof Home }[] = [
  { key: "home", href: "/", label: "Home", icon: Home },
  { key: "create", href: "/create", label: "Create", icon: Plus },
  { key: "mine", href: "/projects?scope=mine", label: "My Content", icon: Folder },
  { key: "library", href: "/projects", label: "Team Library", icon: Users },
  { key: "hub", href: "/knowledge", label: "Knowledge Hub", icon: Network },
  { key: "reviews", href: "/reviews", label: "Reviews", icon: CheckCircle2 },
  { key: "translations", href: "/translations", label: "Translations", icon: Globe2 },
  { key: "publishing", href: "/publishing", label: "Publishing", icon: Send },
  { key: "analytics", href: "/analytics", label: "Analytics", icon: BarChart3 },
  { key: "templates", href: "/templates", label: "Templates", icon: LayoutTemplate },
  { key: "brand", href: "/brand", label: "Brand Center", icon: Palette },
  { key: "admin", href: "/admin", label: "Administration", icon: ShieldCheck },
];
const NAV_LOW: typeof NAV = [
  { key: "help", href: "/help", label: "Help and Learning", icon: CircleHelp },
  { key: "feedback", href: "/feedback", label: "Feedback", icon: MessageSquare },
  { key: "audit", href: "/audit", label: "Audit history", icon: Clock3 },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings },
];

const CREATE_ITEMS = [
  { href: "/create/record", icon: Disc, label: "Record screen", hint: "Capture a tab, window or screen" },
  { href: "/create/upload?kind=video", icon: Video, label: "Upload video", hint: "MP4, MOV, WEBM" },
  { href: "/create/upload?kind=document", icon: FileText, label: "Upload document", hint: "DOCX or PDF" },
  { href: "/create/upload?kind=presentation", icon: Upload, label: "Import presentation", hint: "PPTX" },
  { href: "/templates", icon: LayoutTemplate, label: "Create from template", hint: "Governed templates" },
  { href: "/create/upload?kind=meeting", icon: Users, label: "Import approved Teams recording", hint: "With participant consent" },
  { href: "/create/wizard?source=document", icon: BookOpen, label: "Create knowledge article manually", hint: "Start from a blank article" },
];

function isActive(pathname: string, item: (typeof NAV)[number], search: string) {
  if (item.href === "/") return pathname === "/";
  if (item.key === "mine") return pathname === "/projects" && search.includes("scope=mine");
  if (item.key === "library") return (pathname === "/projects" && !search.includes("scope=mine")) || pathname.startsWith("/projects/");
  return pathname.startsWith(item.href);
}

interface Props {
  children: React.ReactNode;
  user: { name: string; initials: string; email: string; title: string };
  roles: string[];
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string }[];
  hidden: NavKey[];
  canCreate: boolean;
  reviewCount: number;
  notifications: { id: string; title: string; body: string; href: string; unread: boolean; at: string }[];
  jobs: { id: string; projectId: string; title: string }[];
  personas: { email: string; name: string; label: string }[];
  aiLabel: string;
  liveConnectors: string[];
}

export function AppShell(props: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [open, setOpen] = useState<null | "create" | "notif" | "jobs">(null);
  const wsForm = useRef<HTMLFormElement>(null);
  const personaForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); router.push("/knowledge"); }
      if (e.key === "Escape") setOpen(null);
    };
    const onClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".menu,.panel,[data-popover]")) setOpen(null); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [router]);

  const unread = props.notifications.filter((n) => n.unread).length;
  const navItem = (item: (typeof NAV)[number]) => props.hidden.includes(item.key) ? null : (
    <li key={item.key}>
      <Link href={item.href} aria-current={isActive(pathname, item, search) ? "page" : undefined} title={item.label} onClick={() => setDrawer(false)}>
        <item.icon size={18} aria-hidden /><span className="lbl">{item.label}</span>
        {item.key === "reviews" && props.reviewCount > 0 && <span className="cnt" aria-label={`${props.reviewCount} assigned`}>{props.reviewCount}</span>}
      </Link>
    </li>
  );

  return (
    <ToastProvider>
      <a className="skip" href="#content">Skip to main content</a>
      <div className={`app${collapsed ? " collapsed" : ""}${drawer ? " drawer" : ""}`}>
        <nav className="nav" aria-label="Primary">
          {/* PLACEHOLDER PRODUCT MARK: replace with an approved EssilorLuxottica corporate asset before release. */}
          <Link href="/" className="mark" aria-label="EL Knowledge Studio home"><span className="lens" aria-hidden /><b>EL</b><span>| Knowledge Studio</span></Link>
          <ul className="navlist">{NAV.map(navItem)}</ul>
          <div className="grow" />
          <div className="navsep" />
          <ul className="navlist">{NAV_LOW.map(navItem)}</ul>
          <div className="demo-note">AI: {props.aiLabel}. {props.liveConnectors.length ? `Publishing connectors are simulated, except ${props.liveConnectors.join(", ")}.` : "Publishing connectors are simulated."}</div>
        </nav>
        {drawer && <div className="backdrop" style={{ zIndex: 45 }} onClick={() => setDrawer(false)} aria-hidden />}
        <div className="main">
          <header className="top">
            <button className="iconbtn" aria-label="Toggle navigation" aria-expanded={!collapsed}
              onClick={() => (window.matchMedia("(max-width:820px)").matches ? setDrawer((d) => !d) : setCollapsed((c) => !c))}>
              <Menu size={18} aria-hidden />
            </button>
            <form ref={wsForm} action={switchWorkspace} className="ws">
              <span className="wslabel meta">Workspace</span>
              <select name="workspaceId" aria-label="Current workspace" defaultValue={props.workspace.id} onChange={() => wsForm.current?.requestSubmit()}>
                {props.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </form>
            <div className="spacer" />
            <Link href="/knowledge" className="searchtrig"><Search size={16} aria-hidden />Search knowledge<kbd>/</kbd></Link>

            {props.canCreate && (
              <div style={{ position: "relative" }} data-popover>
                <button className="btn primary" aria-haspopup="menu" aria-expanded={open === "create"} onClick={() => setOpen(open === "create" ? null : "create")}>
                  <Plus size={16} aria-hidden />Create
                </button>
                {open === "create" && (
                  <div className="menu" role="menu">
                    {CREATE_ITEMS.map((c) => (
                      <Link key={c.label} role="menuitem" href={c.href} className="menuitem" onClick={() => setOpen(null)}>
                        <c.icon size={18} aria-hidden /><span><b>{c.label}</b><small>{c.hint}</small></span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ position: "relative" }} data-popover>
              <button className="iconbtn" aria-label={`Processing jobs, ${props.jobs.length} running`} onClick={() => setOpen(open === "jobs" ? null : "jobs")}>
                <RefreshCw size={18} aria-hidden />{props.jobs.length > 0 && <span className="dot">{props.jobs.length}</span>}
              </button>
              {open === "jobs" && (
                <div className="panel">
                  <div className="pad"><b>Processing jobs</b></div>
                  {props.jobs.length ? (
                    <ul className="list">{props.jobs.map((j) => <li key={j.id}><Link className="link" href={`/projects/${j.projectId}/processing`}>{j.title}</Link></li>)}</ul>
                  ) : <p className="meta pad" style={{ margin: 0 }}>No jobs running. Jobs appear here when you create content.</p>}
                </div>
              )}
            </div>

            <div style={{ position: "relative" }} data-popover>
              <button className="iconbtn" aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen(open === "notif" ? null : "notif")}>
                <Bell size={18} aria-hidden />{unread > 0 && <span className="dot">{unread}</span>}
              </button>
              {open === "notif" && (
                <div className="panel">
                  <div className="pad"><b>Notifications</b></div>
                  {props.notifications.length ? (
                    <ul className="list">
                      {props.notifications.map((n) => (
                        <li key={n.id} style={{ alignItems: "flex-start" }}>
                          <Link href={n.href} onClick={() => setOpen(null)}>
                            <span className="t" style={{ display: "block" }}>{n.unread ? "● " : ""}{n.title}</span>
                            <span className="meta" style={{ display: "block", fontSize: 13 }}>{n.body}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="meta pad" style={{ margin: 0 }}>You&apos;re all caught up. Review requests, mentions and finished jobs appear here.</p>}
                </div>
              )}
            </div>

            {props.personas.length > 0 ? (
              <form ref={personaForm} action={signInAsPersona} className="persona" title="Demo persona switcher (development only)">
                <span className="avatar" aria-hidden>{props.user.initials}</span>
                <input type="hidden" name="next" value={pathname} />
                <select name="email" aria-label="Demo persona" defaultValue={props.user.email} onChange={() => personaForm.current?.requestSubmit()} data-testid="persona-switcher">
                  {props.personas.map((p) => <option key={p.email} value={p.email}>{p.name} · {p.label}</option>)}
                </select>
              </form>
            ) : (
              <span className="persona"><span className="avatar" aria-hidden>{props.user.initials}</span><span className="pname">{props.user.name}</span></span>
            )}
            <form action={signOut}><button className="btn sm ghost" type="submit">Sign out</button></form>
          </header>
          <main className="content" id="content" tabIndex={-1} data-roles={props.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ")}>
            {props.children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
