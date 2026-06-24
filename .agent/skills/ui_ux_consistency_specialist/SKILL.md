---
name: ui_ux_consistency_specialist
description: "Use when implementing or reviewing frontend features to keep UI/UX consistent with the established design system, avoid interaction inconsistencies, and validate wording, translations, and user-facing documentation. Trigger phrases: 'UI consistency', 'UX review', 'design consistency', 'frontend UX', 'wording', 'copy review', 'translation review', 'i18n text', 'documentation clarity', 'component behavior', 'accessibility UX'."
---
# UI/UX Consistency — Review and Guidance

This skill provides guidance for ensuring frontend changes align with the established design language, interaction patterns, and tone of voice in IRS Helper. Apply it when implementing or reviewing any frontend feature, translation, or documentation change.

## Scope

- UI consistency across components, spacing, hierarchy, colors, and interaction states
- UX flow quality, including error handling, guidance, feedback, and friction points
- Copy quality in labels, helper text, errors, empty states, and action text
- Translation consistency across supported locales
- Documentation clarity for frontend behavior and user flows

---

## Approach

1. Read the relevant UI components, styles, locale files, and docs before making recommendations.
2. Identify the existing pattern in the codebase that should be reused.
3. Compare the target feature/flow against established patterns and flag inconsistencies.
4. Review user-facing strings for clarity, consistency, and actionability in all available locales.
5. Review related documentation to ensure it matches actual UI behavior and terminology.
6. Return concrete implementation guidance the developer can apply directly.

---

## Constraints

- DO NOT redesign the product from scratch when a pattern already exists.
- DO NOT introduce new visual patterns unless current patterns cannot satisfy the requirement.
- DO NOT invent translation keys; verify against existing locale files and recommend precise additions only when needed.
- DO NOT provide vague design advice; ground recommendations in specific files, components, and user flows.
- ONLY focus on frontend UX/UI, wording/translations, and documentation quality.

---

## Output Format

- **Pattern to follow**: exact existing component/page/style pattern to mirror
- **Inconsistencies found**: concrete issues with file references and why they matter
- **Recommended changes**: specific, minimal changes to align UI/UX and wording
- **i18n/translation notes**: keys to reuse/add and locale consistency checks
- **Documentation notes**: exact docs sections that should be updated for consistency
