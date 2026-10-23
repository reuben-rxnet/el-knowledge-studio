/* Project workspace, editors, reviews, publishing, hub, analytics and admin views */
function playerScreen(p, t) {
  const sc = p.scenes.find((s) => t >= s.start && t < s.end) || p.scenes[0];
  const i = p.scenes.indexOf(sc), seg = p.script[i] || p.script[0];
  const z = sc.zoom ? `<span class="zoom" style="left:${18 + (i * 11) % 40}%;top:${22 + (i * 7) % 30}%;width:34%;height:30%"></span>` : "";
  return `<div class="screen"><div class="sb"></div><div class="bd"><div class="ln" style="width:40%;background:#0B2D5B;opacity:.7"></div><div class="ln" style="width:85%"></div><div class="ln" style="width:70%"></div><div class="ln" style="width:55%"></div>${sc.redact ? `<div class="ln blurbox" style="width:45%"></div>` : ""}</div></div>${z}
  <span class="chap">${esc(sc.title)}</span>${S.captions ? `<span class="cap">${esc(seg.text.slice(0, 110))}</span>` : ""}`;
}

const PTABS = [["overview", "Overview"], ["video", "Video"], ["guide", "Guide"], ["knowledge", "Knowledge"], ["translations", "Translations"], ["review", "Review"], ["publishing", "Publishing"], ["activity", "Activity"]];
function vProject() {
  const p = proj(S.pid);
  if (!p) return `<section>${empty("folder", "This project no longer exists", "It may have been archived or deleted. Search the library for a newer version.", `<button class="btn" data-go="library">Open Team Library</button>`)}</section>`;
  const [fl, ft] = freshness(p);
  const head = `<div class="phead"><div class="row" style="gap:16px;align-items:flex-start;flex-wrap:nowrap">${thumb(p, 96)}<div style="flex:1;min-width:0">
    <div class="row" style="gap:8px">${pill(p.status)}${cls(p.cls)}${tonePill(fl, ft)}<span class="meta">Version ${p.version}${p.approvedV ? ` · v${p.approvedV} approved` : ""}${p.publishedV ? ` · v${p.publishedV} published` : ""}</span></div>
    <h1 class="page-title" style="margin-top:6px">${esc(p.title)}</h1>
    <div class="meta">${esc(p.fn)} · ${esc(S.ws)} · Owner ${esc(p.owner)} · Updated ${rel(p.updated)} · Next review ${dateFmt(ahead(p.review))}</div></div>
    <div class="row" style="flex-wrap:wrap;justify-content:flex-end">${actionButtons(p)}</div></div>
    <div class="tabs" role="tablist">${PTABS.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-tab-btn="${k}">${l}${k === "review" && openComments(p).length ? ` <span class="pill s-warn" style="padding:0 6px">${openComments(p).length}</span>` : ""}</button>`).join("")}</div></div>`;
  const body = { overview: tOverview, video: tVideo, guide: tGuide, knowledge: tKnowledge, translations: tTrans, review: tReview, publishing: tPublish, activity: tActivity }[S.tab](p);
  return `<section>${head}${body}</section>`;
}
const openComments = (p) => COMMENTS.filter((c) => c.pid === p.id && !c.resolved);
function actionButtons(p) {
  const b = [];
  if (["ai", "creator", "changes", "draft"].includes(p.status)) b.push(`<button class="btn primary" data-act="submit">${ic("send", 16)} Submit for review</button>`);
  if (["sme", "approval", "compliance"].includes(p.status)) b.push(`<button class="btn primary" data-tab-btn="review">${ic("check", 16)} Open review</button>`);
  if (p.status === "approved") b.push(`<button class="btn primary" data-tab-btn="publishing">${ic("send", 16)} Publish</button>`);
  if (p.status === "published") b.push(`<button class="btn" data-go="hub" data-q="${esc(p.steps[0].title)}">${ic("hub", 16)} View in Knowledge Hub</button>`);
  return b.join("");
}

function tOverview(p) {
  const assets = [["Polished video", mmss(p.dur), "video"], ["Step-by-step guide", p.steps.length + " steps", "guide"], ["Knowledge article", "Summary, FAQ", "knowledge"], ["Subtitles", (1 + p.targets.length) + " languages", "translations"]];
  return `<div class="split"><div style="display:flex;flex-direction:column;gap:16px">
    <div class="card pad"><div class="player" role="img" aria-label="Video preview">${playerScreen(p, 0)}</div><p style="margin:14px 0 0">${esc(p.summary)}</p></div>
    <div class="card"><div class="pad row between"><h3 class="card-h">Generated assets</h3>${aiTag()}</div><ul class="list">${assets.map(([n, m, t]) => `<li class="clickable" data-tab-btn="${t}" tabindex="0">${ic(t === "video" ? "video" : t === "guide" ? "doc" : t === "translations" ? "globe" : "hub", 18)}<div style="flex:1"><div class="t">${n}</div><div class="meta">${m}</div></div>${ic("arrow", 16)}</li>`).join("")}</ul></div>
    <div class="card pad"><h3 class="card-h">AI generation summary</h3><div class="meta" style="font-size:13px;margin-top:6px;display:grid;gap:4px"><span>Models: simulated transcription, script and guide providers (demo mode)</span><span>Source grounding: ${p.steps.length}/${p.steps.length} steps linked to timestamps</span><span>Terminology locked: ${esc(p.system)}</span><span>Sensitive regions detected: 1 (blurred, needs confirmation)</span></div></div></div>
  <div style="display:flex;flex-direction:column;gap:16px"><div class="card pad"><h3 class="card-h">Metadata</h3><dl class="dl">${[["Business function", p.fn], ["Region", p.region + " · " + p.country], ["Source system", p.system], ["Audience", p.audience], ["Primary language", LANGS[p.lang]], ["Subject-matter expert", p.sme], ["Approver", p.approver], ["Review frequency", "Every 6 months"], ["Effective date", dateFmt(ago(30 + p.updated))]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
  <div class="card pad"><h3 class="card-h">Version history</h3><ul class="list" style="margin-top:6px">${Array.from({ length: p.version }, (_, k) => p.version - k).map((v) => `<li style="padding:8px 0"><b>v${v}</b><span class="meta" style="flex:1">${v === p.version ? "Current draft" : v === p.publishedV ? "Published" : v === p.approvedV ? "Approved" : "Superseded"}</span>${v === p.publishedV ? tonePill("Live", "ok") : ""}</li>`).join("")}</ul></div></div></div>`;
}

function tVideo(p) {
  const sel = p.scenes.find((s) => s.id === S.scene) || p.scenes[0], si = p.scenes.indexOf(sel);
  const total = p.dur, pct = (s) => ((s.end - s.start) / total) * 100;
  const lane = (cl, f) => p.scenes.map((s, i) => `<button class="clip ${cl} ${s.id === sel.id ? "sel" : ""}" style="width:${pct(s)}%" data-scene="${s.id}" aria-label="${esc(s.title)}">${f(s, i)}</button>`).join("");
  return `<div class="edtool row between"><div class="row"><span class="meta">${ic("check", 14)} Autosaved</span><button class="btn sm ghost" data-act="toast" data-msg="Undo isn't available in this prototype.">Undo</button><button class="btn sm ghost" data-act="toast" data-msg="Redo isn't available in this prototype.">Redo</button></div><div class="row"><button class="btn sm" data-act="toast" data-msg="Comparing v${p.version} with v${p.version - 1 || 1}: 3 scenes changed, 2 script paragraphs edited.">Compare versions</button><button class="btn sm" data-act="submit">Share for review</button></div></div>
  <div class="editor"><div class="card" style="padding:8px"><div class="eyebrow" style="padding:8px">Chapters</div>${p.scenes.map((s, i) => `<button class="scene ${s.id === sel.id ? "sel" : ""}" data-scene="${s.id}"><span class="no">${i + 1}</span><span style="flex:1"><span style="display:block;font-weight:600;font-size:13px">${esc(s.title)}</span><span class="meta">${mmss(s.start)} – ${mmss(s.end)}</span></span></button>`).join("")}</div>
  <div style="display:flex;flex-direction:column;gap:12px;min-width:0"><div class="player">${playerScreen(p, sel.start)}</div>
    <div class="row controls"><button class="iconbtn" data-act="toast" data-msg="Playback is simulated in this prototype." aria-label="Play">${ic("play", 16)}</button><span class="meta" style="font-variant-numeric:tabular-nums">${mmss(sel.start)} / ${mmss(total)}</span><input type="range" id="seek" min="0" max="${total}" value="${sel.start}" aria-label="Seek" style="flex:1"><select class="in" id="speed" aria-label="Playback speed" style="width:auto"><option>1×</option><option>1.25×</option><option>1.5×</option></select><button class="btn sm" aria-pressed="${S.captions}" data-act="captions">CC</button></div>
    <div class="card timeline" aria-label="Timeline">${[["Video", "v", (s, i) => "Scene " + (i + 1)], ["Narration", "n", () => "AI voice · Aria"], ["Captions", "c", () => "EN"], ["Zoom", "z", (s) => (s.zoom ? "Focus zoom" : "")], ["Redaction", "r", (s) => (s.redact ? "Blur" : "")]].map(([l, c, f]) => `<div class="track"><span class="tl">${l}</span><div class="lane">${c === "z" || c === "r" ? p.scenes.map((s) => `<span style="width:${pct(s)}%;display:flex">${(c === "z" ? s.zoom : s.redact) ? `<button class="clip ${c}" style="width:100%" data-scene="${s.id}">${f(s)}</button>` : ""}</span>`).join("") : lane(c, f)}</div></div>`).join("")}</div>
    <div class="card pad"><div class="row between"><h3 class="card-h">Script</h3><div class="row">${aiTag("AI-edited from transcript")}<button class="btn sm" aria-pressed="${S.showOrig}" data-act="toggleOrig">${S.showOrig ? "Hide" : "Compare with"} original transcript</button></div></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">${p.script.map((s, i) => `<div class="para ${i === si ? "active" : ""}"><div class="row between"><button class="ts" data-scene="${p.scenes[i].id}">${mmss(s.start)}</button><div class="row" style="gap:6px">${s.locked ? tonePill("Approved text · locked", "ok") : s.origin === "human" ? tonePill("Edited by you", "info") : aiTag()}${s.flag ? `<span class="pill s-warn" title="Uncertain term">Check term: ${esc(s.flag)}</span>` : ""}</div></div>
        ${S.showOrig ? `<div class="meta" style="font-size:13px"><b>Original:</b> ${esc(s.original)}</div>` : ""}
        <div contenteditable="${can("project.edit") && !s.locked}" data-script="${s.id}" aria-label="Script paragraph ${i + 1}" role="textbox" aria-multiline="true">${esc(s.text)}</div>
        <div class="row" style="gap:6px">${["Shorten", "Simplify", "More professional", "Instructional tone"].map((a) => `<button class="btn sm ghost" data-act="rewrite" data-id="${s.id}" data-kind="${a}" ${s.locked ? "disabled" : ""}>${ic("sparkle", 13)} ${a}</button>`).join("")}<button class="btn sm ghost" data-act="lock" data-id="${s.id}">${s.locked ? "Unlock" : "Lock as approved"}</button></div></div>`).join("")}</div></div></div>
  <div style="display:flex;flex-direction:column;gap:12px"><div class="card pad"><div class="eyebrow">Scene properties</div><label class="f" style="margin-top:8px">Chapter title<input type="text" id="sceneTitle" data-scenetitle="${sel.id}" value="${esc(sel.title)}"></label>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:10px"><label class="f">Start<input type="text" id="sStart" value="${mmss(sel.start)}" readonly></label><label class="f">End<input type="text" id="sEnd" value="${mmss(sel.end)}" readonly></label></div>
    <div style="display:grid;gap:8px;margin-top:12px"><label class="check"><input type="checkbox" id="sZoom" ${sel.zoom ? "checked" : ""} data-act="sceneZoom"><span>Focus zoom on click</span></label><label class="check"><input type="checkbox" id="sRed" ${sel.redact ? "checked" : ""} data-act="sceneRedact"><span>Redact sensitive region<small>Detected: customer e-mail address</small></span></label></div>
    <div class="row" style="margin-top:12px"><button class="btn sm" data-act="split">Split scene</button><button class="btn sm" data-act="moveScene" data-dir="-1">Move up</button><button class="btn sm danger" data-act="delScene">Delete</button></div></div>
  <div class="card pad"><div class="eyebrow">Voiceover</div><div style="display:grid;gap:10px;margin-top:8px"><label class="f">Voice<select class="in" id="voice"><option>Aria · neutral, clear (en-GB)</option><option>Marco · warm (it-IT)</option><option>Élise · calm (fr-FR)</option></select></label><label class="f">Speed<input type="range" id="vspeed" min="80" max="120" value="100"></label><button class="btn sm" data-act="toast" data-msg="Narration regenerated for this scene (simulated).">${ic("sparkle", 13)} Regenerate narration</button><div class="meta">Voice cloning is disabled. It needs legal, privacy, security and employee-consent review first.</div></div></div>
  <div class="card pad"><div class="eyebrow">Branding</div><div class="meta" style="font-size:13px;margin-top:6px;display:grid;gap:4px"><span>Template: Retail store procedure</span><span>Intro and outro: EL Retail 2026</span><span>Watermark: Internal</span></div></div></div></div>`;
}

function tGuide(p) {
  const sel = p.steps.find((s) => s.id === S.step) || p.steps[0];
  const chapters = [...new Set(p.steps.map((s) => s.chapter))];
  return `<div class="editor"><nav class="card" style="padding:8px" aria-label="Guide outline"><div class="eyebrow" style="padding:8px">Outline</div>${chapters.map((c) => `<div style="padding:6px 8px 2px;font-weight:650;font-size:13px">${esc(c)}</div>${p.steps.filter((s) => s.chapter === c).map((s) => `<button class="scene ${s.id === sel.id ? "sel" : ""}" data-step="${s.id}"><span class="no">${p.steps.indexOf(s) + 1}</span><span style="font-size:13px">${esc(s.title)}</span></button>`).join("")}`).join("")}
    ${can("guide.edit") ? `<button class="btn sm" style="margin:8px" data-act="addStep">${ic("plus", 14)} Add step</button>` : ""}</nav>
  <div style="display:flex;flex-direction:column;gap:12px;min-width:0"><div class="card pad"><div class="row between"><div><span class="eyebrow">Standard operating procedure · v${p.version}</span><h2 class="sec-h" style="margin-top:4px">${esc(p.title)}</h2></div>${aiTag("AI draft · review required")}</div>
    <div class="callout tip" style="margin-top:12px"><b>Before you start:</b>&nbsp;Access to ${esc(p.system)} with your store role.</div></div>
    ${p.steps.map((s, i) => `<article class="stepcard ${s.id === sel.id ? "sel" : ""}" data-step="${s.id}"><span class="stepnum">${i + 1}</span><div style="display:flex;flex-direction:column;gap:10px;min-width:0">
      <div class="row between"><div contenteditable="${can("guide.edit")}" class="card-h" data-steptitle="${s.id}" role="textbox" aria-label="Step ${i + 1} title">${esc(s.title)}</div><div class="row" style="gap:6px">${s.origin === "human" ? tonePill("Edited", "info") : aiTag()}<button class="ts" data-go="project" data-id="${p.id}" data-tab="video" data-sceneid="${p.scenes[i].id}">${ic("video", 12)} ${mmss(s.sec)}</button></div></div>
      <div contenteditable="${can("guide.edit")}" data-stepbody="${s.id}" role="textbox" aria-multiline="true" aria-label="Step ${i + 1} instruction">${esc(s.instruction)}</div>
      <figure class="shot" style="margin:0" aria-label="${esc(s.alt)}"><span class="win"></span><span class="box" style="left:${s.mx - 6}%;top:${s.my - 8}%;width:20%;height:22%"></span><span class="marker" style="left:${s.mx + 12}%;top:${s.my - 14}%">${i + 1}</span>${i === 2 ? `<span class="blur" style="left:60%;top:62%;width:22%;height:12%" title="Blurred sensitive region"></span>` : ""}</figure>
      ${s.warning ? `<div class="callout warn"><b>Warning</b>&nbsp;${esc(s.warning)}</div>` : ""}${s.tip ? `<div class="callout tip"><b>Tip</b>&nbsp;${esc(s.tip)}</div>` : ""}</div></article>`).join("")}</div>
  <aside style="display:flex;flex-direction:column;gap:12px"><div class="card pad"><div class="eyebrow">Step ${p.steps.indexOf(sel) + 1} properties</div>
    <label class="f" style="margin-top:8px">Expected result<textarea id="stepExpect">${esc(sel.title)} is completed and visible in ${esc(p.system)}.</textarea></label>
    <label class="f" style="margin-top:8px">Alternative text<input type="text" id="stepAlt" value="${esc(sel.alt)}"></label>
    <div class="row" style="margin-top:10px">${["Marker", "Arrow", "Box", "Spotlight", "Blur"].map((t) => `<button class="btn sm" data-act="toast" data-msg="${t} added to the screenshot.">${t}</button>`).join("")}</div>
    <div class="row" style="margin-top:10px">${can("guide.edit") ? `<button class="btn sm" data-act="moveStep" data-dir="-1">Move up</button><button class="btn sm" data-act="moveStep" data-dir="1">Move down</button><button class="btn sm danger" data-act="delStep">Delete</button>` : ""}</div></div>
  <div class="card pad"><div class="eyebrow">${ic("sparkle", 13)} AI suggestions</div><div class="callout ai" style="margin-top:8px;flex-direction:column"><span>Step ${p.steps.indexOf(sel) + 1} mentions a threshold that differs by region. Add a regional note?</span><div class="row"><button class="btn sm" data-act="applySuggestion">Add note</button><button class="btn sm ghost" data-act="toast" data-msg="Suggestion dismissed.">Dismiss</button></div></div></div></aside></div>`;
}

function tKnowledge(p) {
  return `<div class="split"><article class="card pad article"><div class="row between"><span class="eyebrow">Knowledge article</span>${aiTag()}</div><h2 class="sec-h">${esc(p.title)}</h2><p>${esc(p.summary)}</p>
    <h3 class="card-h">Purpose</h3><p>Give ${esc(p.audience.toLowerCase())} one approved, current way to complete this process in ${esc(p.system)}.</p>
    <h3 class="card-h">Procedure</h3><ol>${p.steps.map((s) => `<li><b>${esc(s.title)}.</b> ${esc(s.instruction)} <button class="ts" data-go="project" data-id="${p.id}" data-tab="video" data-sceneid="${p.scenes[p.steps.indexOf(s)].id}">[${mmss(s.sec)}]</button></li>`).join("")}</ol>
    <h3 class="card-h">Frequently asked questions</h3>${p.steps.filter((s) => s.warning).map((s) => `<p><b>What if something goes wrong during “${esc(s.title.toLowerCase())}”?</b><br>${esc(s.warning)}</p>`).join("") || "<p class='meta'>No FAQs generated yet.</p>"}</article>
  <div class="card pad"><h3 class="card-h">Quiz draft</h3><p class="meta">AI-generated questions can't be published until reviewed.</p>${p.steps.slice(0, 2).map((s, i) => `<div class="para" style="margin-top:10px"><div class="row between"><span class="meta">Q${i + 1} · Single choice · Easy</span>${tonePill("Needs review", "warn")}</div><b>What is the correct next action after “${esc(s.title.toLowerCase())}”?</b><div class="meta">Source: Step ${i + 1} · ${mmss(s.sec)}</div></div>`).join("")}</div></div>`;
}

function tTrans(p) {
  const rows = TRANSLATIONS.filter((t) => t.pid === p.id);
  return rows.length ? `<div class="grid g3">${rows.map((t) => `<div class="card pad" ${t.lang === "ar" ? 'dir="rtl"' : ""}><div class="row between"><div class="card-h">${LANGS[t.lang]}</div>${tonePill(t.status, t.pct === 100 ? "ok" : "warn")}</div><div class="bar" style="margin:10px 0"><i style="width:${t.pct}%"></i></div><dl class="dl">${[["Video", t.video], ["Guide", t.guide], ["Captions", t.captions], ["Voiceover", t.voice], ["Approval", t.appr], ["Reviewer", t.reviewer]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${t.appr === "Pending" && can("translation.edit") ? `<button class="btn sm primary" style="margin-top:10px" data-act="toast" data-msg="${LANGS[t.lang]} sent for regional approval.">Send for regional approval</button>` : ""}</div>`).join("")}</div>`
    : `<div class="card">${empty("globe", "No translations yet", "Translations start once the source language is approved. Target languages: " + p.targets.map((c) => LANGS[c]).join(", ") + ".", "")}</div>`;
}

function tReview(p) {
  const cs = COMMENTS.filter((c) => c.pid === p.id);
  const canApprove = can("review.approve") && ["sme", "approval", "compliance"].includes(p.status);
  return `<div class="split"><div class="card pad"><div class="row between"><h3 class="card-h">Comments on version ${p.version}</h3><span class="meta">${openComments(p).length} open</span></div>
    <div style="margin-top:8px">${cs.length ? cs.map((c) => `<div class="comment" style="${c.resolved ? "opacity:.55" : ""}"><span class="avatar">${c.ini}</span><div style="flex:1"><div class="row" style="gap:8px"><b>${esc(c.author)}</b><span class="chip" style="padding:1px 8px">${esc(c.anchor)}</span><span class="meta">${rel(c.when)}</span>${c.resolved ? tonePill("Resolved", "ok") : ""}</div><p style="margin:4px 0">${esc(c.body)}</p>${!c.resolved ? `<button class="btn sm ghost" data-act="resolve" data-id="${c.id}">Resolve</button>` : ""}</div></div>`).join("") : empty("chat", "No comments yet", "Comment on a step or a moment in the video. Mention a colleague with @.", "")}</div>
    ${can("review.comment") ? `<div style="display:grid;gap:8px;margin-top:12px"><div class="row"><label class="f" style="flex:1">Anchor<select class="in" id="cAnchor">${["Whole project", ...p.steps.map((s, i) => "Step " + (i + 1)), ...p.scenes.map((s, i) => "Scene " + (i + 1) + " · " + mmss(s.start))].map((a) => `<option>${a}</option>`).join("")}</select></label></div><label class="f">Comment<textarea id="cBody" placeholder="e.g. @Amara the threshold in Step 3 differs for France"></textarea></label><button class="btn primary" data-act="comment" style="justify-self:start">Add comment</button></div>` : ""}</div>
  <div style="display:flex;flex-direction:column;gap:12px"><div class="card pad"><h3 class="card-h">Decision</h3><p class="meta">Approval applies to version ${p.version} only. Editing an approved version creates a new draft.</p>
    ${canApprove ? `<div style="display:grid;gap:10px"><label class="f">Justification<span class="hint">Required when requesting changes</span><textarea id="just"></textarea></label><div class="row"><button class="btn primary" data-act="approve">${ic("check", 16)} Approve v${p.version}</button><button class="btn danger" data-act="reject">Request changes</button></div></div>`
    : `<div class="callout tip">${p.status === "approved" || p.status === "published" ? `<b>Approved.</b>&nbsp;Version ${p.approvedV} was approved by ${esc(p.approver)}.` : ["ai", "creator", "changes", "draft"].includes(p.status) ? "<b>Not submitted yet.</b>&nbsp;The creator submits this for review." : `<b>Your role can't approve.</b>&nbsp;Switch to the Reviewer or Approver persona to decide.`}</div>`}</div>
  <div class="card pad"><h3 class="card-h">Workflow</h3><ol class="wf">${[["Creator review", "creator"], ["SME review", "sme"], ["Approval", "approval"], ["Publish", "published"]].map(([l, k], i, a) => { const order = ["ai", "creator", "changes", "sme", "compliance", "approval", "approved", "published"]; const cur = order.indexOf(p.status), me = order.indexOf(k); return `<li class="${cur > me || p.status === k && k === "published" ? "done" : cur === me || (k === "creator" && ["ai", "changes"].includes(p.status)) ? "on" : ""}">${l}</li>`; }).join("")}</ol></div></div></div>`;
}

function tPublish(p) {
  const pubs = PUBLICATIONS.filter((x) => x.pid === p.id);
  const ready = p.status === "approved" || p.status === "published";
  return `<div class="split"><div class="card pad" style="display:flex;flex-direction:column;gap:12px"><div class="row between"><h3 class="card-h">Publish version ${p.approvedV || p.version}</h3>${mockTag("Mock connectors · nothing is sent")}</div>
    ${!ready ? `<div class="callout warn"><b>Not approved yet.</b>&nbsp;Only an approved version can be published.</div>` : ""}
    <div class="checks">${DESTS.map((d) => `<label class="check" ${d.disabled ? 'style="opacity:.55"' : ""}><input type="checkbox" value="${d.key}" ${d.disabled ? "disabled" : ""} ${S.pubSel.includes(d.key) ? "checked" : ""} data-pub="${d.key}"><span>${d.label}<small>${esc(d.target)}</small></span></label>`).join("")}</div>
    <div class="grid g2"><label class="f">Audience<select class="in" id="pAud"><option>${esc(p.audience)}</option><option>All employees in workspace</option></select></label><label class="f">Language<select class="in" id="pLang"><option>${LANGS[p.lang]}</option>${TRANSLATIONS.filter((t) => t.pid === p.id && t.appr === "Approved").map((t) => `<option>${LANGS[t.lang]}</option>`).join("")}</select></label></div>
    <div style="display:grid;gap:8px"><label class="check"><input type="checkbox" id="pAck"><span>Require acknowledgment</span></label><label class="check"><input type="checkbox" id="pRep" checked><span>Replace previous version<small>v${p.publishedV || "–"} stays in version history</small></span></label><label class="check"><input type="checkbox" id="pWm" checked><span>Watermark “Internal”</span></label></div>
    <button class="btn primary" data-act="publish" ${ready ? "" : "disabled"} style="justify-self:start">${ic("send", 16)} Publish to ${S.pubSel.length} destination${S.pubSel.length === 1 ? "" : "s"}</button></div>
  <div class="card"><div class="pad"><h3 class="card-h">Publishing history</h3></div>${pubs.length ? `<ul class="list">${pubs.map((x) => `<li><div style="flex:1"><div class="t">${DESTS.find((d) => d.key === x.dest).label}</div><div class="meta">v${x.ver} · ${LANGS[x.lang]} · ${esc(x.by)} · ${rel(x.when)}</div></div>${mockTag()}</li>`).join("")}</ul>` : empty("send", "Not published yet", "Once approved, publish to SharePoint, Teams, Stream and other approved destinations.", "")}</div></div>`;
}

function tActivity(p) {
  const rows = S.audit.filter((a) => a[3] === p.title);
  return `<div class="card">${rows.length ? `<ul class="list">${rows.map((a) => `<li><span class="avatar" style="width:28px;height:28px;font-size:11px">${a[1].split(" ").map((w) => w[0]).join("")}</span><div style="flex:1"><div><b>${esc(a[1])}</b> · ${esc(a[2].toLowerCase())}${a[4] ? " on version " + a[4] : ""}</div><div class="meta">${rel(a[0])}</div></div>${a[5] === "denied" ? tonePill("Denied", "err") : ""}</li>`).join("")}</ul>` : empty("clock", "No activity yet", "Edits, comments, approvals and publications appear here.", "")}</div>`;
}

/* ---------- REVIEWS INBOX ---------- */
function vReviews() {
  const f = S.revFilter;
  let rows = REVIEWS.map((r) => ({ ...r, p: proj(r.pid) }));
  if (f === "mine") rows = rows.filter((r) => r.assignee === S.persona.id && r.status === "open");
  if (f === "overdue") rows = rows.filter((r) => r.due < 0 && r.status === "open");
  if (f === "changes") rows = rows.filter((r) => r.status === "changes");
  if (f === "done") rows = rows.filter((r) => r.status === "approved");
  return `<section><div><h1 class="page-title">Reviews</h1><p class="page-sub">Every decision is bound to a version and recorded in the audit history.</p></div>
  <div class="row">${[["mine", "Assigned to me"], ["all", "All"], ["overdue", "Overdue"], ["changes", "Changes requested"], ["done", "Completed"]].map(([k, l]) => `<button class="chip" aria-pressed="${f === k}" data-revf="${k}">${l}</button>`).join("")}</div>
  <div class="card">${rows.length ? `<ul class="list">${rows.map((r) => `<li class="clickable" data-go="project" data-id="${r.pid}" data-tab="review" tabindex="0">${thumb(r.p)}<div style="flex:1"><div class="t">${esc(r.p.title)}</div><div class="meta">${r.stage} · version ${r.ver} · assigned to ${esc(PERSONAS.find((x) => x.id === r.assignee).name)}</div></div>${r.status === "open" ? (r.due < 0 ? tonePill("Overdue " + -r.due + " d", "err") : tonePill("Due in " + r.due + " d", "warn")) : r.status === "changes" ? tonePill("Changes requested", "err") : tonePill("Approved", "ok")}</li>`).join("")}</ul>`
    : empty("check", "Your review inbox is clear", "New review requests appear here with their stage and due date. Switch persona to Reviewer to see assigned items.", `<button class="chip" data-revf="all">Show all reviews</button>`)}</div></section>`;
}

/* ---------- PUBLISHING CENTER ---------- */
function vPublishing() {
  const ready = S.projects.filter((p) => p.status === "approved");
  return `<section><div class="row between"><div><h1 class="page-title">Publishing</h1><p class="page-sub">Release approved versions to enterprise destinations.</p></div>${mockTag("All connectors are mocks in this prototype")}</div>
  <div class="grid g4">${DESTS.map((d) => `<div class="card kpi"><span class="card-h" style="font-size:14px">${d.label}</span><span class="meta">${esc(d.target)}</span>${d.disabled ? tonePill("Disabled by policy", "neutral") : tonePill("Mock connector ready", "warn")}</div>`).join("")}</div>
  <div class="card"><div class="pad"><h3 class="card-h">Ready to publish</h3></div>${ready.length ? `<ul class="list">${ready.map((p) => `<li class="clickable" data-go="project" data-id="${p.id}" data-tab="publishing" tabindex="0">${thumb(p)}<div style="flex:1"><div class="t">${esc(p.title)}</div><div class="meta">v${p.approvedV} approved by ${esc(p.approver)}</div></div><span class="btn sm primary">Publish</span></li>`).join("")}</ul>` : empty("send", "Nothing waiting to publish", "Approved content appears here. Publishing is never automatic.", "")}</div>
  <div class="card"><div class="pad"><h3 class="card-h">Recent publications</h3></div><div class="tablewrap"><table><thead><tr><th>Content</th><th>Version</th><th>Destination</th><th>Language</th><th>By</th><th>When</th></tr></thead><tbody>${PUBLICATIONS.map((x) => `<tr><td>${esc(proj(x.pid).title)}</td><td class="num">v${x.ver}</td><td>${DESTS.find((d) => d.key === x.dest).label} ${mockTag()}</td><td>${LANGS[x.lang]}</td><td>${esc(x.by)}</td><td class="meta">${rel(x.when)}</td></tr>`).join("")}</tbody></table></div></div></section>`;
}

/* ---------- KNOWLEDGE HUB ---------- */
function searchIndex(q) {
  const terms = q.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !["how", "the", "what", "when", "for", "and", "does", "can"].includes(t));
  const hits = [];
  S.projects.filter((p) => p.status === "published" || p.status === "approved" || p.publishedV).forEach((p) => p.steps.forEach((s, i) => {
    const hay = (s.title + " " + s.instruction + " " + (s.warning || "") + " " + p.title + " " + p.system).toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    if (score) hits.push({ p, s, i, score: score / terms.length });
  }));
  return { terms, hits: hits.sort((a, b) => b.score - a.score).slice(0, 6) };
}
function hl(text, terms) { let t = esc(text); terms.forEach((w) => { t = t.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>"); }); return t; }
function vHub() {
  const q = S.q;
  const r = q ? searchIndex(q) : null;
  const top = r && r.hits[0];
  const insufficient = r && (!top || top.score < 0.5);
  return `<section><div class="hubhead"><span class="eyebrow">Knowledge Hub</span><h1 class="page-title" style="font-size:34px">What do you need to know?</h1><p class="page-sub">Answers come only from approved content you're allowed to see, with the exact chapter and step.</p>
  <form class="bigsearch" data-act="searchForm" role="search">${ic("hub", 22)}<input type="search" id="hubq" aria-label="Search approved knowledge" placeholder="Ask a question or search a process…" value="${esc(q)}"><button class="btn primary" type="submit">Search</button></form>
  <div class="row" style="margin-top:12px">${SUGGESTED.map((s) => `<button class="chip" data-q="${esc(s)}" data-go="hub">${esc(s)}</button>`).join("")}</div></div>
  ${!r ? `<div class="grid g3">${[["Browse by function", ["Retail Operations", "Finance", "Human Resources", "Supply Chain", "IT & Digital"]], ["Popular topics", ["Store opening", "Access requests", "Returns", "Month-end close", "Carrier claims"]], ["Browse by language", ["English", "Français", "Italiano", "日本語", "العربية"]]].map(([t, xs]) => `<div class="card pad"><h3 class="card-h">${t}</h3><div class="row" style="margin-top:10px">${xs.map((x) => `<button class="chip" data-q="${esc(x)}" data-go="hub">${esc(x)}</button>`).join("")}</div></div>`).join("")}</div>`
  : `<div class="split"><div style="display:flex;flex-direction:column;gap:12px"><div class="card pad answer" aria-live="polite"><div class="row between"><span class="ai-label">${ic("sparkle", 12)} AI answer</span>${insufficient ? tonePill("Not enough evidence", "warn") : tonePill("High confidence · " + Math.round(top.score * 100) + "% term match", "ok")}</div>
    ${insufficient ? `<p>I couldn't find approved content that answers <b>“${esc(q)}”</b>. Rather than guess, I've listed the closest matches. You can ask the content owner or report a gap.</p>`
    : `<p style="font-size:15px">${esc(top.s.instruction)} <sup class="srcn" style="display:inline-grid">1</sup>${top.s.warning ? ` <b>Important:</b> ${esc(top.s.warning)}` : ""}${r.hits[1] && r.hits[1].p === top.p ? ` Next, ${esc(r.hits[1].s.title.toLowerCase())}. <sup class="srcn" style="display:inline-grid">2</sup>` : ""}</p>
    <div style="display:grid;gap:6px">${r.hits.slice(0, 2).map((h, n) => `<button class="src" data-go="project" data-id="${h.p.id}" data-tab="video" data-sceneid="${h.p.scenes[h.i].id}"><span class="srcn">${n + 1}</span><span style="flex:1"><b>${esc(h.p.title)}</b> · Step ${h.i + 1}: ${esc(h.s.title)}<span class="meta" style="display:block">v${h.p.publishedV || h.p.approvedV} approved · reviewed ${rel(h.p.updated)} · ${freshness(h.p)[0]}</span></span><span class="ts">${ic("play", 11)} ${mmss(h.s.sec)}</span></button>`).join("")}</div>`}
    <p class="meta" style="margin:12px 0 0">AI-generated answer based on approved enterprise knowledge. Verify critical operational, safety, financial, legal, or compliance decisions with the designated content owner.</p>
    <div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="toast" data-msg="Thanks. Feedback recorded.">Helpful</button><button class="btn sm ghost" data-act="toast" data-msg="Reported. The content owner will be notified.">${ic("flag", 13)} Report an incorrect answer</button></div></div>
    <div class="card"><div class="pad row between"><h3 class="card-h">${r.hits.length} matching results</h3><span class="meta">Only approved content you can access</span></div>${r.hits.length ? `<ul class="list">${r.hits.map((h) => `<li class="clickable" data-go="project" data-id="${h.p.id}" data-tab="guide" data-stepid="${h.s.id}" tabindex="0" style="align-items:flex-start">${thumb(h.p, 72)}<div style="flex:1;min-width:0"><div class="row" style="gap:8px"><span class="t">${esc(h.p.title)}</span>${pill(h.p.status)}${cls(h.p.cls)}</div><div class="meta">Guide step ${h.i + 1} · ${esc(h.s.chapter)} · video ${mmss(h.s.sec)}</div><p style="margin:4px 0 0;font-size:13.5px">${hl(h.s.instruction, r.terms)}</p><div class="meta">${esc(h.p.fn)} · ${LANGS[h.p.lang]} · Owner ${esc(h.p.owner)}</div></div><span class="meta">${Math.round(h.score * 100)}%</span></li>`).join("")}</ul>` : empty("hub", "No approved content matches", "Try different words, browse by function, or ask a content owner to create it.", "")}</div></div>
  <div class="card pad"><h3 class="card-h">Filters</h3>${[["Business function", ["Retail Operations", "Finance", "IT & Digital"]], ["Content type", ["Video", "Guide", "Article"]], ["Language", ["English", "French", "Italian"]], ["Freshness", ["Current", "Review due soon"]]].map(([t, xs]) => `<div style="margin-top:12px"><div class="meta" style="font-weight:600">${t}</div>${xs.map((x, k) => `<label class="row" style="gap:8px;margin-top:4px"><input type="checkbox" id="f_${t}_${k}" checked> ${x}</label>`).join("")}</div>`).join("")}</div></div>`}</section>`;
}

/* ---------- ANALYTICS ---------- */
function vAnalytics() {
  const months = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"], views = [2100, 2600, 2400, 3300, 3900, 4600];
  const max = 5000, W = 520, H = 180, x = (i) => 40 + i * ((W - 60) / 5), y = (v) => H - 24 - (v / max) * (H - 44);
  const path = views.map((v, i) => (i ? "L" : "M") + x(i) + " " + y(v)).join(" ");
  const fn = [["Retail Operations", 64], ["IT & Digital", 41], ["Human Resources", 38], ["Finance", 29], ["Supply Chain", 24], ["Manufacturing", 22]];
  return `<section><div class="row between"><div><h1 class="page-title">Analytics</h1><p class="page-sub">Content effectiveness and adoption. Aggregated, with no individual tracking or productivity scoring.</p></div><span class="meta">Last 6 months · ${esc(S.ws)}</span></div>
  <div class="grid g4">${[["Unique viewers", "8,214"], ["Total views", "41,930"], ["Completion rate", "73%"], ["Search success", "81%"], ["Failed searches", "412"], ["Content reuse", "2.7×"], ["Average content age", "142 days"], ["Estimated time saved", "1,460 h"]].map(([l, v]) => `<div class="card kpi"><span class="meta">${l}</span><span class="v">${v}</span></div>`).join("")}</div>
  <div class="grid g2"><figure class="card pad" style="margin:0"><figcaption class="card-h">Usage trend</figcaption><svg class="chartsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly views rose from 2,100 in May to 4,600 in October">${[0, 2500, 5000].map((v) => `<line class="grid-l" x1="40" x2="${W - 20}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${y(v) + 4}">${v / 1000}k</text>`).join("")}<path d="${path} L${x(5)} ${y(0)} L${x(0)} ${y(0)}Z" fill="var(--action)" opacity=".1"/><path d="${path}" fill="none" stroke="var(--action)" stroke-width="2.5"/>${views.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === 5 ? 5 : 3}" fill="var(--action)"/><text x="${x(i) - 10}" y="${H - 6}">${months[i]}</text>`).join("")}<text x="${x(5) - 30}" y="${y(4600) - 10}" style="fill:var(--text);font-weight:600">4,600</text></svg><p class="meta">Views more than doubled since May, driven by Retail store procedures.</p></figure>
  <figure class="card pad" style="margin:0"><figcaption class="card-h">Content by function</figcaption><div style="margin-top:10px">${fn.map(([l, v]) => `<div class="hbar"><span>${l}</span><span class="track2"><i style="width:${(v / 64) * 100}%"></i></span><span class="val">${v}</span></div>`).join("")}</div><p class="meta">Retail Operations has the most published items (64).</p></figure>
  <figure class="card pad" style="margin:0"><figcaption class="card-h">Search gaps</figcaption><div class="tablewrap"><table><thead><tr><th>Query with no good answer</th><th class="num">Searches</th></tr></thead><tbody>${[["Lens remake approval", 86], ["Store closing cash count", 71], ["Expense card limit", 54], ["Contact lens trial returns", 39]].map(([q, n]) => `<tr><td>${q}</td><td class="num">${n}</td></tr>`).join("")}</tbody></table></div></figure>
  <figure class="card pad" style="margin:0"><figcaption class="card-h">Drop-off by chapter · Retail Store Opening Checklist</figcaption><div style="margin-top:10px">${proj("p1").scenes.map((s, i) => `<div class="hbar"><span>${esc(s.title.slice(0, 18))}</span><span class="track2"><i style="width:${100 - i * 9}%;background:var(--teal)"></i></span><span class="val">${100 - i * 9}%</span></div>`).join("")}</div></figure></div></section>`;
}

/* ---------- OTHER PAGES ---------- */
function vTranslations() {
  return `<section><div><h1 class="page-title">Translations</h1><p class="page-sub">Machine translation → terminology validation → regional review → approval → localized rendering → publication.</p></div>
  <div class="card pad"><h3 class="card-h">Protected terms</h3><div class="row" style="margin-top:8px">${["Store Portal", "POS", "ServiceNow", "Leonardo", "Knowzy", "Varilux", "Ray-Ban"].map((t) => `<span class="chip">${ic("lock", 12)} ${t}</span>`).join("")}</div></div>
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Content</th><th>Language</th><th>Status</th><th>Completion</th><th>Reviewer</th><th>Approval</th></tr></thead><tbody>${TRANSLATIONS.map((t) => `<tr class="clickable" data-go="project" data-id="${t.pid}" data-tab="translations" tabindex="0"><td>${esc(proj(t.pid).title)}</td><td ${t.lang === "ar" ? 'dir="rtl"' : ""}>${LANGS[t.lang]}</td><td>${tonePill(t.status, t.pct === 100 ? "ok" : "warn")}</td><td class="num">${t.pct}%</td><td>${esc(t.reviewer)}</td><td>${t.appr}</td></tr>`).join("")}</tbody></table></div></div></section>`;
}
function vTemplates() {
  return `<section><div><h1 class="page-title">Templates</h1><p class="page-sub">Governed starting points with outputs, approval flows and branding built in.</p></div><div class="grid g3">${TEMPLATES.map(([n, fn, o, a], i) => `<div class="card tplcard"><div class="tplart" style="background:linear-gradient(135deg,hsl(${200 + i * 9} 60% 24%),hsl(${190 + i * 9} 80% 44%))"></div><div class="pad" style="display:grid;gap:4px"><div class="card-h">${n}</div><div class="meta">${fn} · ${o}</div><div class="meta">Approval: ${a}</div><button class="btn sm" style="justify-self:start;margin-top:8px" data-act="useTemplate" data-tpl="${n}">Use template</button></div></div>`).join("")}</div></section>`;
}
function vAudit() {
  if (!can("audit.view")) return denied("audit.view");
  return `<section><div class="row between"><div><h1 class="page-title">Audit history</h1><p class="page-sub">Immutable, append-only records. Content text is never stored in audit messages.</p></div><button class="btn" data-act="toast" data-msg="Audit export prepared (simulated CSV).">Export</button></div>
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Event ID</th><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Version</th><th>Outcome</th><th>Correlation</th></tr></thead><tbody>${S.audit.map((a, i) => `<tr><td class="num meta">evt_${(9821 - i).toString(16)}</td><td class="meta">${rel(a[0])}</td><td>${esc(a[1])}</td><td>${esc(a[2])}</td><td>${esc(a[3])}</td><td class="num">${a[4] ? "v" + a[4] : "–"}</td><td>${a[5] === "denied" ? tonePill("Denied", "err") : tonePill("Success", "ok")}</td><td class="num meta">c-${(48211 + i * 37).toString(36)}</td></tr>`).join("")}</tbody></table></div></div></section>`;
}
function denied(perm) {
  return `<section><div class="card">${empty("lock", "You don't have access to this area", `It needs the <code>${perm}</code> permission. Ask your workspace administrator, or switch to an administrator persona in this demo.`, `<button class="btn" data-go="home">Back to Home</button>`)}</div></section>`;
}
function vBrand() {
  if (!can("brand.manage")) return denied("brand.manage");
  return `<section><div><h1 class="page-title">Brand Center</h1><p class="page-sub">Approved, versioned brand assets for videos and documents.</p></div><div class="grid g3">${[["Product mark", "Placeholder · awaiting approved corporate asset", "warn"], ["Colour theme", "EL Enterprise 2026 · v4 approved", "ok"], ["Intro sequence", "EL Retail 2026 · v2 approved", "ok"], ["Watermarks", "Internal, Confidential · approved", "ok"], ["Document header", "SOP header · v3 in review", "warn"], ["Voice settings", "Aria, Marco, Élise · approved", "ok"]].map(([n, d, t]) => `<div class="card pad"><div class="card-h">${n}</div><div class="meta" style="margin:4px 0 10px">${d}</div>${tonePill(t === "ok" ? "Approved" : "Needs approval", t)}</div>`).join("")}</div></section>`;
}
function vAdmin() {
  if (!can("workspace.manage")) return denied("workspace.manage");
  return `<section><div><h1 class="page-title">Administration</h1><p class="page-sub">${esc(S.ws)}</p></div><div class="grid g2">
  <div class="card"><div class="pad"><h3 class="card-h">Members and roles</h3></div><div class="tablewrap"><table><thead><tr><th>Member</th><th>Roles</th></tr></thead><tbody>${PERSONAS.map((p) => `<tr><td>${esc(p.name)}<div class="meta">${esc(p.title)}</div></td><td>${esc(p.label)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card pad"><h3 class="card-h">Policies</h3><dl class="dl" style="margin-top:8px">${[["Default classification", "Internal"], ["Data region", "EU (West Europe)"], ["Retention", "7 years after archive"], ["Review reminder", "30 days before due, escalate at 14 days overdue"], ["AI provider", "Demo mode (mock). Azure OpenAI configured per region"], ["Public portal", "Disabled"], ["Voice cloning", "Disabled, needs consent review"]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div></div></section>`;
}
function vSimple(kind) {
  const m = { help: ["Help and Learning", "Short videos and guides on using EL Knowledge Studio, made with EL Knowledge Studio.", ["Record your first process", "Write instructions people follow", "How review and approval work", "Responsible AI in Knowledge Studio"]],
    feedback: ["Feedback", "Tell the product team what works and what doesn't. Feedback is anonymous unless you choose to share your name.", []],
    settings: ["Settings", "Personal preferences for this device.", []] }[kind];
  return `<section style="max-width:880px"><div><h1 class="page-title">${m[0]}</h1><p class="page-sub">${m[1]}</p></div>${kind === "help" ? `<div class="grid g2">${m[2].map((t) => `<div class="card pad row"><span class="thumb"></span><div><div class="t">${t}</div><div class="meta">3 min video · guide</div></div></div>`).join("")}</div>`
  : kind === "feedback" ? `<form class="card pad" data-act="feedbackForm" style="display:grid;gap:12px"><label class="f">What were you trying to do?<input type="text" id="fb1"></label><label class="f">What happened?<textarea id="fb2"></textarea></label><button class="btn primary" type="submit" style="justify-self:start">Send feedback</button></form>`
  : `<div class="card pad" style="display:grid;gap:12px"><label class="f">Interface language<select class="in" id="uiLang">${Object.values(LANGS).map((l) => `<option>${l}</option>`).join("")}</select><span class="hint">Translations other than English need professional language review before production.</span></label><label class="f">Time zone<select class="in" id="tz"><option>Europe/Rome</option><option>Europe/Paris</option><option>Asia/Tokyo</option></select></label><label class="check"><input type="checkbox" id="rm"><span>Reduce motion</span></label></div>`}</section>`;
}
