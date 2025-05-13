# Rule: Sequential Development Rule – TDD-Driven

## Purpose

To guarantee maximum **quality**, **clarity**, and **stability** through focus. The AI must **never** begin specifying, testing, or implementing a new function/feature (from `01_Roadmap.md`) until the **current one is 100% complete according to the Definition of Done (DoD)** (`05_Definition_of_Done.md`), verified by passing tests, and deployed to production.

## Applies To

All operations inside the following path:
`/Users/moldovan/Projects/`

Must always reference and stay in sync with the following **current** project documents:
- `README.md`
- `01_Roadmap.md`
- `02_Technology_Stack.md`
- `03_AI_Consent_Permissions.md`
- `04_TDD_Protocol.md`
- `05_Definition_of_Done.md`
- `06_Sequential_Development_Rule.md` (This file)
- `07_AI_Knowledge_Rules.md`
- `08_AI_Verification_Protocol.md`
- `09_Dev_Log_Lessons.md`
- `10_Release_Notes.md`

---

## Definition of "Complete"

A function/feature is considered complete **only when ALL 11 steps** outlined in `05_Definition_of_Done.md` have been **fully executed, verified, and logged** according to `08_AI_Verification_Protocol.md`.

This **mandatorily includes** verification of:
1.  ✅ Requirement Specified
2.  ✅ Test(s) Written & Confirmed Failing
3.  ✅ Code Implemented
4.  ✅ Test(s) Confirmed Passing
5.  ✅ Refactoring Done & Tests Passing (if refactored)
6.  ✅ Manual Verification Done (if applicable)
7.  ✅ Documentation Updated (`README.md`, `09`, `10`, `11`)
8.  ✅ Code & Tests Committed, Tagged, Pushed
9.  ✅ Deployed to Production Successfully
10. ✅ Production Functionality Verified
11. ✅ Completion Logged in `09_Dev_Log_Lessons.md`

> 🔍 If **any single step** from the DoD is incomplete, skipped, or failed, the function is NOT complete. Development on the *next* function is strictly forbidden.

---

## Strictly Forbidden

- Starting **any** new work (feature, test, refactor, documentation) before the current task fully meets the `05_Definition_of_Done.md`.
- Writing tests for Task B while implementing Task A.
- Implementing Task B while Task A deployment is pending or failed.
- Creating **placeholder** files (code, tests, docs) for future work outside the scope of the *current* task.
- Writing documentation or logs (`09_Dev_Log_Lessons.md`, `10_Release_Notes.md`) for the completed task *after* starting the next task.
- **Parallelising** work in any form.

---

## Only Then:

Once **all DoD (`05_Definition_of_Done.md`) requirements** are fulfilled and logged for the current function/task, the AI may **formally declare** the task complete in `09_Dev_Log_Lessons.md` and proceed to the *very first step* (Requirement Specification) for the next item listed in `01_Roadmap.md`.