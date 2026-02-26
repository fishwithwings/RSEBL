# RSEBL Market Tracker

Live dashboard for securities listed on the Royal Securities Exchange of Bhutan.

**Live site:** https://&lt;your-username&gt;.github.io/RSEBL

## Features
- Daily auto-updated stock prices (scraped from rsebl.org.bt)
- Bhutan Stock Index (BSI)
- Sector breakdown
- Search and sort all listed securities
- News & announcements feed
- Portfolio tracker (stored locally in your browser)

## How it works

```
GitHub Actions (cron: weekdays 10:00 UTC / 3:30 PM Bhutan time)
  └── scraper/scrape.py  (Playwright headless browser)
      └── data/stocks.json
      └── data/news.json
          └── GitHub Pages serves index.html
```

## Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages → Source → Deploy from branch → main / (root)**
3. The site will be live at `https://<username>.github.io/<repo>`
4. GitHub Actions runs the scraper automatically on weekdays

## Run scraper locally

```bash
pip install -r scraper/requirements.txt
playwright install chromium
python scraper/scrape.py
```
