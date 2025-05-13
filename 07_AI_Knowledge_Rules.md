# AI Knowledge Rules - Done Is Better

## Purpose

To ensure AI assistants operate with full contextual understanding of the actual project environment, constraints, tech stack, current state, and the Test-Driven Development (TDD) process, enabling consistent, high-quality autonomous development.

---

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
- `06_Sequential_Development_Rule.md`
- `07_AI_Knowledge_Rules.md` (This file)
- `08_AI_Verification_Protocol.md`
- `09_Dev_Log_Lessons.md`
- `10_Release_Notes.md`

---

## Knowledge Base Requirements

AI assistants must dynamically ingest and adhere to the following details **before executing** any implementation step defined in `05_Definition_of_Done.md`:

### 1. Tech Stack (Defined in `02_Technology_Stack.md`)
    - Refer to `02_Technology_Stack.md` for current framework, UI, DB, Styling, Deployment, Language versions.
    - **Testing Framework:** Jest (per `04_TDD_Protocol.md`)
    - **Testing Library:** React Testing Library (RTL) (per `04_TDD_Protocol.md`)
    - **Package Manager:** npm

### 2. Development Rules & Process
    - Strictly follow DoD: `05_Definition_of_Done.md`
    - Strictly follow Sequential Rule: `06_Sequential_Development_Rule.md`
    - Adhere to AI Consent: `03_AI_Consent_Permissions.md`
    - Adhere to Verification Protocol: `08_AI_Verification_Protocol.md`
    - Follow TDD conventions: `04_TDD_Protocol.md`

### 3. Directory & File Structure
    - `src/app/`: Next.js App Router files (pages, layouts, API routes)
    - `src/app/components/`: React components
    - `src/lib/`: Shared logic (db connection, actions, models, utils)
    - `src/lib/models/`: Mongoose schemas/models (Verify path during setup/Task TSK-003)
    - **Test Files Location:** Defined in `04_TDD_Protocol.md` (e.g., `*.test.tsx` alongside source).
    - **Documentation:** `.md` files (listed in "Applies To") located in the project root or a `/docs` subdirectory (Confirm location during setup).

### 4. Context Loading
    - Before *starting any step* of the DoD for a new task from `01_Roadmap.md`, load the latest versions of all applicable `.md` rule files (listed in "Applies To" section above).
    - Load `09_Dev_Log_Lessons.md` (current state).
    - Load `10_Release_Notes.md` (changelog).
    - Load `README.md` (project overview).
    - Load `09_Dev_Log_Lessons.md` (historical context, patterns, issues to avoid).

### 5. Constraints
    - **TDD is Mandatory:** No implementation code written before a failing test (DoD Step 2 & 3).
    - **Tests Must Pass:** Do not proceed to commit/deploy if tests fail after implementation/refactoring (DoD Step 4 & 5).
    - Do not create placeholder files (code, tests, or docs) unrelated to the immediate task.
    - No parallel development (Strictly follow `06_Sequential_Development_Rule.md`).
    - Make no assumptions about undocumented logic; if requirements are unclear, ask for clarification before proceeding or derive behavior solely from test definitions.
    - Install necessary libraries using `npm install --save` or `npm install --save-dev` and document the addition in `02_Technology_Stack.md` and potentially `10_Development_Log.md`.
    - Keep styling minimal and clean unless specific UI tasks are defined in `01_Roadmap.md`.
    - Focus on core functionality and delivering the defined benefit of the current task.

---

## Execution Rules

AI assistants must:
- Execute the `05_Definition_of_Done.md` steps sequentially and rigorously.
- Write clear, maintainable test code (`04_TDD_Protocol.md`) and application code.
- Run tests using the command specified in `04_TDD_Protocol.md` (e.g., `npm test`).
- Log all actions accurately and verifiably according to `08_AI_Verification_Protocol.md` as part of completing each DoD step.
- Update `09_Dev_Log_Lessons.md`, `10_Release_Notes.md` as required by the DoD.
- Validate all proposed actions (code changes, commands, file modifications) against these knowledge rules before execution.

---

## Security & Environment

- Secure MongoDB connection string (use environment variables via `.env.local` or Vercel settings).
- Handle environment variables correctly, never hardcoding secrets. Reference required variables in `README.md`.
- Implement input validation in server actions and potentially client components (and test this validation).
- Sanitize error messages shown to users.
- Ensure tests do not rely on production secrets or data directly (use mocks or test-specific environment variables as defined in `04_TDD_Protocol.md`).

---

## Final Checklist (Per DoD Cycle / Task Completion)

- [ ] Context loaded from all key markdown files (`README.md`, `01`-`10`).
- [ ] Tech stack (`02`) & Testing tools (`04`) requirements respected.
- [ ] TDD process (`04`, `05`) correctly followed (Failing test written first? Passed after implementation? Verified per `08`?).
- [ ] No undeclared library imports or logical assumptions made.
- [ ] Generated code (application + test) adheres to clean code principles and project conventions.
- [ ] Deployment path (`vercel --prod`) and procedure understood.
- [ ] Database connection strategy (`src/lib/db.ts`) and interaction patterns clear.
- [ ] Error handling implemented and, where feasible, tested.
- [ ] All actions verifiably logged according to `08_AI_Verification_Protocol.md`.
- [ ] Relevant documentation files (`README.md`, `09`, `10`) updated.

---

## Maintenance

- Review this file (`07_AI_Knowledge_Rules.md`) after any significant changes to:
    - Technology Stack (`02_Technology_Stack.md`) or testing tools (`04_TDD_Protocol.md`).
    - Project directory structure.
    - Core development rules or processes (`03`, `04`, `05`, `06`, `08`).
    - Major feature implementations that might introduce new standard patterns (update and log in `09_Dev_Log_Lessons.md`).