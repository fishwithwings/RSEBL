"""
RSEBL Scraper
Scrapes stock prices and news from rsebl.org.bt
Saves results to data/stocks.json and data/news.json
"""

import json
import os
import re
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
BASE_URL = "https://rsebl.org.bt"


def wait_for_table(page, timeout=15000):
    """Wait until at least one table row with real data appears."""
    page.wait_for_selector("table tbody tr td", timeout=timeout)


def parse_number(text):
    """Strip commas/whitespace and convert to float, or return raw string."""
    if not text:
        return None
    clean = text.replace(",", "").replace("Nu.", "").replace("%", "").strip()
    try:
        return float(clean)
    except ValueError:
        return text.strip()


def scrape_stocks(page):
    """Scrape all pages of the /screener market watch table."""
    stocks = []
    page.goto(f"{BASE_URL}/screener", wait_until="domcontentloaded", timeout=30000)

    try:
        wait_for_table(page)
    except PlaywrightTimeout:
        print("WARNING: Timed out waiting for screener table.")
        return stocks

    # Handle pagination — collect all pages
    while True:
        rows = page.query_selector_all("table tbody tr")
        for row in rows:
            cells = row.query_selector_all("td")
            texts = [c.inner_text().strip() for c in cells]

            # Skip empty / header rows
            if len(texts) < 5 or not texts[0]:
                continue

            # Column order observed on rsebl.org.bt/screener:
            # Symbol | Company Name | P/E | Price | Change | % Change | Volume | Value | Mkt Cap
            entry = {
                "symbol": texts[0] if len(texts) > 0 else None,
                "name": texts[1] if len(texts) > 1 else None,
                "pe_ratio": parse_number(texts[2]) if len(texts) > 2 else None,
                "price": parse_number(texts[3]) if len(texts) > 3 else None,
                "change": parse_number(texts[4]) if len(texts) > 4 else None,
                "change_pct": parse_number(texts[5]) if len(texts) > 5 else None,
                "volume": parse_number(texts[6]) if len(texts) > 6 else None,
                "value": parse_number(texts[7]) if len(texts) > 7 else None,
                "market_cap": parse_number(texts[8]) if len(texts) > 8 else None,
            }
            stocks.append(entry)

        # Try to click "Next" page button
        next_btn = page.query_selector("button[aria-label='Next page'], a[aria-label='Next'], button:has-text('Next')")
        if next_btn and next_btn.is_enabled():
            next_btn.click()
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
                wait_for_table(page, timeout=8000)
            except PlaywrightTimeout:
                break
        else:
            break

    return stocks


def scrape_bsi(page):
    """Scrape the Bhutan Stock Index value from the home page."""
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("body", timeout=10000)
    except PlaywrightTimeout:
        return None

    content = page.content()

    # Look for BSI value patterns like "BSI 1234.56" or numeric near "BSI"
    match = re.search(r"BSI[^\d]*?([\d,]+\.?\d*)", content)
    if match:
        return parse_number(match.group(1))

    # Fallback: check any element containing "BSI"
    el = page.query_selector("*:has-text('BSI')")
    if el:
        text = el.inner_text()
        nums = re.findall(r"[\d,]+\.?\d*", text)
        if nums:
            return parse_number(nums[0])

    return None


def scrape_news(page):
    """Scrape news and announcements from the home page and any /news route."""
    news = []

    # Try dedicated news page first
    for path in ["/news", "/announcements", "/news-announcements"]:
        page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded", timeout=15000)
        if page.url != f"{BASE_URL}{path}" and "404" in page.title().lower():
            continue

        articles = page.query_selector_all("article, .news-item, .announcement-item, [class*='news'], [class*='announcement']")
        if articles:
            for art in articles[:20]:
                title_el = art.query_selector("h1, h2, h3, h4, a")
                date_el = art.query_selector("time, [class*='date'], [class*='time']")
                link_el = art.query_selector("a")

                title = title_el.inner_text().strip() if title_el else art.inner_text().strip()[:120]
                date = date_el.get_attribute("datetime") or (date_el.inner_text().strip() if date_el else None)
                href = link_el.get_attribute("href") if link_el else None
                url = (BASE_URL + href) if href and href.startswith("/") else href

                if title:
                    news.append({"title": title, "date": date, "url": url})
            if news:
                return news

    # Fallback: scrape home page news section
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("body", timeout=10000)
    except PlaywrightTimeout:
        return news

    # Generic selectors for news-like elements
    selectors = [
        "[class*='news'] a",
        "[class*='announcement'] a",
        "[class*='Notice'] a",
        "section a[href*='news']",
        "section a[href*='announcement']",
    ]
    seen = set()
    for sel in selectors:
        els = page.query_selector_all(sel)
        for el in els[:15]:
            title = el.inner_text().strip()
            href = el.get_attribute("href")
            url = (BASE_URL + href) if href and href.startswith("/") else href
            if title and title not in seen:
                seen.add(title)
                news.append({"title": title, "date": None, "url": url})

    return news[:30]


def save_json(filename, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Saved {path}")


def main():
    timestamp = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (compatible; RSEBLTracker/1.0)"
        )
        page = context.new_page()

        print("Scraping BSI index...")
        bsi = scrape_bsi(page)
        print(f"  BSI: {bsi}")

        print("Scraping stocks...")
        stocks = scrape_stocks(page)
        print(f"  Found {len(stocks)} securities")

        print("Scraping news...")
        news = scrape_news(page)
        print(f"  Found {len(news)} news items")

        browser.close()

    save_json("stocks.json", {
        "updated_at": timestamp,
        "bsi": bsi,
        "stocks": stocks,
    })

    save_json("news.json", {
        "updated_at": timestamp,
        "news": news,
    })

    print("Done.")


if __name__ == "__main__":
    main()
