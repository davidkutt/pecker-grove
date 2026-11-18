# uv cheat sheet

- `uv sync` installs exactly what `uv.lock` says; `uv sync --frozen` fails instead of updating the lock.
- `uv add httpx` / `uv add --dev pytest` change `pyproject.toml` and the lock in one step.
- `uv run pytest -k name` runs inside the project venv without activating it.
- `uv python install 3.13` fetches a managed Python; `uv python pin 3.13` writes `.python-version`.
- `uvx ruff check` runs a tool in a throwaway environment, like `npx`.
- Moving a project folder breaks the console scripts in `.venv/bin` (absolute shebangs): `rm -rf .venv && uv sync`.
