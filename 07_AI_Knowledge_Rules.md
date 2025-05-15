# AI Knowledge Rules - Done Is Better

## Purpose

To ensure AI assistants operate with full contextual understanding of the actual project environment, constraints, tech stack, current state enabling consistent, high-quality autonomous development.

---

## Applies To

All operations inside the following path:
`/Users/moldovan/Projects/`

Must always reference and stay in sync with the **current** project documents.


---

## Knowledge Base Requirements

AI assistants must dynamically ingest and adhere to the following details **before executing** any implementation step defined in `05_Definition_of_Done.md`:

### 1. Tech Stack (Defined in `02_Technology_Stack.md`)
    - Refer to `02_Technology_Stack.md` for current framework, UI, DB, Styling, Deployment, Language versions.
    - **Package Manager:** npm

### 2. Development Rules & Process
    - Strictly follow DoD: `05_Definition_of_Done.md`
    - Strictly follow Sequential Rule: `06_Sequential_Development_Rule.md`
    - Adhere to AI Consent: `03_AI_Consent_Permissions.md`
    - Adhere to Verification Protocol: `08_AI_Verification_Protocol.md`

### 3. Directory & File Structure
    - **Documentation:** `.md` files (listed in "Applies To") located in the project root or a `/docs` subdirectory (Confirm location during setup).

### 4. Context Loading
    - Before *starting any step* of the DoD for a new task from `01_Roadmap.md`, load the latest versions of all applicable `.md` rule files (listed in "Applies To" section above).
    - Load `09_Dev_Log_Lessons.md` (current state).
    - Load `10_Release_Notes.md` (changelog).
    - Load `README.md` (project overview).
    - Load `09_Dev_Log_Lessons.md` (historical context, patterns, issues to avoid).

### 5. Constraints
    - Do not create placeholder files (code, tests, or docs) unrelated to the immediate task.
    - No parallel development (Strictly follow `06_Sequential_Development_Rule.md`).
    - Install necessary libraries using `npm install --save` or `npm install --save-dev` and document the addition in `02_Technology_Stack.md` and potentially `10_Development_Log.md`.
    - Keep styling minimal and clean unless specific UI tasks are defined in `01_Roadmap.md`.
    - Focus on core functionality and delivering the defined benefit of the current task.

---

## Execution Rules

AI assistants must:
- Execute the `05_Definition_of_Done.md` steps sequentially and rigorously.
- Log all actions accurately and verifiably according to `08_AI_Verification_Protocol.md` as part of completing each DoD step.
- Update `09_Dev_Log_Lessons.md`, `10_Release_Notes.md` as required by the DoD.
- Validate all proposed actions (code changes, commands, file modifications) against these knowledge rules before execution.

---

## Security & Environment

- Secure MongoDB connection string (use environment variables via `.env.local` or Vercel settings).
- Handle environment variables correctly, never hardcoding secrets. Reference required variables in `README.md`.
- Implement input validation in server actions and potentially client components (and test this validation).
- Sanitize error messages shown to users.

---

## Final Checklist (Per DoD Cycle / Task Completion)

- [ ] Context loaded from all key markdown files.
- [ ] Tech stack requirements respected.
- [ ] No undeclared library imports or logical assumptions made.
- [ ] Generated code (application) adheres to clean code principles and project conventions.
- [ ] Deployment path (`vercel --prod`) and procedure understood.
- [ ] Database connection strategy (`src/lib/db.ts`) and interaction patterns clear.
- [ ] Error handling implemented and, where feasible, tested.
- [ ] All actions verifiably logged according to `08_AI_Verification_Protocol.md`.
- [ ] Relevant documentation files (`README.md`, `09`, `10`) updated.

---

## Maintenance

- Review this file (`07_AI_Knowledge_Rules.md`) after any significant changes to:
    - Project directory structure.
    - Core development rules or processes.
    - Major feature implementations that might introduce new standard patterns (update and log in `09_Dev_Log_Lessons.md`).