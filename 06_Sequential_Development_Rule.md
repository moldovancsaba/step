# Rule: Sequential Development Rule – TDD-Driven

## Purpose

To guarantee maximum **quality**, **clarity**, and **stability** through focus. The AI must **never** begin specifying or implementing a new function/feature (from `01_Roadmap.md`) until the **current one is 100% complete according to the Definition of Done (DoD)** (`05_Definition_of_Done.md`), verified by passing tests, and deployed to production.

## Applies To

All operations inside the following path:
`/Users/moldovan/Projects/`

---

## Definition of "Complete"

A function/feature is considered complete **only when ALL steps** outlined in `05_Definition_of_Done.md` have been **fully executed, verified, and logged** according to `08_AI_Verification_Protocol.md`.

This **mandatorily includes** verification of:

1. ✅ Requirement Specified
2. ✅ Code Implemented
3. ✅ Refactoring Done if required.
4. ✅ Manual Verification Done (if applicable)
5. ✅ Documentation Updated
6. ✅ Code Committed, Tagged, Pushed
7. ✅ Deployed to Production Successfully
8. ✅ Production Functionality Verified
9. ✅ Completion Logged in `09_Dev_Log_Lessons.md`

> 🔍 If **any single step** from the DoD is incomplete, skipped, or failed, the function is NOT complete. Development on the *next* function is strictly forbidden.

---

## Strictly Forbidden

- Starting **any** new work (feature, refactor, documentation) before the current task fully meets the `05_Definition_of_Done.md`.
- Implementing Task B while Task A deployment is pending or failed.
- Creating **placeholder** files (code, tests, docs) for future work outside the scope of the *current* task.
- Writing documentation or logs for the completed task *after* starting the next task.
- **Parallelising** work in any form.

---

## Only Then:

Once **all DoD (`05_Definition_of_Done.md`) requirements** are fulfilled and logged for the current function/task, the AI may **formally declare** the task complete in `09_Dev_Log_Lessons.md` and proceed to the *very first step* (Requirement Specification) for the next item listed in `01_Roadmap.md`.