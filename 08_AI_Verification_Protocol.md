#AI Verification Protocol - TDD Enabled

###Purpose

To enforce a strict execution pattern for AI assistants that prevents hallucinated, assumed, or unverified statements about actions such as test execution, file changes, Git commits, or Vercel deployments, aligned with the TDD process defined in `04_TDD_Protocol.md` and the workflow in `05_Definition_of_Done.md`.

###Applies To

All operations inside the following path: /Users/moldovan/Projects/
Must always reference and stay in sync with the following current project documents:

- `README.md`,
- `01_Roadmap.md`,
- `02_Technology_Stack.md`,
- `03_AI_Consent_Permissions.md`,
- `04_TDD_Protocol.md`,
- `05_Definition_of_Done.md`,
- `06_Sequential_Development_Rule.md`,
- `07_AI_Knowledge_Rules.md`,
- `08_AI_Verification_Protocol.md` (This file),
- `09_Dev_Log_Lessons.md`,
- `10_Release_Notes.md`.

###Mandatory Execution Format

Every AI output involving actions defined in the DoD (`05_Definition_of_Done.md`) must include explicit verification logs:

Test Execution (Ref: DoD Steps 2, 4, 5)
Initial Failing Test Run (DoD Step 2):

EXECUTED: `npm test` (`per 04_TDD_Protocol.md`)
VERIFIED: Test suite failed as expected (N tests failed).
Passing Test Run (DoD Step 4 & 5):

EXECUTED: `npm test` (`per 04_TDD_Protocol.md`)
VERIFIED: Test suite passed (M tests passed).
If Tests Fail Unexpectedly:

EXECUTED: `npm test` (`per 04_TDD_Protocol.md`)
ERROR: Test suite failed unexpectedly. Halting process per DoD. [Provide failure snippet if concise]
File Changes (Ref: DoD Steps 2, 3, 5, 7)
List created/modified files (incl. .test. files).
FILES UPDATED/CREATED:
`src/app/components/NewComponent.tsx`
`src/app/components/NewComponent.test.tsx`
`09_Dev_Log_Lessons.md`

Git Commit and Push (Ref: DoD Step 8)
Show commands used for add, commit, tag, push.

EXECUTED: `git add .`
EXECUTED: `git commit -m "feat: Implement NewComponent with TDD (Task: TSK-XXX from 01_Roadmap.md)"`
EXECUTED: `git tag -a vX.Y.Z -m "Feature: NewComponent"`
EXECUTED: `git push && git push --tags`
VERIFIED: Push successful to remote repository.
If skipped/failed: State clearly why, log in `09_Lessons_Learned.md`.

Vercel Deployment (Ref: DoD Step 9)
Show command, confirmation, URL.

EXECUTED: `vercel --prod`
VERIFIED: Deployment successful.
DEPLOYMENT COMPLETE: `https://your-project-name.vercel.app`
If failed/skipped: State clearly why, log in `09_Lessons_Learned.md`.

Documentation Logging (Ref: DoD Step 7, 11)
List updated markdown files and summary of change.

###DOCS UPDATED:
`10_Release_Notes.md` (Added vX.Y.Z entry)
`09_Dev_Log_Lessons.md` (Updated state, logged TDD cycle details and Noted pattern/issue)
Required Output Format

###Completed DoD Cycle:
VERIFICATION COMPLETE – All actions for Task (TASK-ID from `01_Roadmap.md`) (including TDD steps, commit, deploy) explicitly executed and logged above. Project state updated in `09_Dev_Log_Lessons.md`. Ready for next task from `01_Roadmap.md`.
Incomplete DoD Cycle:
ACTION INCOMPLETE – Task (TASK-ID from `01_Roadmap.md`) execution halted at Step X of DoD (`05_Definition_of_Done.md`). [Reason: e.g., Tests failed, Deployment failed]. Logged in `09_Dev_Log_Lessons.md`. User confirmation or manual intervention required before proceeding.

###Banned Phrases (Unless Verified with Proof Above)

- "Tests passed" (Requires # VERIFIED: Test suite passed... log)
- "Tested the feature" (Requires detail: How? Show test verification log or manual check log)
- "Now live on Vercel" (Requires # VERIFIED: Deployment successful... log)
- "Committed to GitHub" (Requires # VERIFIED: Push successful... log)
- "Build passed" (Deployment verification implies this; report deployment status instead)
- "All done" (Only use after VERIFICATION COMPLETE format)
- "Tag created" (Requires execution log)
- "Already deployed" (Requires verification of current commit hash on production)
- "No changes required" (Justify why based on requirements or tests)
- "MongoDB connected" (Requires verification step log, e.g., successful prod data action)

###Enforcement & Violation Handling

If unverified execution detected: Halt; re-output with correct status; flag in `09_Lessons_Learned.md`; do not proceed until current step is verifiably complete per DoD (`05_Definition_of_Done.md`).

###Cross-Reference Policy

Enforce jointly with all other current rule files (`README.md`, 01-07, 09-10). `04_TDD_Protocol.md` provides specifics for test verification steps.