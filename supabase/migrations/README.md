# Migration numbering

| Migration | PR | Purpose |
|---|---|---|
| 0012 | #6 | Reserved |
| 0013 | #9 | Reserved |
| 0014 | #16 | Add `events.open_to_collaborate` |
| 0015 | Task 6 (PR TBD) | Add headline, location, and website to profiles |

Next available migration number: **0016**.

Before creating a migration, check this register and update it to avoid duplicate numbers.
- No database CHECK constraints will be added to `display_name` or `bio` until their length limits are confirmed.
- `contact_email` is deferred until its visibility and access rules are agreed. It is not included in this migration.