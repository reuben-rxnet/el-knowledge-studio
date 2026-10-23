# Responsible AI

| Principle | How the product applies it |
| --- | --- |
| Transparency | Every AI output carries an "AI generated" or "AI-edited" label. The active provider is named in the UI |
| Human review | AI drafts can't be published. Publishing requires an approved version, and approval requires SME review then an approver |
| No silent replacement | Script paragraphs can be locked as approved text. AI rewrites are refused on locked text |
| Source traceability | Every guide step keeps a source timestamp. Grounded answers cite steps and link to the exact video chapter |
| Insufficient evidence | The answer service returns "not enough evidence" instead of guessing. Uncited answers are discarded |
| Terminology | Protected terms (system and product names) are passed to every prompt, and rewrites that drop one are rejected |
| Prompt-injection resistance | Uploaded content is wrapped in `<source>` tags and declared as data in versioned system prompts |
| Output validation | Every AI response is parsed against a strict schema. Invalid output is never stored, and the job is marked for manual attention |
| Data minimisation | Highly Confidential and Restricted content is never sent to an external model. External AI is blocked until a data-processing approval is recorded |
| Sensitive information | Detected regions are flagged and blurred, and redaction can be toggled per scene |
| Feedback | Users can rate answers or report incorrect ones. Reports feed the Analytics "search gaps" view |

## Explicitly out of scope by design

No autonomous publication, employee performance scoring, emotion or sentiment inference, hidden monitoring, facial recognition, or voice cloning (the feature flag is off and needs legal, privacy, security and consent review). The recorder captures only the surface the user selects in the browser's picker, shows a persistent indicator, can be paused or stopped at any time, and never logs keystrokes or form values. Analytics are aggregated and describe content, not people.

## AI review flags (Phase 1)

The model never changes the procedure, even when the source looks wrong. Instead it returns **review flags** on source statements: risky (could cause harm, downtime or a security issue, for example "ignore the error"), ambiguous, typo, missing information, or contradiction. Flags appear on the Review tab and on the affected guide steps. A person resolves or dismisses each one with a note, which is added to the comments and the audit history. **Approval is blocked while any risky or contradictory flag is open**, and quiz questions that test a flagged statement are removed automatically. The AI also suggests a title, business function, audience and classification; none is applied until the owner clicks Apply, and a classification change is audited with the AI's reason.
