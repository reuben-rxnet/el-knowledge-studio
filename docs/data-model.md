# Data model

Schema: `prisma/schema.prisma`. All IDs are CUIDs. Enumerations are strings validated in `src/lib/domain` (portable across SQLite and PostgreSQL).

## Implemented models

| Model | Purpose |
| --- | --- |
| User, Workspace, WorkspaceMembership | Identity and access. Roles are comma-separated keys per membership |
| Project | Content project with metadata, classification, freshness, version pointers, soft delete |
| ProjectVersion | Version history with status per version |
| SourceAsset | Uploaded or recorded source (metadata, checksum, scan status, region-aware storage key) |
| ProcessingJob | ContentGenerationJob state, correlation ID, idempotency flag |
| Scene, ScriptSegment | Video structure and synchronized script (original transcript kept) |
| GuideStep, FaqItem | Structured guide and FAQ |
| Comment | Anchored to project, step or scene, with version |
| ReviewRequest | Stage, assignee and the exact version under review. Decisions are stored on the request |
| PublishingJob | Destination, target, language, `simulated` flag |
| TranslationProject | Per-language localization status |
| Template | Governed templates |
| AuditEvent | Append-only audit record |
| Notification, SearchFeedback, FeatureFlag | Supporting records |

Indexes cover workspace + status, workspace + updatedAt, assignee + status, and audit by workspace and time.

## Planned (from the full brief, not yet modelled)

Group, Role and Permission tables (roles are code-defined today), Track/TimelineItem, Screenshot/Annotation/Redaction as separate entities (redaction is a scene flag today), KnowledgeArticle (generated on read today), Quiz/QuizQuestion, TranslationSegment, TerminologyEntry, Approval as a separate entity, PublishingDestination, BrandKit, SearchDocument, ContentView/AnalyticsEvent, ProcessingStage rows, RetentionPolicy, ClassificationPolicy (code-defined today) and IntegrationConnection.
