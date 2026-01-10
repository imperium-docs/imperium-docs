# HORUS AI

Antifragile video generation orchestrator with provider chains, account pools, and progressive degradation. Includes FastAPI service, Typer CLI, and a simple internal worker.

## Features
- Provider chain with fallbacks and degradation plan
- Circuit breaker, retries, timeouts, backoff
- Account/key rotation per provider pool
- Structured JSONL logs
- Artifacts per job under artifacts/<job_id>/
- Spec-only fallback when no video backend is available
- Configurable via YAML

## Quick start

1) Create a virtualenv and install dependencies

```bash
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .
```

2) Copy env example and configure as needed

```bash
cp .env.example .env
```

3) Run the API

```bash
uvicorn app.main:app --reload
```

4) Submit a job via CLI

```bash
vgen submit --prompt "A cinematic city timelapse" --duration 12 --ratio 16:9 --res 720p --fps 24
```

Use a template preset:

```bash
vgen submit --prompt "Fast sketch" --duration 8 --ratio 16:9 --res 720p --fps 24 --template fast_720p
```

## Configs
- configs/providers.yml
- configs/policies.yml
- configs/accounts.yml
- configs/job_templates.yml

Validate configs:

```bash
vgen configs validate
```

Providers health:

```bash
vgen providers health
```

## API
- POST /jobs
- GET /jobs/{id}
- GET /jobs/{id}/artifact/{name}
- POST /admin/reload-config
- GET /health
- GET /health/providers

## Notes
- If no backend is available, the system produces scene_spec.json and final_prompt.txt using SpecOnlyProvider.
- Artifacts are stored under artifacts/<job_id>/.

