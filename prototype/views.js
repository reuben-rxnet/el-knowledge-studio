/* Helpers + Home, Create, Wizard, Record, Upload, Processing, Library views */
const ICONS = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  hub: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="12" cy="21" r="1.6"/><path d="m6 7 4 3.5M18 7l-4 3.5M12 15v4.4"/>',
  check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18"/>',
  send: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  brand: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  rec: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  tpl: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 13v8M13 17h8"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (key) => { const [l, t] = STATUS[key] || [key, "neutral"]; return `<span class="pill s-${t}">${l}</span>`; };
const tonePill = (label, tone) => `<span class="pill s-${tone}">${esc(label)}</span>`;
const cls = (c) => `<span class="cls ${c === "Confidential" ? "c-conf" : c === "Highly Confidential" || c === "Restricted" ? "c-hc" : ""}">${ic("lock", 11)} ${esc(c)}</span>`;
const aiTag = (t = "AI generated") => `<span class="ai-label">${ic("sparkle", 12)} ${t}</span>`;
const mockTag = (t = "Simulated") => `<span class="mock-label">${t}</span>`;
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const rel = (days) => { if (days < 0.04) return "just now"; if (days < 1) return Math.round(days * 24) + " h ago"; if (days < 2) return "yesterday"; if (days < 30) return Math.round(days) + " days ago"; return Math.round(days / 30) + " months ago"; };
const dateFmt = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const freshness = (p) => { if (p.status === "archived") return ["Archived", "neutral"]; if (p.review < -60) return ["Expired", "err"]; if (p.review < 0) return ["Review overdue", "err"]; if (p.review < 30) return ["Review due soon", "warn"]; return ["Current", "ok"]; };
const proj = (id) => S.projects.find((p) => p.id === id);
const thumb = (p, w = 64) => `<span class="thumb" style="width:${w}px;height:${Math.round(w * 0.62)}px;background:linear-gradient(135deg,hsl(${p.hue} 70% 22%),hsl(${p.hue + 10} 85% 42%))" aria-hidden="true"></span>`;
const empty = (icon, title, body, action) => `<div class="empty"><div class="ico">${ic(icon, 24)}</div><div class="card-h">${title}</div><p style="margin:0;max-width:48ch">${body}</p>${action || ""}</div>`;

const NAV = [
  ["home", "Home", "home"], ["create", "Create", "plus"], ["mine", "My Content", "folder"], ["library", "Team Library", "users"],
  ["hub", "Knowledge Hub", "hub"], ["reviews", "Reviews", "check"], ["translations", "Translations", "globe"], ["publishing", "Publishing", "send"],
  ["analytics", "Analytics", "chart", "analytics.view"], ["templates", "Templates", "tpl"], ["brand", "Brand Center", "brand", "brand.manage"], ["admin", "Administration", "shield", "workspace.manage"],
];
const NAV_LOW = [["help", "Help and Learning", "help"], ["feedback", "Feedback", "chat"], ["audit", "Audit history", "clock", "audit.view"], ["settings", "Settings", "cog"]];

/* ---------- HOME ---------- */
function vHome() {
  const me = S.persona;
  const myReviews = REVIEWS.filter((r) => r.assignee === me.id && r.status === "open");
  const kpis = [["Content created", "248", "+18 this month", "up"], ["Published assets", "171", "+9", "up"], ["Hours of viewing", "3,912", "+12%", "up"], ["Estimated hours saved", "1,460", "Based on reuse", ""],
    ["Translation coverage", "68%", "+6 pts", "up"], ["Content freshness", "86%", "11 items overdue", "down"], ["Approval turnaround", "2.4 days", "−0.6 days", "up"], ["Search success rate", "81%", "+3 pts", "up"]];
  const cont = S.projects.filter((p) => ["ai", "creator", "changes", "draft", "sme"].includes(p.status)).slice(0, 4);
  return `<section>
  <div class="hero">
    <div>
      <div class="tag">Capture once. Share knowledge everywhere.</div>
      <h1 style="margin-top:10px">Turn expertise into knowledge everyone can use</h1>
      <p>Record a process or upload existing content. EL Knowledge Studio creates professional videos, guides, translations, and learning materials automatically.</p>
      <div class="row"><button class="btn primary" data-go="record">${ic("rec", 16)} Start recording</button><button class="btn" data-go="upload">${ic("upload", 16)} Upload content</button><button class="btn ghost" style="color:#C8D7EA" data-go="project" data-id="p1">Explore a sample project ${ic("arrow", 16)}</button></div>
    </div>
    <div class="art" aria-hidden="true">${lensArt()}</div>
  </div>
  <div class="row between"><div><h2 class="sec-h">Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${esc(me.name.split(" ")[0])}</h2><p class="meta" style="margin:2px 0 0">${esc(S.ws)} · Signed in as ${esc(me.label)}</p></div><span class="meta">Workspace insights · last 30 days</span></div>
  <div class="grid g4">${kpis.map(([l, v, d, c]) => `<div class="card kpi"><span class="meta">${l}</span><span class="v">${v}</span><span class="d ${c}">${d}</span></div>`).join("")}</div>
  <div class="split">
    <div class="card"><div class="pad row between"><h3 class="card-h">Continue working</h3><button class="btn sm ghost" data-go="mine">View all</button></div>
      <ul class="list">${cont.map((p) => `<li class="clickable" data-go="project" data-id="${p.id}" tabindex="0">${thumb(p)}<div style="flex:1;min-width:0"><div class="t">${esc(p.title)}</div><div class="meta">${esc(p.fn)} · v${p.version} · updated ${rel(p.updated)}</div></div>${pill(p.status)}</li>`).join("")}</ul></div>
    <div class="card"><div class="pad row between"><h3 class="card-h">Review inbox</h3><span class="pill s-info">${myReviews.length} assigned to you</span></div>
      ${myReviews.length ? `<ul class="list">${myReviews.map((r) => { const p = proj(r.pid); return `<li class="clickable" data-go="project" data-id="${p.id}" data-tab="review" tabindex="0"><div style="flex:1"><div class="t">${esc(p.title)}</div><div class="meta">${r.stage} · version ${r.ver} · due ${r.due < 0 ? "overdue" : "in " + r.due + " days"}</div></div>${ic("arrow", 16)}</li>`; }).join("")}</ul>`
      : empty("check", "Nothing waiting for you", "When someone asks you to review content, it appears here with its due date and version.", "")}</div>
  </div>
  <div class="grid g3">
    <div class="card"><div class="pad"><h3 class="card-h">Processing jobs</h3></div>${S.jobs.length ? `<ul class="list">${S.jobs.map((j) => `<li class="clickable" data-go="processing" data-id="${j.pid}" tabindex="0"><div style="flex:1"><div class="t">${esc(proj(j.pid).title)}</div><div class="bar" style="margin-top:6px"><i style="width:${j.pct}%"></i></div></div><span class="meta">${j.pct}%</span></li>`).join("")}</ul>` : empty("sparkle", "No jobs running", "When you start a creation, you can follow each AI stage here.", `<button class="btn sm" data-go="create">Create content</button>`)}</div>
    <div class="card"><div class="pad"><h3 class="card-h">AI activity</h3></div><ul class="list">
      <li>${ic("sparkle", 16)}<div><div>Guide generated for <b>Product Demonstration and Sales Enablement</b></div><div class="meta">3 chapters · 3 steps · 1 sensitive region blurred · 1 h ago</div></div></li>
      <li>${ic("globe", 16)}<div><div>Italian translation ready for <b>Retail Store Opening Checklist</b></div><div class="meta">Terminology locked: Store Portal, POS · 5 h ago</div></div></li>
      <li>${ic("flag", 16)}<div><div>2 uncertain terms flagged in <b>Monthly Finance Closing Procedure</b></div><div class="meta">Waiting for a reviewer · yesterday</div></div></li></ul></div>
    <div class="card"><div class="pad"><h3 class="card-h">Trending in your workspace</h3></div><ul class="list">${[...S.projects].filter((p) => p.publishedV).sort((a, b) => b.views - a.views).slice(0, 4).map((p, i) => `<li class="clickable" data-go="project" data-id="${p.id}" tabindex="0"><span class="meta" style="width:14px">${i + 1}</span><div style="flex:1"><div class="t">${esc(p.title)}</div><div class="meta">${p.views.toLocaleString()} views · ${esc(p.fn)}</div></div></li>`).join("")}</ul></div>
  </div>
</section>`;
}

function lensArt() {
  return `<svg class="lensart" viewBox="0 0 420 240"><defs><radialGradient id="lg" cx="40%" cy="35%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="#7FDAF0" stop-opacity=".5"/><stop offset="1" stop-color="#00A6CE" stop-opacity="0"/></radialGradient><linearGradient id="beam" x1="0" x2="1"><stop offset="0" stop-color="#D6A84B" stop-opacity="0"/><stop offset=".5" stop-color="#D6A84B"/><stop offset="1" stop-color="#00A6CE"/></linearGradient></defs>
  <path d="M0 120 C80 120 120 120 168 120" stroke="url(#beam)" stroke-width="2" fill="none"/>
  <ellipse cx="210" cy="120" rx="46" ry="96" fill="url(#lg)" stroke="rgba(255,255,255,.55)" stroke-width="1.2"/>
  <ellipse cx="210" cy="120" rx="30" ry="76" fill="none" stroke="rgba(255,255,255,.18)"/>
  ${[[300, 40, "Video"], [340, 100, "Guide"], [330, 165, "FAQ"], [290, 215, "Translations"]].map(([x, y, l]) => `<path d="M252 120 C 275 120, ${x - 30} ${y}, ${x} ${y}" stroke="rgba(0,166,206,.6)" stroke-width="1.4" fill="none"/><g><rect x="${x}" y="${y - 13}" width="${l.length * 7.4 + 22}" height="26" rx="13" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.35)"/><text x="${x + 11}" y="${y + 4.5}" fill="#fff" font-size="12" font-family="Segoe UI, Arial">${l}</text></g>`).join("")}
  ${[[40, 70], [70, 170], [110, 95]].map(([x, y]) => `<rect x="${x}" y="${y}" width="40" height="26" rx="4" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.3)"/>`).join("")}
  </svg>`;
}

/* ---------- CREATE ---------- */
function vCreate() {
  const cards = [
    ["record", "rec", "Record a process", "Capture a browser tab, window or screen while you narrate. We turn it into chapters, a guide and captions.", "≈ 3 min to first draft"],
    ["upload", "video", "Upload a video", "Bring an existing MP4, MOV or WEBM, such as a Teams recording you have consent to use.", "MP4 · MOV · WEBM · MP3 · WAV"],
    ["upload", "doc", "Import documents or slides", "Turn a PDF, DOCX or PPTX procedure into structured steps, an article and a quiz.", "PDF · DOCX · PPTX · PNG · JPG"],
    ["wizard", "tpl", "Start from a template", "Pick a governed template with the right outputs, approval flow and brand for your function.", "10 enterprise templates"],
  ];
  return `<section>
  <div><h1 class="page-title">Create</h1><p class="page-sub">Choose how your knowledge starts. Every route produces AI drafts that stay drafts until a human reviews and approves them.</p></div>
  <div class="grid g2 create-cards">${cards.map(([go, icn, t, d, m], i) => `<button class="card createcard" data-go="${go}" data-src="${["recording", "video", "document", "template"][i]}">
    <span class="cc-art cc-${i}" aria-hidden="true">${ic(icn, 26)}</span><span class="cc-body"><span class="card-h">${t}</span><span class="meta" style="font-size:14px;color:var(--text-2)">${d}</span><span class="meta">${m}</span></span>${ic("arrow", 18)}</button>`).join("")}</div>
  <div class="card pad row between"><div><div class="card-h">Not sure where to start?</div><div class="meta">The guided wizard walks you through source, outputs, context and template in five steps.</div></div><button class="btn primary" data-go="wizard">Open guided wizard ${ic("arrow", 16)}</button></div>
  <div class="card pad"><div class="row" style="gap:16px">${ic("shield", 20)}<div style="flex:1;min-width:240px"><div class="card-h">What happens to your content</div><div class="meta" style="font-size:13px">Sources are scanned and stored in your workspace's data region. AI drafts are labelled, sensitive information is flagged for redaction, and nothing is published without approval.</div></div></div></div>
</section>`;
}

/* ---------- WIZARD ---------- */
const WSTEPS = ["Source", "Outputs", "Context", "Template", "Review"];
function vWizard() {
  const w = S.wiz, i = w.step;
  const head = `<ol class="stepper" aria-label="Progress">${WSTEPS.map((s, k) => `<li class="${k === i ? "on" : k < i ? "done" : ""}" ${k === i ? 'aria-current="step"' : ""}><span class="n">${k < i ? "✓" : k + 1}</span>${s}</li>`).join("")}</ol>`;
  let body = "";
  if (i === 0) body = `<h2 class="sec-h">Choose a source</h2><div class="checks" role="radiogroup">${[["recording", "Screen recording", "Browser tab, window or screen"], ["video", "Video upload", "MP4, MOV, WEBM"], ["audio", "Audio upload", "MP3 or WAV narration"], ["document", "Document", "DOCX or PDF"], ["presentation", "Presentation", "PPTX deck"], ["images", "Images", "PNG or JPG screenshots"], ["meeting", "Approved meeting recording", "Teams, with participant consent"]].map(([k, l, h]) => `<label class="check"><input type="radio" name="src" value="${k}" ${w.src === k ? "checked" : ""} data-w="src"><span>${l}<small>${h}</small></span></label>`).join("")}</div>`;
  if (i === 1) body = `<h2 class="sec-h">Select outputs</h2><p class="meta">Generated outputs are drafts and require review before publishing.</p><div class="checks">${[["video", "Polished video"], ["guide", "Step-by-step guide"], ["sop", "SOP"], ["article", "Knowledge article"], ["qrg", "Quick-reference guide"], ["faq", "FAQ"], ["training", "Training summary"], ["quiz", "Quiz"], ["subtitles", "Subtitles"], ["l10n", "Localization package"]].map(([k, l]) => `<label class="check"><input type="checkbox" value="${k}" ${w.outputs.includes(k) ? "checked" : ""} data-w="outputs"><span>${l}</span></label>`).join("")}</div>`;
  if (i === 2) {
    const f = (id, label, val, hint) => `<label class="f">${label}${hint ? `<span class="hint">${hint}</span>` : ""}<input type="text" id="w_${id}" data-wf="${id}" value="${esc(val)}"></label>`;
    const s = (id, label, opts) => `<label class="f">${label}<select class="in" id="w_${id}" data-wf="${id}">${opts.map((o) => `<option ${w[id] === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
    body = `<h2 class="sec-h">Configure context</h2><div class="grid g2">
      ${f("title", "Title *", w.title, "Name it the way people will search for it")}${f("owner", "Content owner", w.owner)}
      <label class="f" style="grid-column:1/-1">Description<textarea id="w_desc" data-wf="desc">${esc(w.desc)}</textarea></label>
      ${s("fn", "Business function", ["Retail Operations", "Finance", "Human Resources", "Manufacturing", "Sales & Marketing", "Supply Chain", "IT & Digital", "Customer Service", "Quality", "Compliance"])}
      ${f("process", "Process category", w.process)}${s("region", "Region", ["Europe", "Global", "North America", "Latin America", "Asia Pacific", "Middle East & Africa"])}${f("country", "Country", w.country)}
      ${f("system", "Source system", w.system)}${f("audience", "Intended audience", w.audience)}
      ${s("cls", "Confidentiality classification", ["Public", "Internal", "Confidential", "Highly Confidential", "Restricted"])}${f("sme", "Subject-matter expert", w.sme)}${f("approver", "Approver", w.approver)}
      ${s("lang", "Primary language", Object.values(LANGS))}${s("freq", "Review frequency", ["Every 3 months", "Every 6 months", "Every 12 months"])}
      </div>${w.cls === "Restricted" ? `<div class="callout warn" role="alert"><b>Restricted content cannot be recorded or processed by AI.</b> Choose another classification or contact your workspace administrator.</div>` : ""}
      <div><div class="f" style="margin-bottom:6px">Target languages</div><div class="row">${Object.entries(LANGS).filter(([c]) => c !== "en").map(([c, l]) => `<button class="chip" aria-pressed="${w.targets.includes(c)}" data-wt="${c}">${l}</button>`).join("")}</div></div>
      <div><div class="f" style="margin-bottom:6px">Publishing destinations</div><div class="row">${DESTS.map((d) => `<button class="chip" ${d.disabled ? "disabled title='Disabled by policy'" : ""} aria-pressed="${w.dests.includes(d.key)}" data-wd="${d.key}">${d.label}${d.disabled ? " (disabled)" : ""}</button>`).join("")}</div></div>`;
  }
  if (i === 3) body = `<h2 class="sec-h">Choose a template</h2><div class="checks">${TEMPLATES.map(([n, fn, o, a]) => `<label class="check"><input type="radio" name="tpl" value="${n}" ${w.tpl === n ? "checked" : ""} data-w="tpl"><span>${n}<small>${fn} · ${o}</small><small>Approval: ${a}</small></span></label>`).join("")}</div>`;
  if (i === 4) body = `<h2 class="sec-h">Review and create</h2><div class="tablewrap"><table><tbody>${[["Source", w.src], ["Outputs", w.outputs.join(", ")], ["Title", w.title], ["Function", w.fn + " · " + w.process], ["Region", w.region + " · " + w.country], ["Classification", w.cls], ["Owner / SME / Approver", [w.owner, w.sme, w.approver].join(" / ")], ["Languages", w.lang + " → " + w.targets.map((c) => LANGS[c]).join(", ")], ["Destinations", w.dests.map((k) => DESTS.find((d) => d.key === k).label).join(", ")], ["Template", w.tpl], ["Review frequency", w.freq]].map(([k, v]) => `<tr><th scope="row" style="width:220px">${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>
    <div class="callout ai"><b>AI processing:</b>&nbsp;Transcription, guide and translation drafts are produced by simulated providers in this prototype. Every output is labelled and must be reviewed.</div>`;
  return `<section style="max-width:980px"><div class="row between"><div><span class="eyebrow">Guided creation</span><h1 class="page-title">New knowledge project</h1></div><button class="btn ghost" data-go="create">Cancel</button></div>
  ${head}<div class="card pad" style="display:flex;flex-direction:column;gap:16px">${body}</div>
  <div class="row between"><button class="btn" data-act="wizBack" ${i === 0 ? "disabled" : ""}>${ic("back", 16)} Back</button>
  ${i < 4 ? `<button class="btn primary" data-act="wizNext">Continue ${ic("arrow", 16)}</button>` : `<button class="btn primary" data-act="wizCreate">${ic("sparkle", 16)} Create and start processing</button>`}</div></section>`;
}

/* ---------- RECORD ---------- */
function vRecord() {
  const r = S.rec;
  if (r.phase === "done") return `<section style="max-width:980px"><div><span class="eyebrow">Recording complete</span><h1 class="page-title">${esc(S.wiz.title)}</h1></div>
    <div class="card pad" style="display:flex;flex-direction:column;gap:14px"><div class="player">${playerScreen(proj("p1"), 0)}</div>
    <div class="row"><span class="meta">Duration ${mmss(r.secs)} · 1080p · Microphone: Headset (Jabra)</span>${mockTag("Simulated capture")}</div>
    <label class="f">Trim<span class="hint">Drag to remove dead time at the start and end</span><input type="range" id="trim" min="0" max="100" value="100" aria-label="Trim end"></label>
    <div class="row"><button class="btn primary" data-act="recUpload">${ic("sparkle", 16)} Upload and generate</button><button class="btn" data-act="recRedo">Re-record</button></div></div></section>`;
  return `<section style="max-width:980px"><div><span class="eyebrow">Record a process</span><h1 class="page-title">Before you record</h1><p class="page-sub">Show only what the audience needs. EL Knowledge Studio records the screen you choose and nothing else.</p></div>
  <div class="split"><div class="card pad" style="display:flex;flex-direction:column;gap:14px">
    <label class="f">Recording title<input type="text" id="r_title" data-wf="title" value="${esc(S.wiz.title)}"></label>
    <div class="grid g2"><label class="f">Workspace<select class="in" id="r_ws"><option>${esc(S.ws)}</option></select></label><label class="f">Classification<select class="in" id="r_cls" data-wf="cls">${["Internal", "Confidential", "Public"].map((c) => `<option ${S.wiz.cls === c ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
    <div class="grid g2"><label class="f">Capture<select class="in" id="r_src"><option>Browser tab</option><option>Application window</option><option>Entire screen</option></select></label><label class="f">Quality<select class="in" id="r_q"><option>1080p (recommended)</option><option>720p</option><option>1440p</option></select></label></div>
    <div class="grid g2"><label class="f">Microphone<select class="in" id="r_mic"><option>Headset (Jabra Evolve2)</option><option>Laptop microphone</option><option>No microphone</option></select></label><label class="f">Camera overlay<select class="in" id="r_cam" disabled><option>Off (coming later)</option></select></label></div>
    <label class="check"><input type="checkbox" id="r_sens" checked><span>Automatically detect sensitive information<small>Faces, e-mail addresses, customer data and card numbers are flagged for redaction after recording.</small></span></label>
    <label class="check"><input type="checkbox" id="r_ok" ${r.consent ? "checked" : ""} data-act="recConsent"><span>I won't show restricted personal or confidential data<small>Read the <a href="#" onclick="return false">recording policy</a>. Password and hidden fields are never captured, and keystrokes are never logged.</small></span></label>
    <button class="btn primary" data-act="recStart" ${r.consent ? "" : "disabled"}>${ic("rec", 16)} Start recording</button>
  </div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div class="card-h">${ic("sparkle", 16)} Recording tips</div>
    <div class="meta" style="font-size:13px;display:flex;flex-direction:column;gap:8px"><span>Narrate what you're doing and why. The AI turns your words into instructions.</span><span>Pause before each click. Scene changes become chapters.</span><span>Use test data where you can. Blurred regions can be adjusted later.</span></div>
    <div class="callout tip"><b>Browser support:</b>&nbsp;Screen capture is blocked inside this preview, so recording is simulated. In the product it uses your browser's screen-share picker. If capture isn't supported, upload a file instead.</div>
    <button class="btn" data-go="upload">${ic("upload", 16)} Upload a file instead</button></div></div>
  ${r.phase === "count" ? `<div class="backdrop" style="background:rgba(7,26,51,.7)"><div class="countdown" aria-live="assertive">${r.count}</div></div>` : ""}
  ${r.phase === "rec" || r.phase === "paused" ? `<div class="rec-float" role="region" aria-label="Recording controls"><span class="rec-dot" ${r.phase === "paused" ? 'style="animation:none;opacity:.4"' : ""}></span><b style="font-variant-numeric:tabular-nums">${mmss(r.secs)}</b><span class="meter" aria-label="Microphone level">${[0, 1, 2, 3, 4, 5].map((k) => `<i style="height:${r.phase === "rec" ? 4 + Math.round(Math.random() * 14) : 3}px"></i>`).join("")}</span><span class="meta" style="color:#9fb3cc">${r.phase === "paused" ? "Paused" : "Recording tab"}</span><button class="btn sm" data-act="recPause">${r.phase === "paused" ? ic("play", 14) + " Resume" : ic("pause", 14) + " Pause"}</button><button class="btn sm danger" data-act="recStop">${ic("stop", 14)} Stop</button></div>` : ""}
  </section>`;
}

/* ---------- UPLOAD ---------- */
function vUpload() {
  const u = S.up;
  return `<section style="max-width:900px"><div><span class="eyebrow">Upload content</span><h1 class="page-title">Upload a video, audio file, document or presentation</h1><p class="page-sub">Files are validated, checked for malware and stored in your workspace region before processing.</p></div>
  <div class="card pad" style="display:flex;flex-direction:column;gap:14px">
    <label class="dropzone" id="drop" for="file">${ic("upload", 28)}<div class="card-h">Drop a file here or choose one</div><div class="meta">MP4, MOV, WEBM, MP3, WAV, PPTX, DOCX, PDF, PNG or JPG · up to 2 GB</div><span class="btn sm">Choose file</span><input id="file" type="file" class="sr" accept=".mp4,.mov,.webm,.mp3,.wav,.pptx,.docx,.pdf,.png,.jpg,.jpeg"></label>
    ${u.error ? `<div class="callout warn" role="alert"><b>${esc(u.error.t)}</b>&nbsp;${esc(u.error.b)}</div>` : ""}
    ${u.file ? `<div class="card pad" style="box-shadow:none"><div class="row between"><div><div class="t">${esc(u.file.name)}</div><div class="meta">${(u.file.size / 1048576).toFixed(1)} MB · ${esc(u.file.type || "unknown type")}</div></div>${u.pct >= 100 ? tonePill("Ready", "ok") : `<button class="btn sm" data-act="upCancel">Cancel</button>`}</div>
      <div class="bar" style="margin-top:10px"><i style="width:${u.pct}%"></i></div>
      <ul class="list" style="margin-top:8px">${[["Extension and type", 15], ["Size limit", 30], ["Duplicate check", 50], ["Integrity", 70], ["Security scan", 95]].map(([l, th]) => `<li style="padding:6px 0">${u.pct >= th ? ic("check", 16) : ic("clock", 16)}<span>${l}</span><span class="meta" style="margin-left:auto">${u.pct >= th ? "Passed" : "Waiting"}</span></li>`).join("")}</ul>
      ${u.pct >= 100 ? `<div class="row" style="margin-top:10px"><button class="btn primary" data-act="upContinue">Continue to project details ${ic("arrow", 16)}</button></div>` : ""}</div>` : ""}
  </div></section>`;
}

/* ---------- PROCESSING JOURNEY ---------- */
const JOURNEY = [
  ["Capture", "Securing your source", "Uploading, encrypting and scanning the file in the EU data region.", ["Uploading source", "Securing source file"]],
  ["Understanding", "Reading the screen", "Extracting frames and audio, and detecting clicks and scene changes.", ["Extracting audio and frames", "Detecting actions and scene changes"]],
  ["Transcription", "Listening to your narration", "Turning speech into a timestamped transcript.", ["Transcribing narration"]],
  ["Knowledge Extraction", "Finding the process", "Building chapters and flagging sensitive information for redaction.", ["Identifying sensitive information", "Creating chapters"]],
  ["Content Creation", "Writing the guide", "Improving the script, capturing screenshots and drafting steps, subtitles and voiceover.", ["Improving the script", "Generating screenshots", "Generating guide steps", "Creating subtitles", "Preparing voiceover", "Rendering preview"]],
  ["Localization", "Preparing translations", "Machine-translating with your terminology glossary locked.", ["Preparing translations"]],
  ["Quality Review", "Checking the result", "Validating structure, terminology and source grounding before handing over to you.", ["Running quality checks"]],
];
function vProcessing() {
  const p = proj(S.pid), j = S.jobs.find((x) => x.pid === S.pid) || { pct: 100 };
  const stageIdx = Math.min(JOURNEY.length, Math.floor((j.pct / 100) * JOURNEY.length));
  const done = j.pct >= 100;
  const preview = (k) => {
    if (k === 2) return `<div class="pv">${p.script.slice(0, 2).map((s) => `<div><span class="ts">${mmss(s.start)}</span> ${esc(s.original.slice(0, 70))}</div>`).join("")}</div>`;
    if (k === 3) return `<div class="pv row">${[...new Set(p.steps.map((s) => s.chapter))].map((c) => `<span class="chip">${esc(c)}</span>`).join("")}<span class="pill s-warn">1 region to redact</span></div>`;
    if (k === 4) return `<div class="pv grid g3">${p.steps.slice(0, 3).map((s, n) => `<div class="mini"><span class="stepnum" style="width:22px;height:22px;font-size:11px">${n + 1}</span> ${esc(s.title)}</div>`).join("")}</div>`;
    if (k === 5) return `<div class="pv row">${p.targets.map((c) => `<span class="chip">${LANGS[c]}</span>`).join("")}</div>`;
    return "";
  };
  return `<section style="max-width:1000px"><div class="row between"><div><span class="eyebrow">Creating your content</span><h1 class="page-title">${esc(p.title)}</h1><p class="page-sub">You can leave this page. We'll notify you when the draft is ready.</p></div>${mockTag("Simulated AI providers")}</div>
  <div class="card journey"><div class="beam"><i style="height:${j.pct}%"></i></div>
  ${JOURNEY.map(([name, head, expl, sub], k) => { const st = k < stageIdx || done ? "ok" : k === stageIdx ? "run" : "q"; return `<div class="jstage ${st}"><span class="jnode" aria-hidden="true">${st === "ok" ? ic("check", 14) : ""}</span><div class="jbody"><div class="row between"><div><span class="eyebrow">${name}</span><div class="card-h">${head}</div></div>${st === "ok" ? tonePill("Done", "ok") : st === "run" ? tonePill("Running", "info") : tonePill("Queued", "neutral")}</div><p class="meta" style="margin:4px 0 0;font-size:13px">${expl}</p>${st !== "q" ? `<div class="meta" style="margin-top:6px">${sub.join(" · ")}</div>` : ""}${st === "ok" || st === "run" ? preview(k) : ""}</div></div>`; }).join("")}</div>
  <div class="card pad row between"><div style="flex:1;min-width:220px"><div class="bar"><i style="width:${j.pct}%"></i></div><div class="meta" style="margin-top:6px">${done ? "All stages complete" : `About ${j.pct}% complete`} · Job ${p.id.toUpperCase()}-4F2A · correlation id shown to administrators only</div></div>
  ${done ? `<button class="btn primary" data-go="project" data-id="${p.id}" data-tab="video">Open the draft ${ic("arrow", 16)}</button>` : `<button class="btn" data-act="cancelJob">Cancel</button>`}</div></section>`;
}

/* ---------- LIBRARY ---------- */
function vLibrary(mine) {
  const f = S.libFilter;
  let list = S.projects.filter((p) => (mine ? p.owner === S.persona.name || (S.persona.role === "creator" && p.owner === "Amara Mensah") : true));
  if (f !== "all") list = list.filter((p) => p.status === f);
  return `<section><div class="row between"><div><h1 class="page-title">${mine ? "My Content" : "Team Library"}</h1><p class="page-sub">${mine ? "Projects you own or contribute to." : "Everything in " + esc(S.ws) + " that you're allowed to see."}</p></div>${can("project.create") ? `<button class="btn primary" data-go="create">${ic("plus", 16)} New project</button>` : ""}</div>
  <div class="row">${[["all", "All"], ["ai", "AI generated"], ["sme", "In review"], ["approval", "Approval pending"], ["changes", "Changes requested"], ["approved", "Approved"], ["published", "Published"]].map(([k, l]) => `<button class="chip" aria-pressed="${f === k}" data-filter="${k}">${l}</button>`).join("")}</div>
  <div class="card">${list.length ? `<div class="tablewrap"><table><thead><tr><th>Title</th><th>Status</th><th>Function</th><th>Classification</th><th>Languages</th><th>Freshness</th><th>Updated</th></tr></thead><tbody>
  ${list.map((p) => { const [fl, ft] = freshness(p); return `<tr class="clickable" data-go="project" data-id="${p.id}" tabindex="0"><td><div class="row" style="flex-wrap:nowrap">${thumb(p, 52)}<div><div class="t" style="font-weight:600">${esc(p.title)}</div><div class="meta">${esc(p.owner)} · v${p.version}</div></div></div></td><td>${pill(p.status)}</td><td>${esc(p.fn)}</td><td>${cls(p.cls)}</td><td class="num">${1 + p.targets.length}</td><td>${tonePill(fl, ft)}</td><td class="meta">${rel(p.updated)}</td></tr>`; }).join("")}
  </tbody></table></div>` : empty("folder", "No projects match this filter", "Try another status, or create a project from a recording or upload.", `<button class="btn sm" data-filter="all">Show all projects</button>`)}</div></section>`;
}
