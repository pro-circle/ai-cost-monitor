<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Web app analytics run in TanStack server functions (`src/lib/api/acg.functions.ts`) over the TS engine in `src/lib/engine`; client code imports engine modules as types only — keeps the engine out of the browser bundle.
- `backend/` is a standalone FastAPI + SQLAlchemy service (SQLite locally, Postgres via docker-compose) mirroring the engine — user runs/tests it outside Lovable.
