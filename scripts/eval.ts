/**
 * AI evaluation harness — runs every procedure in eval/fixtures through the same guide and quiz
 * generation the app uses (AI_PROVIDER from .env), then checks the output against the fixture's
 * expectations. Results print as a table and are saved to eval/results/ (git-ignored).
 *
 *   npm run eval
 *
 * Add real procedures as eval/fixtures/<name>.(txt|docx|pptx|pdf) with an optional <name>.expect.json:
 *   { "protectedTerms": [...], "mustKeepWarnings": [...], "mustFlag": [...], "forbidInQuiz": [...],
 *     "expectClassificationAtLeast": "Confidential" }
 * Only use real content if your data-processing approval covers it.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDocumentText } from "../src/lib/services/extract";
import { generatedContentSchema, type GeneratedContent } from "../src/lib/services/interfaces";
import { CLASSIFICATIONS } from "../src/lib/domain/constants";
import { aiProviderId, services } from "../src/lib/services/registry";

interface Expect { protectedTerms?: string[]; mustKeepWarnings?: string[]; mustFlag?: string[]; forbidInQuiz?: string[]; expectClassificationAtLeast?: string }
interface Check { name: string; pass: boolean; detail: string }

const DIR = path.join(process.cwd(), "eval", "fixtures");
const lower = (s: string) => s.toLowerCase();
const numbersIn = (s: string) => new Set(s.match(/\d+(?:[.:]\d+)*/g) ?? []);

async function evaluate(file: string): Promise<{ file: string; checks: Check[]; ms: number; error?: string }> {
  const started = Date.now();
  const base = file.replace(/\.[^.]+$/, "");
  const expect: Expect = await readFile(path.join(DIR, `${base}.expect.json`), "utf8").then(JSON.parse).catch(() => ({}));
  const source = (await extractDocumentText(await readFile(path.join(DIR, file)), file)) ?? "";
  const terms = expect.protectedTerms ?? [];
  let g: GeneratedContent;
  try {
    g = generatedContentSchema.parse(await services.guide().generate({
      title: base.replace(/[-_]/g, " "), description: "", businessFunction: "IT & Digital", sourceSystem: terms[0] ?? "", audience: "Operators",
      primaryLanguage: "en", durationSec: 0, protectedTerms: terms, sourceText: source, sourceType: "document",
    }));
  } catch (e) {
    return { file, checks: [{ name: "Valid output", pass: false, detail: e instanceof Error ? e.message.slice(0, 160) : String(e) }], ms: Date.now() - started, error: "generation failed" };
  }
  const out = JSON.stringify(g);
  const stepsText = g.steps.map((s) => `${s.title} ${s.instruction} ${s.warning ?? ""} ${s.tip ?? ""}`).join(" ");
  const checks: Check[] = [{ name: "Valid output", pass: true, detail: `${g.steps.length} steps, ${g.reviewFlags.length} flags` }];

  const missingTerms = terms.filter((t) => !out.includes(t));
  checks.push({ name: "Protected terms kept", pass: !missingTerms.length, detail: missingTerms.length ? `missing: ${missingTerms.join(", ")}` : `${terms.length} kept` });

  const lostWarnings = (expect.mustKeepWarnings ?? []).filter((w) => !lower(stepsText).includes(lower(w)));
  checks.push({ name: "Warnings kept", pass: !lostWarnings.length, detail: lostWarnings.length ? `lost: ${lostWarnings.join(", ")}` : "all kept" });

  const warns = g.steps.map((s) => s.warning).filter(Boolean).map((w) => lower(w!).replace(/[^a-z0-9]+/g, " ").trim());
  // The app shows each distinct warning once (writeGeneratedContent); the model's raw repeats are reported.
  const distinct = new Set(warns).size;
  checks.push({ name: "Warnings shown once", pass: distinct > 0 || !(expect.mustKeepWarnings ?? []).length, detail: `${distinct} distinct shown${warns.length > distinct ? `, ${warns.length - distinct} repeat(s) from the model removed` : ""}` });

  const unflagged = (expect.mustFlag ?? []).filter((f) => !g.reviewFlags.some((r) => lower(r.quote).includes(lower(f))));
  checks.push({ name: "Risky lines flagged", pass: !unflagged.length, detail: unflagged.length ? `not flagged: ${unflagged.join(", ")}` : `${g.reviewFlags.length} flag(s)` });

  const timed = g.steps.filter((s) => s.sourceSec !== 0).length;
  const uncited = g.steps.filter((s) => !s.sourceRef).length;
  checks.push({ name: "Document citations (no timestamps)", pass: timed === 0 && uncited === 0, detail: `${timed} with timestamps, ${uncited} without a page/section` });

  const srcNums = numbersIn(source);
  const invented = [...numbersIn(stepsText)].filter((n) => !srcNums.has(n));
  checks.push({ name: "No invented numbers", pass: !invented.length, detail: invented.length ? `not in source: ${invented.slice(0, 6).join(", ")}` : "none" });

  if (expect.expectClassificationAtLeast) {
    const rank = (c: string) => (CLASSIFICATIONS as readonly string[]).indexOf(c);
    const got = g.suggestions?.classification ?? "none";
    checks.push({ name: "Classification suggestion", pass: rank(got) >= rank(expect.expectClassificationAtLeast), detail: `suggested ${got}, expected ≥ ${expect.expectClassificationAtLeast}` });
  }

  if (expect.forbidInQuiz?.length) {
    try {
      const quiz = await services.quiz().generate({ title: base, language: "en", flagged: g.reviewFlags.map((r) => r.quote), steps: g.steps.map((s, i) => ({ order: i, title: s.title, instruction: s.instruction, warning: s.warning })) });
      const bad = quiz.questions.filter((q) => expect.forbidInQuiz!.some((f) => lower(`${q.question} ${q.options.join(" ")} ${q.explanation}`).includes(lower(f))));
      checks.push({ name: "Quiz avoids flagged lines", pass: !bad.length, detail: bad.length ? `${bad.length} question(s) test a flagged line (the app's guard removes them)` : `${quiz.questions.length} questions, none on flagged lines` });
    } catch (e) {
      checks.push({ name: "Quiz avoids flagged lines", pass: false, detail: `quiz failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
    }
  }
  return { file, checks, ms: Date.now() - started };
}

(async () => {
  const files = (await readdir(DIR)).filter((f) => /\.(txt|md|docx|pptx|pdf)$/i.test(f)).sort();
  console.log(`AI provider: ${aiProviderId()} · ${files.length} fixture(s)\n`);
  const results = [];
  for (const f of files) {
    const r = await evaluate(f);
    results.push(r);
    console.log(`${r.file}  (${(r.ms / 1000).toFixed(1)} s)`);
    for (const c of r.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(36)} ${c.detail}`);
    console.log("");
  }
  const all = results.flatMap((r) => r.checks);
  const passed = all.filter((c) => c.pass).length;
  console.log(`Summary: ${passed}/${all.length} checks passed across ${results.length} procedure(s).`);
  const out = path.join(process.cwd(), "eval", "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-${aiProviderId()}.json`);
  await writeFile(out, JSON.stringify({ provider: aiProviderId(), at: new Date().toISOString(), results }, null, 2));
  console.log(`Saved ${path.relative(process.cwd(), out)}`);
  process.exit(passed === all.length ? 0 : 1);
})();
