# Contributing to Happenfolk

The client selected **Happenfolk** (formerly Lightsquare) on 18 September 2026.

## Public branding

Import `BRAND` from `@/lib/brand` and use `BRAND.name` for the product name in
new screens, shared components and page metadata. Keep page-specific titles,
for example ``title: `Dashboard — ${BRAND.name}` ``. The module is dependency-free
and can be imported by server and client components without environment setup.

The repository is `Happenfolk-web` and the private package is `happenfolk-web`;
the organisation URL slug remains `lightsquare-adelaide`.
Existing local checkout paths and the Supabase `project_id = "Lightsquare-web"`
remain valid. Do not reset the database or rewrite applied migrations for branding.

Preserve historical document titles, commit history and assessment evidence.
Use Happenfolk for newly issued documents and note the previous name where needed
for traceability. The README describes the branching and review requirements.
