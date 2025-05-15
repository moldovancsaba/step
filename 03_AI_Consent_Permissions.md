# AI Consent & Permissions Protocol

## Purpose

To empower AI assistants (like Warp AI) to act with high autonomy inside the trusted project folder (`/Users/moldovan/Projects/`), ensuring efficient iteration, continuity, and production-readiness with minimal friction, while adhering strictly to the defined project rules.

---

## Applies To

All operations inside the following path:
`/Users/moldovan/Projects/`

Must always reference and stay in sync with the **current** project


---

## Rule Description

### AI assistants are granted ongoing permission within the specified project path to:

#### 1. Access and modify any files within the project folder structure, including but not limited to:
    - All `.md` documentation files
    - All source code files
    - Configuration files
    - Style files

#### 2. Execute the following operations without additional prompts or reconfirmation, provided they are part of fulfilling the steps in `05_Definition_of_Done.md`:
    - Write, overwrite, or refactor code and documentation files.
    - Execute test runs using `npm test`.
    - Commit changes to Git with structured messages.
    - Create and push Git tags (`git tag ...`, `git push --tags`).
    - Push commits to the remote repository (`git push`).
    - Deploy to Vercel production using `vercel --prod`.
    - Modify MongoDB schemas (`src/lib/models/`) as required by tasks.
    - Execute database operations via server actions (with proper error handling).
    - Add or remove project dependencies using `npm install` or `npm uninstall`.
    - Reorganize folder structures if necessary for better code organization (must be logged clearly).

#### 3. Assume pre-approved consent for a full DoD cycle when the user indicates readiness, such as stating:
    - "Proceed"
    - "Go"
    - "Whatever it takes"
    - "Implement Task TSK-XXX"
    - "You have my consent"
    - "Run the full Definition of Done"
    - Or gives explicit instructions aligned with the roadmap without conflicting statements.

#### 4. Trust and execute repetitive tasks defined within the `05_Definition_of_Done.md` as pre-approved, including:
    - Updating documentation files.
    - Any executable command.
    - Git add, commit, tag, push operations.
    - Vercel deployment (`vercel --prod`).
    - Logging actions according to `08_AI_Verification_Protocol.md`.

---

## Context Continuity

AI assistants must always:
- Load and honor the latest content of key context files before starting a task (as defined in `07_AI_Knowledge_Rules.md`)
- Apply updates to these files accurately as part of completing the `05_Definition_of_Done.md` cycle.

---

## Boundaries & Limitations

- No assumptions or modifications allowed on any files *outside* the defined project path (`/Users/moldovan/Projects/`).
- No database operations without proper error handling implemented in the code.
- No deployment attempts if prerequisite steps (e.g., passing tests) have failed.
- No deployment without verifying necessary environment variables are conceptually understood (actual values are in `.env.local` or Vercel, not hardcoded).
- No documentation updates that contradict the implemented code or test results.

---

## Security Requirements

1.  **Environment Variables:**
    - Handle sensitive keys like `MONGODB_URI`, `NEXTAUTH_SECRET`, etc., only through environment variables (`.env.local` for local, Vercel dashboard settings for production).
    - Ensure no secrets are exposed in logs, commit messages, or source code.
2.  **Database Operations:**
    - Implement input validation in server actions.
    - Include robust error handling (e.g., try-catch blocks).
    - Adhere to secure connection management practices (`src/lib/db.ts`).
3.  **Deployment Security:**
    - Ensure production environment variables are correctly configured in Vercel.
    - Verify build passes cleanly before deployment command is issued.
    - Perform post-deployment checks as outlined in `05_Definition_of_Done.md`.

---

## Violation Handling

If any boundary is inadvertently crossed or a security requirement is breached:
1.  Immediately stop the current operation.
2.  Report the violation clearly and factually according to `08_AI_Verification_Protocol.md`.
3.  Log the incident, cause, and corrective action taken in `09_Dev_Log_Lessons.md`.
4.  Await user confirmation or instruction before proceeding, potentially requiring rollback of changes.