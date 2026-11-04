"""History parser regression tests. Run: python -m unittest discover -s scraper -p 'test_*.py'."""
import json
import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import scrape


def page_for(payload, chunk_size=None):
    size = chunk_size or len(payload) or 1
    return ''.join('<script>self.__next_f.push([1,' + json.dumps(payload[i:i+size]) + '])</script>'
                   for i in range(0, len(payload), size))


def record(data):
    return 'a:' + json.dumps(data, ensure_ascii=False) + '\n'


class HistoryParserTests(unittest.TestCase):
    def test_large_arrays_and_chunk_boundaries_keep_ownership(self):
        entries = [{'date': str(date(2020, 1, 1) + timedelta(days=i)), 'close': '28.00'}
                   for i in range(10000)]
        data = [{'symbol': 'BNBL', 'name': 'Quoted "name" འབྲུག', 'history': entries},
                {'history': [{'close': '70', 'date': '2026-11-04'}], 'symbol': 'RICB'},
                {'symbol': 'DPNB', 'history': [{'date': '2026-11-04', 'close': '25'}]}]
        payload = record({'children': data})
        self.assertGreater(len(payload), 400000)
        parsed = scrape.parse_rsc_history(page_for(payload, 137))
        self.assertEqual(len(parsed['BNBL']), 10000)
        self.assertEqual(parsed['BNBL'][-1]['close'], 28.0)
        self.assertEqual(parsed['RICB'], [{'date': '2026-11-04', 'close': 70.0}])
        self.assertEqual(parsed['DPNB'][0]['close'], 25.0)

    def test_duplicate_days_sorted_last_value_wins(self):
        data = {'ticker': 'BNBL', 'history': [
            {'date': '2026-11-03', 'close': '21'},
            {'date': '2026-11-02T06:00:00Z', 'close': '20'},
            {'date': '2026-11-02T09:00:00Z', 'close': '22'},
            None, 'reference', {}, {'date': '2026-11-04', 'close': 'bad'}]}
        self.assertEqual(scrape.parse_rsc_history(page_for(record(data)))['BNBL'],
                         [{'date': '2026-11-02', 'close': 22.0}, {'date': '2026-11-03', 'close': 21.0}])

    def test_unrelated_arrays_not_assigned_to_symbol(self):
        data = [{'symbol': 'BNBL'}, {'history': [{'date': '2026-11-04', 'close': '70'}]}]
        self.assertEqual(scrape.parse_rsc_history(page_for(record(data))), {})

    def test_bad_or_truncated_records_do_not_hide_valid_records(self):
        payload = '0:I["module"]\n1:{broken\n' + record({'script': 'BNBL', 'history': [
            {'date': '2026-11-04', 'close': '23.9'}]}) + 'b:{"symbol":"RICB","history":['
        self.assertEqual(set(scrape.parse_rsc_history(page_for(payload))), {'BNBL'})
        self.assertEqual(scrape.parse_rsc_history('<html></html>'), {})

    def test_longest_repeated_history_is_retained(self):
        long = {'symbol': 'BNBL', 'history': [{'date': '2026-11-03', 'close': '20'},
                                            {'date': '2026-11-04', 'close': '21'}]}
        short = {'symbol': 'BNBL', 'history': long['history'][-1:]}
        self.assertEqual(len(scrape.parse_rsc_history(page_for(record([long, short])))['BNBL']), 2)

    def test_empty_history_cannot_overwrite_any_output(self):
        with patch.object(scrape, 'sync_playwright', return_value=MagicMock()), \
             patch.object(scrape, 'scrape_bsi', return_value=None), \
             patch.object(scrape, 'scrape_stocks', return_value=[]), \
             patch.object(scrape, 'scrape_news', return_value=[]), \
             patch.object(scrape, 'scrape_history', return_value={}), \
             patch.object(scrape, 'save_json') as save:
            with self.assertRaisesRegex(RuntimeError, 'No stock histories'):
                scrape.main()
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
