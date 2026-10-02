# Course badges and the teacher roster

Badges recognize designated activities after instructor review. They are separate from grade publication. A normal grading sweep must never issue a badge or send an email.

The shared student roster tool reads student JSON records and verifies direct collaborators. It writes only a teacher-side aggregate at roster/students.json when execution is explicitly requested. Source values remain distinct arrays, including school and personal emails, PC numbers and rooms. Source provenance and identity holds are retained. Refreshing the roster preserves existing award links and delivery state.

Canvas's exported CSV remains the roster used by existing grade integrations. The aggregate supplements it; it does not replace it. A current Canvas student JSON cache can be supplied to the roster tool when an old CSV is incomplete.

## Roster tool

```sh
SECTION=0000 GRADE_OWNER=COURSE-ORG WORKSPACE_PREFIX=student-course-0000- node tools/sync-student-roster.mjs
```

The default is a dry run. Add execute to write the local aggregate. The deployment's course.config.json must identify its teachers so they are excluded from student collaborator checks. Snapshots for offline tests contain repository name, student JSON, direct collaborators and a workspace flag. They must remain private.

Reconciliation also requires corroboration from individual Canvas submissions; shared group links cannot prove individual ownership. Original values remain in observedFields, while canonical identity and delivery contacts are derived from the owned workspace and matched Canvas student. Uncertain sources remain quarantined rather than being merged by a copied student number.

Every contributing repository must have a single nonteacher collaborator matching the workspace's verified account. Repository suffixes and declared GitHub names are observations, not proof of ownership. Shared accounts, conflicting numbers, inaccessible sources and ambiguous Canvas joins hold delivery.

## Badge policy

Each deployment can keep its explicitly approved badge criteria in grader/badges.json:

```json
{
  "schemaVersion": 1,
  "course": "course",
  "monogram": "COURSE",
  "section": "0000",
  "org": "COURSE-ORG",
  "badges": [{
    "id": "builds-with-ai",
    "version": 1,
    "title": "Builds with AI",
    "description": "Explains and documents the work behind a project.",
    "term": "finals",
    "activityIds": ["m8a9"],
    "minimumPercent": 75,
    "policyStatus": "approved",
    "activities": [{
      "id": "m8a9",
      "title": "Builds with AI",
      "description": "Documents AI usage, corrections and personal contributions with commit-linked evidence."
    }]
  }]
}
```

The confirmed threshold is 75 percent. Activity titles and descriptions explain the assessed work on the badge class and certificate page, without publishing individual grades or private evidence.

A joint badge names multiple activities and requires the threshold on each. Separate badges have separate identifiers. An unapproved policy holds candidates. Points and review requirements come from assignments.json, so the award policy does not duplicate grade totals or bypass the review gate.

AI activities require a reviewed aiScore. A proposed model score is never an award decision. Manual activities use instructor grades imported from Canvas. The threshold uses the unrounded reviewed value.

## Evidence and delivery

A badge graded from a declared deliverable should use linkScope repo when its rubric also needs surrounding code or README evidence. The finals source tool pins the declared deliverable first, then the linked file and README, while preserving the deadline snapshot and deliverable history.

An instructor-approved manifest crosses from the private course records into the public issuer. The issuer must validate recipient and badge identity, preserve issue dates and URLs, and report historical awards requiring reconciliation. The delivery step saves stable certificate links in the private roster, writes a workspace receipt and emails the approved contact addresses only after checking the public certificate belongs to the intended recipient.

Public certificates and emailed receipts are separate from grading feedback. Instructor-only scores, suspicions and notes must never enter them. Hosted Open Badges assertions provide issuer-hosted verification; they must not be described as cryptographically signed credentials.

Read the deployment's private operations runbook for sender setup, approval, publication and delivery. This public template carries no student roster or mail credentials.
