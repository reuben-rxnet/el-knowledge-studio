import Link from "next/link";

export function PageHeader({ title, subtitle, crumbs, eyebrow, actions }: {
  title: string; subtitle?: React.ReactNode; eyebrow?: string; crumbs?: { label: string; href?: string }[]; actions?: React.ReactNode;
}) {
  return (
    <div className="row between" style={{ alignItems: "flex-end" }}>
      <div style={{ minWidth: 0 }}>
        {crumbs && (
          <nav aria-label="Breadcrumb" className="crumbs-nav" style={{ marginBottom: 6 }}>
            <ol>{crumbs.map((c, i) => <li key={i}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>)}</ol>
          </nav>
        )}
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
