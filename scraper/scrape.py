"""
RSEBL Scraper
Scrapes stock prices, historical data, and news from rsebl.org.bt
Saves results to:
  data/stocks.json   - current prices
  data/history.json  - per-stock historical prices
  data/news.json     - news and announcements
"""

import json
import os
import re
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
BASE_URL = "https://rsebl.org.bt"

KNOWN_SYMBOLS = [
    "BNBL", "RICB", "GICB", "BIL", "TBL", "BFAL", "BCCL",
    "BTCL", "BPCL", "KCL", "BBPL", "BSRM", "DPNBL", "BODB",
    "STCBL", "DWAL", "BFSL", "JMCL",
]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def parse_number(text):
    if not text:
        return None
    clean = text.replace(",", "").replace("Nu.", "").replace("%", "").strip()
    try:
        return float(clean)
    except ValueError:
        return text.strip()


def deduplicate_daily(entries):
    """Keep one (last) price per calendar date, sorted ascending."""
    daily = {}
    for e in entries:
        if not e.get("date") or not e.get("close"):
            continue
        date_key = str(e["date"])[:10]
        try:
            daily[date_key] = float(e["close"])
        except (ValueError, TypeError):
            pass
    return [{"date": k, "close": v} for k, v in sorted(daily.items())]


# ─── Stocks (screener table) ──────────────────────────────────────────────────

def wait_for_table(page, timeout=15000):
    page.wait_for_selector("table tbody tr td", timeout=timeout)


def scrape_stocks(page):
    stocks = []
    page.goto(f"{BASE_URL}/screener", wait_until="domcontentloaded", timeout=30000)
    try:
        wait_for_table(page)
    except PlaywrightTimeout:
        print("WARNING: Timed out waiting for screener table.")
        return stocks

    while True:
        rows = page.query_selector_all("table tbody tr")
        for row in rows:
            cells = row.query_selector_all("td")
            texts = [c.inner_text().strip() for c in cells]
            if len(texts) < 5 or not texts[0]:
                continue
            stocks.append({
                "symbol":     texts[0] if len(texts) > 0 else None,
                "name":       texts[1] if len(texts) > 1 else None,
                "pe_ratio":   parse_number(texts[2]) if len(texts) > 2 else None,
                "price":      parse_number(texts[3]) if len(texts) > 3 else None,
                "change":     parse_number(texts[4]) if len(texts) > 4 else None,
                "change_pct": parse_number(texts[5]) if len(texts) > 5 else None,
                "volume":     parse_number(texts[6]) if len(texts) > 6 else None,
                "value":      parse_number(texts[7]) if len(texts) > 7 else None,
                "market_cap": parse_number(texts[8]) if len(texts) > 8 else None,
            })

        next_btn = page.query_selector(
            "button[aria-label='Next page'], a[aria-label='Next'], button:has-text('Next')"
        )
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


# ─── BSI index ────────────────────────────────────────────────────────────────

def scrape_bsi(page):
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("body", timeout=10000)
    except PlaywrightTimeout:
        return None

    content = page.content()
    match = re.search(r"BSI[^\d]*?([\d,]+\.?\d*)", content)
    if match:
        return parse_number(match.group(1))

    el = page.query_selector("*:has-text('BSI')")
    if el:
        nums = re.findall(r"[\d,]+\.?\d*", el.inner_text())
        if nums:
            return parse_number(nums[0])

    return None


# ─── Historical prices ────────────────────────────────────────────────────────

def scrape_history(page):
    """
    Extract per-stock price history from the homepage RSC payload.
    The Next.js homepage embeds ~75k date/close entries across all stocks
    in self.__next_f.push([1, "..."]) script tags.
    """
    histories = {}

    # Step 1: Try JavaScript evaluation via React fiber tree
    print("  Trying JS fiber evaluation...")
    try:
        page.goto(BASE_URL, wait_until="networkidle", timeout=60000)
    except PlaywrightTimeout:
        try:
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
        except PlaywrightTimeout:
            print("  Could not load homepage.")
            return histories

    try:
        fiber_result = page.evaluate("""
            () => {
                const results = {};
                function traverse(fiber, depth) {
                    if (!fiber || depth > 80) return;
                    try {
                        const props = fiber.memoizedProps || {};
                        // Look for a prop that is an array of {date, close} objects
                        // paired with a script/symbol prop
                        const sym = props.script || props.symbol || props.ticker || null;
                        for (const key of Object.keys(props)) {
                            const val = props[key];
                            if (
                                Array.isArray(val) && val.length > 10 &&
                                val[0] && typeof val[0] === 'object' &&
                                val[0].date && val[0].close
                            ) {
                                if (sym) results[sym] = val;
                            }
                        }
                    } catch(e) {}
                    traverse(fiber.child, depth + 1);
                    traverse(fiber.sibling, depth + 1);
                }
                // Walk all DOM roots
                const allEls = document.querySelectorAll('[id], [data-symbol], [data-script]');
                allEls.forEach(el => {
                    const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
                    if (key) traverse(el[key], 0);
                });
                return results;
            }
        """)
        if fiber_result:
            for sym, arr in fiber_result.items():
                if sym in KNOWN_SYMBOLS or len(sym) <= 6:
                    histories[sym] = deduplicate_daily(arr)
                    print(f"    {sym}: {len(histories[sym])} days (fiber)")
    except Exception as e:
        print(f"  Fiber eval failed: {e}")

    if histories:
        return histories

    # Step 2: Fallback — parse raw RSC payload from the HTML
    print("  Falling back to RSC HTML parsing...")
    try:
        html = page.content()
        histories = parse_rsc_history(html)
    except Exception as e:
        print(f"  RSC parse failed: {e}")

    return histories


def parse_rsc_history(html):
    """
    Parse Next.js RSC streaming payload (self.__next_f.push([1,"..."]) calls)
    to find per-stock date/close arrays.
    """
    histories = {}

    # Extract and decode all type-1 RSC push chunks
    raw_chunks = re.findall(
        r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html
    )
    if not raw_chunks:
        print("  No RSC chunks found in HTML.")
        return histories

    full_rsc = ""
    for chunk in raw_chunks:
        try:
            full_rsc += chunk.encode("utf-8").decode("unicode_escape")
        except Exception:
            full_rsc += chunk

    print(f"  RSC payload: {len(full_rsc):,} chars")

    # For each known symbol, find nearby price arrays
    for symbol in KNOWN_SYMBOLS:
        # Search for the symbol string in the RSC data
        sym_pattern = re.compile(r'"' + re.escape(symbol) + r'"')
        matches = list(sym_pattern.finditer(full_rsc))
        if not matches:
            continue

        for m in matches:
            # Search within ±30k chars around the symbol mention
            start = max(0, m.start() - 5000)
            end = min(len(full_rsc), m.end() + 30000)
            window = full_rsc[start:end]

            # Find a date/close array in the window
            arr_idx = window.find('[{"date":')
            if arr_idx == -1:
                arr_idx = window.find('[{"date" :')
            if arr_idx == -1:
                continue

            # Find matching closing bracket
            depth, i, arr_end = 0, arr_idx, arr_idx
            in_str = False
            escape_next = False
            for ci, ch in enumerate(window[arr_idx:], arr_idx):
                if escape_next:
                    escape_next = False
                    continue
                if ch == "\\" and in_str:
                    escape_next = True
                    continue
                if ch == '"':
                    in_str = not in_str
                if not in_str:
                    if ch == "[":
                        depth += 1
                    elif ch == "]":
                        depth -= 1
                        if depth == 0:
                            arr_end = ci + 1
                            break

            if arr_end <= arr_idx:
                continue

            try:
                arr = json.loads(window[arr_idx:arr_end])
                if (
                    isinstance(arr, list) and len(arr) > 20
                    and isinstance(arr[0], dict)
                    and "date" in arr[0] and "close" in arr[0]
                ):
                    daily = deduplicate_daily(arr)
                    if daily:
                        histories[symbol] = daily
                        print(f"    {symbol}: {len(daily)} days (RSC)")
                        break
            except json.JSONDecodeError:
                continue

    return histories


# ─── News & Announcements ─────────────────────────────────────────────────────

def scrape_news(page):
    news = []

    page.goto(f"{BASE_URL}/news-and-announcements", wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("body", timeout=10000)
        # Wait a bit for dynamic content
        page.wait_for_timeout(2000)
    except PlaywrightTimeout:
        pass

    # Try common article/news selectors
    selectors = [
        "article",
        "[class*='news']",
        "[class*='announcement']",
        "[class*='Notice']",
        "[class*='card']",
        "li a",
        "ul li",
    ]

    seen = set()
    for sel in selectors:
        items = page.query_selector_all(sel)
        for item in items[:30]:
            # Get title from heading or link text
            title_el = item.query_selector("h1, h2, h3, h4, h5, a")
            date_el = item.query_selector("time, [class*='date'], [class*='time'], [class*='Date']")
            link_el = item.query_selector("a")

            title = (title_el.inner_text().strip() if title_el else item.inner_text().strip()[:150])
            date_raw = None
            if date_el:
                date_raw = date_el.get_attribute("datetime") or date_el.inner_text().strip()

            href = link_el.get_attribute("href") if link_el else None
            url = None
            if href:
                url = (BASE_URL + href) if href.startswith("/") else href

            title = title.strip()
            if title and len(title) > 5 and title not in seen:
                seen.add(title)
                news.append({"title": title, "date": date_raw, "url": url})

        if len(news) >= 5:
            break

    # Fallback: grab all visible links on the page
    if not news:
        links = page.query_selector_all("a[href]")
        for link in links[:50]:
            text = link.inner_text().strip()
            href = link.get_attribute("href") or ""
            if len(text) > 10 and text not in seen and not href.startswith("http"):
                seen.add(text)
                url = BASE_URL + href if href.startswith("/") else href
                news.append({"title": text, "date": None, "url": url})

    return news[:40]


# ─── Save helpers ─────────────────────────────────────────────────────────────

def save_json(filename, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved {path}")


# ─── Main ─────────────────────────────────────────────────────────────────────

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

        print("Scraping historical prices...")
        histories = scrape_history(page)
        print(f"  Got history for {len(histories)} stocks")

        print("Scraping news & announcements...")
        news = scrape_news(page)
        print(f"  Found {len(news)} items")

        browser.close()

    save_json("stocks.json", {
        "updated_at": timestamp,
        "bsi": bsi,
        "stocks": stocks,
    })

    save_json("history.json", {
        "updated_at": timestamp,
        "history": histories,
    })

    save_json("news.json", {
        "updated_at": timestamp,
        "news": news,
    })

    print("Done.")


if __name__ == "__main__":
    main()
