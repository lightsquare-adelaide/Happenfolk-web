# Migration sequencing

Existing migration files are immutable. Add timestamped migrations after the stack head.

| Migration | Source | Purpose |
|---|---|---|
| 20261028000100 | Ziang #16, formerly 0014 | Event collaboration availability |
| 20261028000200 | Ziang #16, formerly 0015 | Public collaborators on published events |
| 20261028000300 | Ziang #19, formerly 0016 | Profile headline, location and website |
| 20261028000400 | Stack integration | Grant updates on collaboration availability |
| 20261028000500 | Ziang #20 | Repair tied media ordering |
| 20261028000600 | Ziang #20 | Atomic metadata-preserving media deduplication |

The three schema migrations were renamed without changing their SQL. The media fixes run after the existing stack migrations. Contact email remains outside this package.
