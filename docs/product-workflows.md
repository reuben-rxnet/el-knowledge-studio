# Product workflows

## Create → publish

1. **Create**: record a process (browser screen picker) or upload a file. The wizard captures outputs, context, classification, languages, destinations and template.
2. **Process**: the 15-stage ContentGenerationJob produces chapters, script, guide steps, FAQ and machine translations. Everything is labelled AI generated.
3. **Edit**: the creator refines the script (with AI rewrites and locking) and the guide. Each edit is audited.
4. **Review**: the creator submits. The SME is assigned and notified, and comments are anchored to steps or scenes.
5. **Approve**: the SME approves, then the approver approves that exact version. Requesting changes needs a justification.
6. **Publish**: the publisher chooses destinations allowed by the classification. Mock connectors report "simulated".
7. **Discover**: consumers search the Knowledge Hub and get grounded answers linking to the exact chapter.
8. **Maintain**: freshness status follows the review date. Editing approved content creates a new draft version.

## Status model

Draft → Processing → AI generated → (Creator review) → SME review → Approval pending → Approved → Published, with Changes requested at either review stage. Expired and Archived are planned freshness transitions.
