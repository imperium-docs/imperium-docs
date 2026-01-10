ATLAS BACKEND

Quick start
1) python -m pip install -r requirements.txt
2) python pipeline.py

Notes
- The pipeline writes output to ../ATLAS FRONT END/data/news.json by default.
- Set OPENAI_API_KEY to enable AI summaries automatically.
- Use --no-ai to disable AI even if a key is set.
- Use --loop 900 to refresh every 15 minutes.
- Edit feeds.json to add or remove sources.

Example
setx OPENAI_API_KEY "your-key"
python pipeline.py --loop 1800
