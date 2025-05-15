# Warp.dev Drive for STEP Project

This directory contains team-shared templates, configurations, and resources for the STEP (Sphere Triangular Earth Project) team.

## Contents

### Templates
- `tdd_templates/`: Test-Driven Development templates
  - `test_template.ts`: Template for new Jest test files
- `verification_log_template.md`: Template for recording verification steps according to the project's protocols

### Configuration
- `../.warp/settings.yaml`: Team workspace settings
- `../.warp/workflows.yaml`: Shared workflow commands
- `../.warp/notebook.md`: Development notebook template

## Usage

1. **Starting a New TDD Cycle**:
   - Copy the test template from `tdd_templates/test_template.ts`
   - Place it alongside the file you're testing
   - Follow the "TDD Workflow Steps" outlined in `04_TDD_Protocol.md`

2. **Recording Verification**:
   - Copy `verification_log_template.md`
   - Fill in details as you complete verification steps
   - Submit with your TDD cycle completion

3. **Team Notebooks**:
   - Use the notebook template in `.warp/notebook.md`
   - Keep notes during development sessions
   - Share insights with the team

## Workflow Commands

Access the team workflows from Warp.dev by:
1. Opening the command palette (Cmd+P)
2. Typing a workflow name (e.g., "Run Tests")
3. Selecting the workflow to execute the command

## Integration with Project Protocols

These Warp.dev configurations are designed to support and enforce:
- Test-Driven Development (`04_TDD_Protocol.md`)
- Definition of Done (`05_Definition_of_Done.md`)
- Sequential Development Rule (`06_Sequential_Development_Rule.md`)
- AI Verification Protocol (`08_AI_Verification_Protocol.md`)

## Team Collaboration

Share workflows, notebooks, and drive contents with team members to ensure consistent development practices across the team.

