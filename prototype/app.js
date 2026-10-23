/* State, routing, permission-checked actions and simulations */
const S = {
  persona: PERSONAS[0], ws: WORKSPACES[0], view: "home", pid: "p1", tab: "overview", scene: null, step: null,
  projects: P, jobs: [], audit: AUDIT.map((a) => [...a]), notifs: NOTIFS.map((n) => ({ ...n, unread: true })),
  libFilter: "all", revFilter: "mine", q: "", captions: true, showOrig: false, pubSel: ["sharepoint"],
  rec: { phase: "setup", secs: 0, count: 3, consent: false }, up: { file: null, pct: 0, error: null },
  wiz: null,
};
const newWiz = () => ({ step: 0, src: "recording", outputs: ["video", "guide", "article", "subtitles"], title: "Store Closing Cash Count", desc: "End-of-day cash count and safe deposit for optical stores.", fn: "Retail Operations", process: "Store operations", region: "Europe", country: "Italy", system: "Store Portal (POS Back Office)", audience: "Store managers", cls: "Internal", owner: S.persona.name, sme: "Pierre Laurent", approver: "Chiara Bellini", lang: "English", targets: ["fr", "it"], dests: ["sharepoint", "teams"], tpl: "Retail store procedure", freq: "Every 6 months" });
S.wiz = newWiz();

const can = (perm) => { const ps = ROLE_PERMS[S.persona.role]; return ps.includes("*") || ps.includes(perm); };
const $ = (s, r = document) => r.querySelector(s);
const content = $("#content");

function audit(action, p, outcome = "success", just) { S.audit.unshift([0, S.persona.name, action, p ? p.title : "Workspace", p ? p.version : null, outcome, just]); }
function guard(perm, p) {
  if (can(perm)) return true;
  audit("Permission denied: " + perm, p, "denied");
  toast(`<b>Not allowed.</b> Your ${esc(S.persona.label)} role doesn't include <code>${perm}</code>. The attempt was recorded in the audit history.`);
  return false;
}
function toast(html) {
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = html;
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), 5200);
}
const announce = (msg) => { $("#live").textContent = msg; };

/* ---------- Render ---------- */
const VIEWS = { home: vHome, create: vCreate, wizard: vWizard, record: vRecord, upload: vUpload, processing: vProcessing, mine: () => vLibrary(true), library: () => vLibrary(false), project: vProject, hub: vHub, reviews: vReviews, translations: vTranslations, publishing: vPublishing, analytics: () => (can("analytics.view") ? vAnalytics() : denied("analytics.view")), templates: vTemplates, brand: vBrand, admin: vAdmin, audit: vAudit, help: () => vSimple("help"), feedback: () => vSimple("feedback"), settings: () => vSimple("settings") };
const TITLES = { home: "Home", create: "Create", wizard: "New project", record: "Record a process", upload: "Upload", processing: "Processing", mine: "My Content", library: "Team Library", hub: "Knowledge Hub", reviews: "Reviews", translations: "Translations", publishing: "Publishing", analytics: "Analytics", templates: "Templates", brand: "Brand Center", admin: "Administration", audit: "Audit history", help: "Help and Learning", feedback: "Feedback", settings: "Settings" };

function renderNav() {
  const item = ([k, l, i, perm]) => perm && !can(perm) ? "" : `<li><button data-go="${k}" ${S.view === k || (S.view === "project" && k === "library") || (["wizard", "record", "upload", "processing"].includes(S.view) && k === "create") ? 'aria-current="page"' : ""} title="${l}">${ic(i)}<span class="lbl">${l}</span>${k === "reviews" ? `<span class="cnt">${REVIEWS.filter((r) => r.assignee === S.persona.id && r.status === "open").length}</span>` : ""}</button></li>`;
  $("#navMain").innerHTML = NAV.map(item).join("");
  $("#navLow").innerHTML = NAV_LOW.map(item).join("");
  const p = S.view === "project" ? proj(S.pid) : null;
  $("#crumbs").innerHTML = `<span>${esc(S.ws.split(" · ")[0])}</span><span aria-hidden="true">/</span>${p ? `<span>Team Library</span><span aria-hidden="true">/</span><strong>${esc(p.title)}</strong>` : `<strong>${TITLES[S.view]}</strong>`}`;
  $("#pAv").textContent = S.persona.ini;
  const unread = S.notifs.filter((n) => n.unread).length; $("#notifDot").hidden = !unread; $("#notifDot").textContent = unread;
  const running = S.jobs.filter((j) => j.pct < 100).length; $("#jobsDot").hidden = !running; $("#jobsDot").textContent = running;
}
function render(focus) {
  content.innerHTML = VIEWS[S.view]();
  renderNav();
  document.title = (S.view === "project" ? proj(S.pid)?.title : TITLES[S.view]) + " · EL Knowledge Studio";
  if (focus) { content.scrollTop = 0; content.focus({ preventScroll: true }); }
}
function go(view, opts = {}) {
  S.view = view;
  if (opts.id) S.pid = opts.id;
  if (view === "project") { S.tab = opts.tab || "overview"; S.scene = opts.sceneid || null; S.step = opts.stepid || null; }
  if (view === "wizard" && !opts.keep) S.wiz = { ...newWiz(), ...(opts.wiz || {}) };
  if (view === "record" && S.rec.phase === "done" && !opts.keep) S.rec = { phase: "setup", secs: 0, count: 3, consent: false };
  closeOverlays();
  $("#app").classList.remove("drawer");
  render(true);
}

/* ---------- Content helpers ---------- */
function ensureDraftVersion(p) {
  if (["approved", "published"].includes(p.status)) {
    p.version += 1; p.status = "creator";
    audit("Version created", p);
    toast(`<b>Version ${p.version} draft created.</b> Version ${p.approvedV} stays approved${p.publishedV ? " and published" : ""} until the new version is approved.`);
  }
}
function edit(p, mutate) {
  if (!guard("project.edit", p)) { render(); return false; }
  ensureDraftVersion(p); mutate(); p.updated = 0; audit("Content edited", p); return true;
}
function startJob(p) {
  S.jobs = S.jobs.filter((j) => j.pid !== p.id);
  S.jobs.push({ pid: p.id, pct: 0, stage: -1 });
  audit("AI generation started", p);
}
function createFromWizard() {
  const w = S.wiz, id = "p" + (S.projects.length + 1) + "x";
  const base = proj("p1");
  const p = { ...base, id, title: w.title.trim(), fn: w.fn, region: w.region, country: w.country, cls: w.cls, status: "processing", owner: w.owner || S.persona.name, sme: w.sme, approver: w.approver, version: 1, approvedV: null, publishedV: null, updated: 0, review: 180, views: 0, hue: 195, system: w.system, audience: w.audience, targets: w.targets, summary: w.desc || "Generated from a " + w.src + " source.",
    steps: base.steps.map((s) => ({ ...s, id: id + s.id })), scenes: base.scenes.map((s) => ({ ...s, id: id + s.id })), script: base.script.map((s) => ({ ...s, id: id + s.id })) };
  S.projects.unshift(p);
  audit("Project created", p); audit("Source uploaded", p);
  startJob(p);
  S.pid = id; go("processing");
}

/* ---------- Click delegation ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-go],[data-act],[data-tab-btn],[data-scene],[data-step],[data-filter],[data-revf],[data-wt],[data-wd]");
  if (!el || el.disabled) return;
  if (el.matches("[contenteditable='true']") || e.target.closest("[contenteditable='true']")) return;
  if (el.dataset.go) {
    if (el.dataset.q) S.q = el.dataset.q;
    if (["record", "upload", "wizard"].includes(el.dataset.go) && !can("project.create")) { guard("project.create"); return; }
    const wiz = el.dataset.src ? { src: el.dataset.src === "template" ? "recording" : el.dataset.src } : undefined;
    return go(el.dataset.go, { id: el.dataset.id, tab: el.dataset.tab, sceneid: el.dataset.sceneid, stepid: el.dataset.stepid, wiz, keep: el.dataset.go === "record" });
  }
  if (el.dataset.tabBtn) { S.tab = el.dataset.tabBtn; return render(); }
  if (el.dataset.scene && !el.dataset.act) { S.scene = el.dataset.scene; return render(); }
  if (el.dataset.step && !el.dataset.act && !e.target.closest("[data-go]")) { if (S.step !== el.dataset.step) { S.step = el.dataset.step; render(); } return; }
  if (el.dataset.filter) { S.libFilter = el.dataset.filter; return render(); }
  if (el.dataset.revf) { S.revFilter = el.dataset.revf; return render(); }
  if (el.dataset.wt) { const t = S.wiz.targets; const c = el.dataset.wt; S.wiz.targets = t.includes(c) ? t.filter((x) => x !== c) : [...t, c]; return render(); }
  if (el.dataset.wd) { const t = S.wiz.dests; const c = el.dataset.wd; S.wiz.dests = t.includes(c) ? t.filter((x) => x !== c) : [...t, c]; return render(); }
  const a = ACTIONS[el.dataset.act]; if (a) a(el, e);
});

const p0 = () => proj(S.pid);
const ACTIONS = {
  toast: (el) => toast(esc(el.dataset.msg)),
  wizBack: () => { S.wiz.step = Math.max(0, S.wiz.step - 1); render(); },
  wizNext: () => {
    const w = S.wiz;
    if (w.step === 1 && !w.outputs.length) return toast("<b>Choose at least one output.</b> A polished video and a guide are a good start.");
    if (w.step === 2) {
      if (!w.title.trim()) { toast("<b>Add a title.</b> People find content by its title, so name the process they'll search for."); $("#w_title")?.focus(); return; }
      if (w.cls === "Restricted") return toast("<b>Restricted content can't be processed.</b> Change the classification to continue.");
    }
    w.step += 1; render(true);
  },
  wizCreate: () => { if (guard("project.create")) createFromWizard(); },
  recConsent: (el) => { S.rec.consent = el.checked; render(); },
  recStart: () => {
    if (!guard("recording.create")) return;
    S.rec.phase = "count"; S.rec.count = 3; render();
    const t = setInterval(() => { S.rec.count -= 1; if (S.rec.count <= 0) { clearInterval(t); S.rec.phase = "rec"; S.rec.secs = 0; announce("Recording started"); } if (S.view === "record") render(); }, 800);
  },
  recPause: () => { S.rec.phase = S.rec.phase === "paused" ? "rec" : "paused"; announce(S.rec.phase === "paused" ? "Recording paused" : "Recording resumed"); render(); },
  recStop: () => { S.rec.phase = "done"; if (S.rec.secs < 4) S.rec.secs = 187; announce("Recording stopped"); render(true); },
  recRedo: () => { S.rec = { phase: "setup", secs: 0, count: 3, consent: true }; render(); },
  recUpload: () => { S.wiz.src = "recording"; S.wiz.step = 1; go("wizard", { keep: true }); toast("<b>Recording uploaded.</b> Choose the outputs you want generated."); },
  upCancel: () => { clearInterval(S.up.timer); S.up = { file: null, pct: 0, error: { t: "Upload cancelled.", b: "Nothing was stored. Choose the file again to retry." } }; render(); },
  upContinue: () => { const n = S.up.file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "); S.wiz.title = n.charAt(0).toUpperCase() + n.slice(1); S.wiz.src = /\.(pdf|docx)$/i.test(S.up.file.name) ? "document" : /\.pptx$/i.test(S.up.file.name) ? "presentation" : /\.(mp3|wav)$/i.test(S.up.file.name) ? "audio" : "video"; S.wiz.step = 1; go("wizard", { keep: true }); },
  cancelJob: () => { S.jobs = S.jobs.filter((j) => j.pid !== S.pid); const p = p0(); p.status = "draft"; audit("AI generation cancelled", p); toast("<b>Processing cancelled.</b> The source file is kept so you can restart later."); go("library"); },
  submit: () => {
    const p = p0(); if (!guard("project.edit", p)) return;
    if (!["ai", "creator", "changes", "draft"].includes(p.status)) return toast("This version is already in review.");
    p.status = "sme"; REVIEWS.unshift({ id: "r" + Date.now(), pid: p.id, stage: "SME review", assignee: "u2", ver: p.version, due: 5, status: "open" });
    audit("Review submitted", p); S.tab = "review"; render();
    toast(`<b>Submitted for SME review.</b> Pierre Laurent was notified. Switch persona to <b>Reviewer (SME)</b> to continue the journey.`);
  },
  approve: () => {
    const p = p0(); if (!guard("review.approve", p)) return;
    const role = S.persona.role, admin = role === "wsadmin" || role === "entadmin";
    if (p.status === "sme" && (role === "reviewer" || admin)) {
      p.status = "approval"; REVIEWS.forEach((r) => { if (r.pid === p.id && r.status === "open") r.status = "approved"; });
      REVIEWS.unshift({ id: "r" + Date.now(), pid: p.id, stage: "Approval", assignee: "u3", ver: p.version, due: 3, status: "open" });
      audit("Approval granted (SME)", p); render(); return toast(`<b>SME review approved for v${p.version}.</b> Sent to Chiara Bellini for final approval. Switch persona to <b>Approver</b>.`);
    }
    if (["approval", "compliance"].includes(p.status) && (role === "approver" || admin)) {
      p.status = "approved"; p.approvedV = p.version; p.review = 180; REVIEWS.forEach((r) => { if (r.pid === p.id && r.status === "open") r.status = "approved"; });
      audit("Approval granted", p); render(); return toast(`<b>Version ${p.version} approved.</b> It can now be published. Switch persona to <b>Publisher</b>.`);
    }
    toast(`<b>Not your stage.</b> This item is in ${STATUS[p.status][0]}. ${p.status === "sme" ? "An SME reviewer" : "An approver"} decides at this step.`);
  },
  reject: () => {
    const p = p0(); if (!guard("review.approve", p)) return;
    const j = $("#just").value.trim();
    if (!j) { toast("<b>Add a justification.</b> Requests for changes need a reason the creator can act on."); $("#just").focus(); return; }
    p.status = "changes"; REVIEWS.forEach((r) => { if (r.pid === p.id && r.status === "open") r.status = "changes"; });
    COMMENTS.push({ id: "cm" + Date.now(), pid: p.id, author: S.persona.name, ini: S.persona.ini, body: "Changes requested: " + j, anchor: "Whole project", ver: p.version, when: 0, resolved: false });
    audit("Approval rejected", p, "success", j); render(); toast("<b>Changes requested.</b> The creator was notified, and your justification is in the audit history.");
  },
  comment: () => {
    const p = p0(); if (!guard("review.comment", p)) return;
    const body = $("#cBody").value.trim(); if (!body) { toast("Write a comment first."); $("#cBody").focus(); return; }
    COMMENTS.push({ id: "cm" + Date.now(), pid: p.id, author: S.persona.name, ini: S.persona.ini, body, anchor: $("#cAnchor").value, ver: p.version, when: 0, resolved: false });
    audit("Comment added", p); render(); toast("<b>Comment added.</b>" + (/@\w+/.test(body) ? " Mentioned colleagues were notified." : ""));
  },
  resolve: (el) => { const c = COMMENTS.find((x) => x.id === el.dataset.id); if (!guard("review.comment", p0())) return; c.resolved = true; audit("Comment resolved", p0()); render(); },
  publish: () => {
    const p = p0(); if (!guard("publish.execute", p)) return;
    if (!["approved", "published"].includes(p.status)) return toast("Only an approved version can be published.");
    if (!S.pubSel.length) return toast("Choose at least one destination.");
    S.pubSel.forEach((d) => PUBLICATIONS.unshift({ pid: p.id, ver: p.approvedV, dest: d, lang: p.lang, when: 0, by: S.persona.name }));
    p.status = "published"; p.publishedV = p.approvedV;
    audit("Content published", p); render();
    toast(`<b>Published v${p.approvedV} to ${S.pubSel.map((d) => DESTS.find((x) => x.key === d).label).join(", ")}.</b> This was a simulated publication. No external system was contacted.`);
  },
  captions: () => { S.captions = !S.captions; render(); },
  toggleOrig: () => { S.showOrig = !S.showOrig; render(); },
  rewrite: (el) => {
    const p = p0(), s = p.script.find((x) => x.id === el.dataset.id), k = el.dataset.kind;
    if (s.locked) return toast("This paragraph is locked as approved text. Unlock it first.");
    edit(p, () => {
      const first = s.text.split(/(?<=\.)\s/)[0];
      s.text = k === "Shorten" ? first : k === "Simplify" ? first.replace(/, then /g, ". Then ").replace(/Confirm/g, "Check") : k === "More professional" ? "Please " + s.text.charAt(0).toLowerCase() + s.text.slice(1) : s.text.replace(/^(\w)/, (m) => m.toUpperCase()).replace(/\.$/, ". You'll see a confirmation when it's done.");
      s.origin = "ai";
    }) && (render(), toast(`<b>${k}:</b> AI rewrite applied and labelled. The original transcript is kept.`));
  },
  lock: (el) => { const p = p0(), s = p.script.find((x) => x.id === el.dataset.id); if (edit(p, () => { s.locked = !s.locked; })) render(); },
  sceneZoom: (el) => { const p = p0(), sc = curScene(p); if (edit(p, () => { sc.zoom = el.checked; })) render(); },
  sceneRedact: (el) => { const p = p0(), sc = curScene(p); if (edit(p, () => { sc.redact = el.checked; })) { audit("Redaction " + (el.checked ? "added" : "removed"), p); render(); } },
  split: () => { const p = p0(), sc = curScene(p), i = p.scenes.indexOf(sc); if (sc.end - sc.start < 10) return toast("This scene is too short to split."); edit(p, () => { const mid = Math.round((sc.start + sc.end) / 2); p.scenes.splice(i + 1, 0, { ...sc, id: sc.id + "b", title: sc.title + " (part 2)", start: mid, zoom: false, redact: false }); sc.end = mid; p.script.splice(i + 1, 0, { ...p.script[i], id: p.script[i].id + "b", start: mid, text: "Continue " + sc.title.toLowerCase() + "." }); p.steps.splice(i + 1, 0, { ...p.steps[i], id: p.steps[i].id + "b", title: sc.title + " (continued)", sec: mid, warning: null, tip: null }); }) && render(); },
  delScene: () => { const p = p0(); if (p.scenes.length < 2) return toast("A video needs at least one scene."); const sc = curScene(p), i = p.scenes.indexOf(sc); if (edit(p, () => { p.scenes.splice(i, 1); p.script.splice(i, 1); if (p.scenes[i - 1]) p.scenes[i - 1].end = sc.end; else p.scenes[0].start = 0; })) { S.scene = null; render(); toast("Scene deleted. Restore it from version history if needed."); } },
  moveScene: () => { const p = p0(), sc = curScene(p), i = p.scenes.indexOf(sc); if (i === 0) return; edit(p, () => { [p.scenes[i - 1], p.scenes[i]] = [p.scenes[i], p.scenes[i - 1]]; [p.script[i - 1], p.script[i]] = [p.script[i], p.script[i - 1]]; }) && render(); },
  addStep: () => { const p = p0(), s = curStep(p), i = p.steps.indexOf(s); if (!guard("guide.edit", p)) return; edit(p, () => { const n = { ...s, id: s.id + "n" + Date.now(), title: "New step", instruction: "Describe what the person does and what they should see.", warning: null, tip: null, origin: "human" }; p.steps.splice(i + 1, 0, n); S.step = n.id; }) && render(); },
  delStep: () => { const p = p0(); if (!guard("guide.edit", p)) return; if (p.steps.length < 2) return toast("A guide needs at least one step."); const s = curStep(p); edit(p, () => { p.steps.splice(p.steps.indexOf(s), 1); S.step = null; }) && render(); },
  moveStep: (el) => { const p = p0(); if (!guard("guide.edit", p)) return; const s = curStep(p), i = p.steps.indexOf(s), j = i + Number(el.dataset.dir); if (j < 0 || j >= p.steps.length) return; edit(p, () => { [p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]]; }) && render(); },
  applySuggestion: () => { const p = p0(); if (!guard("guide.edit", p)) return; const s = curStep(p); edit(p, () => { s.tip = "Thresholds differ by country. France uses €10, and Italy and Germany use €20."; s.origin = "ai"; }) && (render(), toast("Regional note added as an AI suggestion. Review it before submitting.")); },
  useTemplate: (el) => { if (!guard("project.create")) return; go("wizard", { wiz: { tpl: el.dataset.tpl } }); },
};
const curScene = (p) => p.scenes.find((s) => s.id === S.scene) || p.scenes[0];
const curStep = (p) => p.steps.find((s) => s.id === S.step) || p.steps[0];

/* ---------- Inputs ---------- */
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.w === "src" || t.dataset.w === "tpl") { S.wiz[t.dataset.w] = t.value; }
  if (t.dataset.w === "outputs") { S.wiz.outputs = [...document.querySelectorAll("[data-w=outputs]:checked")].map((x) => x.value); }
  if (t.dataset.wf) { S.wiz[t.dataset.wf] = t.value; if (t.dataset.wf === "cls") render(); }
  if (t.dataset.pub) { S.pubSel = [...document.querySelectorAll("[data-pub]:checked")].map((x) => x.value); render(); }
  if (t.dataset.scenetitle) { const p = p0(), sc = p.scenes.find((s) => s.id === t.dataset.scenetitle); if (t.value.trim() && edit(p, () => { sc.title = t.value.trim(); })) render(); }
  if (t.id === "file") handleFile(t.files[0]);
  if (t.id === "seek") { const p = p0(), v = Number(t.value); S.scene = (p.scenes.find((s) => v >= s.start && v < s.end) || p.scenes[0]).id; render(); }
  if (t.id === "personaSel") { S.persona = PERSONAS.find((p) => p.id === t.value); S.revFilter = "mine"; toast(`Now viewing as <b>${esc(S.persona.name)}</b>, ${esc(S.persona.label)}. Demo persona switching is a development-only feature.`); render(); }
  if (t.id === "wsSel") { S.ws = t.value; toast(`Switched to <b>${esc(S.ws)}</b>. Demo data is shared across workspaces in this prototype.`); render(); }
});
document.addEventListener("input", (e) => { if (e.target.dataset.wf) S.wiz[e.target.dataset.wf] = e.target.value; });
document.addEventListener("focusout", (e) => {
  const t = e.target; if (t.getAttribute?.("contenteditable") !== "true") return;
  const p = p0(), val = t.textContent.trim(); if (!p || !val) return;
  if (t.dataset.script) { const s = p.script.find((x) => x.id === t.dataset.script); if (s && s.text !== val && edit(p, () => { s.text = val; s.origin = "human"; })) render(); }
  if (t.dataset.steptitle) { const s = p.steps.find((x) => x.id === t.dataset.steptitle); if (s && s.title !== val && edit(p, () => { s.title = val; s.origin = "human"; })) render(); }
  if (t.dataset.stepbody) { const s = p.steps.find((x) => x.id === t.dataset.stepbody); if (s && s.instruction !== val && edit(p, () => { s.instruction = val; s.origin = "human"; })) render(); }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.dataset.act === "searchForm") { S.q = $("#hubq").value.trim(); render(); }
  if (e.target.dataset.act === "feedbackForm") { toast("<b>Thanks.</b> Your feedback is with the product team."); e.target.reset(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); go("hub"); setTimeout(() => $("#hubq")?.focus(), 0); }
  if (e.key === "Escape") closeOverlays(true);
  if (e.key === "Enter" && e.target.matches("li[tabindex], tr[tabindex]")) e.target.click();
});

/* ---------- Upload validation ---------- */
const OK_EXT = ["mp4", "mov", "webm", "mp3", "wav", "pptx", "docx", "pdf", "png", "jpg", "jpeg"];
function handleFile(f) {
  if (!f) return;
  if (!can("project.create")) return guard("project.create");
  const ext = f.name.split(".").pop().toLowerCase();
  if (!OK_EXT.includes(ext)) { S.up = { file: null, pct: 0, error: { t: `.${ext} files aren't supported.`, b: "Use MP4, MOV, WEBM, MP3, WAV, PPTX, DOCX, PDF, PNG or JPG." } }; return render(); }
  if (f.size > 2 * 1024 ** 3) { S.up = { file: null, pct: 0, error: { t: "This file is larger than 2 GB.", b: "Trim the recording or split it into parts, then upload again." } }; return render(); }
  if (f.size === 0) { S.up = { file: null, pct: 0, error: { t: "This file is empty or damaged.", b: "Export it again from the original application and retry." } }; return render(); }
  clearInterval(S.up.timer);
  S.up = { file: f, pct: 0, error: null };
  S.up.timer = setInterval(() => { S.up.pct = Math.min(100, S.up.pct + 7); if (S.up.pct >= 100) { clearInterval(S.up.timer); announce("Upload validated"); } if (S.view === "upload") render(); }, 220);
  render();
}
document.addEventListener("dragover", (e) => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", (e) => { e.target.closest?.("#drop")?.classList.remove("over"); });
document.addEventListener("drop", (e) => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); handleFile(e.dataTransfer.files[0]); } });

/* ---------- Ticks: recording + processing ---------- */
setInterval(() => {
  if (S.rec.phase === "rec") { S.rec.secs += 1; if (S.view === "record") render(); }
  S.jobs.forEach((j) => {
    if (j.pct >= 100) return;
    j.pct = Math.min(100, j.pct + 4);
    const st = Math.floor((j.pct / 100) * JOURNEY.length);
    if (st !== j.stage && st < JOURNEY.length) { j.stage = st; announce("Stage " + (st + 1) + " of 7: " + JOURNEY[st][0]); }
    if (j.pct >= 100) {
      const p = proj(j.pid); p.status = "ai"; audit("AI generation completed", p);
      S.notifs.unshift({ t: "Processing completed", b: p.title + ": video, guide and article drafts are ready to review.", when: 0, go: ["project", p.id, "video"], unread: true });
      announce("Processing complete"); toast(`<b>Your draft is ready.</b> ${esc(p.title)} now has a video, a guide and an article to review.`);
    }
  });
  if (S.jobs.some((j) => j.pct < 100 || !j.shown)) { S.jobs.forEach((j) => { if (j.pct >= 100) j.shown = true; }); if (["processing", "home"].includes(S.view)) render(); else renderNav(); }
}, 1000);

/* ---------- Top-bar overlays ---------- */
const CREATE_ITEMS = [["record", "rec", "Record screen", "Capture a tab, window or screen"], ["upload", "video", "Upload video", "MP4, MOV, WEBM"], ["upload", "doc", "Upload document", "DOCX or PDF"], ["upload", "layout", "Import presentation", "PPTX"], ["templates", "tpl", "Create from template", "Governed templates"], ["upload", "users", "Import approved Teams recording", "With participant consent"], ["wizard", "doc", "Create knowledge article manually", "Start from a blank article"]];
function closeOverlays(restore) {
  ["#createMenu", "#notifPanel", "#jobsPanel"].forEach((s) => { const m = $(s); if (!m.hidden) { m.hidden = true; if (restore) m.previousElementSibling.focus(); } });
  $("#createBtn").setAttribute("aria-expanded", "false");
}
function toggle(panel, btn, html) {
  const open = $(panel).hidden; closeOverlays();
  if (open) { $(panel).innerHTML = html(); $(panel).hidden = false; btn.setAttribute("aria-expanded", "true"); $(panel).querySelector("button")?.focus(); }
}
$("#createBtn").addEventListener("click", (e) => { e.stopPropagation(); toggle("#createMenu", e.currentTarget, () => CREATE_ITEMS.map(([g, i, t, d]) => `<button role="menuitem" data-go="${g}">${ic(i)}<span><b>${t}</b><small>${d}</small></span></button>`).join("")); });
$("#notifBtn").addEventListener("click", (e) => { e.stopPropagation(); toggle("#notifPanel", e.currentTarget, () => `<div class="pad row between" style="padding:14px 16px"><b>Notifications</b><button class="btn sm ghost" id="markRead">Mark all read</button></div><ul class="list">${S.notifs.map((n, i) => `<li class="clickable" data-notif="${i}" tabindex="0" style="align-items:flex-start;padding:12px 16px">${n.unread ? '<span class="rec-dot" style="animation:none;background:var(--action);margin-top:6px"></span>' : '<span style="width:10px"></span>'}<div><div class="t">${esc(n.t)}</div><div class="meta" style="font-size:13px">${esc(n.b)}</div><div class="meta">${rel(n.when)}</div></div></li>`).join("")}</ul>`); });
$("#jobsBtn").addEventListener("click", (e) => { e.stopPropagation(); toggle("#jobsPanel", e.currentTarget, () => `<div class="pad" style="padding:14px 16px"><b>Processing jobs</b></div>${S.jobs.length ? `<ul class="list">${S.jobs.map((j) => `<li class="clickable" data-go="processing" data-id="${j.pid}" style="padding:12px 16px"><div style="flex:1"><div class="t">${esc(proj(j.pid).title)}</div><div class="bar" style="margin-top:6px"><i style="width:${j.pct}%"></i></div></div><span class="meta">${j.pct >= 100 ? "Done" : j.pct + "%"}</span></li>`).join("")}</ul>` : empty("sparkle", "No processing jobs", "Jobs appear here when you create content.", "")}`); });
document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-notif]");
  if (n) { const x = S.notifs[Number(n.dataset.notif)]; x.unread = false; go(x.go[0], { id: x.go[1], tab: x.go[2] }); return; }
  if (e.target.id === "markRead") { S.notifs.forEach((x) => (x.unread = false)); closeOverlays(); renderNav(); return; }
  if (!e.target.closest(".menu,.panel")) closeOverlays();
});
$("#searchTrig").addEventListener("click", () => { go("hub"); setTimeout(() => $("#hubq")?.focus(), 0); });
$("#navToggle").addEventListener("click", (e) => {
  const app = $("#app"), mobile = matchMedia("(max-width:820px)").matches;
  if (mobile) app.classList.toggle("drawer"); else app.classList.toggle("collapsed");
  e.currentTarget.setAttribute("aria-expanded", mobile ? app.classList.contains("drawer") : !app.classList.contains("collapsed"));
});

/* ---------- Boot ---------- */
$("#personaSel").innerHTML = PERSONAS.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.label)}</option>`).join("");
$("#wsSel").innerHTML = WORKSPACES.map((w) => `<option>${esc(w)}</option>`).join("");
const startHash = (location.hash || "").slice(1);
if (VIEWS[startHash] && startHash !== "project" && startHash !== "processing") S.view = startHash;
render();
