"""Exercise the real analyze handler with database/model boundaries replaced."""
import ast
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys
backend = Path(__file__).parent if (Path(__file__).parent / "server.py").exists() else Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(backend))
from content_review import exact_fingerprint
from pathlib import Path
from types import SimpleNamespace

class Cursor:
    def __init__(self, files): self.files = files
    async def to_list(self, _limit): return self.files

class MatchingOrderTests(unittest.IsolatedAsyncioTestCase):
    def handler(self, files, events):
        tree = ast.parse((Path(__file__).with_name('server.py') if Path(__file__).with_name('server.py').exists() else Path(__file__).resolve().parents[1] / 'backend' / 'server.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'analyze')
        function.decorator_list = []
        function.args.defaults = [ast.Constant(None), ast.Constant(False)]
        async def update(*_args, **_kwargs): events.append('save')
        async def text_pick(group):
            self.assertIn('image_grouping', events)
            events.append('claude_text')
            return {'keep_id': group[-1]['id'], 'reason': 'More complete document text'}
        async def vision_pick(group, _user):
            self.assertIn('text_grouping', events)
            events.append('claude_vision')
            return {'keep_id': group[-1]['id'], 'reason': 'Vision comparison', 'vision_used': True}
        def content_groups(group, **_kwargs):
            events.append('text_grouping')
            return [group] if len(group) > 1 else []
        def image_groups(group, **_kwargs):
            events.append('image_grouping')
            return [group] if len(group) > 1 else []
        import os
        scope = {'files_col': SimpleNamespace(find=lambda *_a, **_k: Cursor(files)),
            'db': SimpleNamespace(scan_results=SimpleNamespace(update_one=update)),
            'datetime': datetime, 'timezone': timezone, 'exact_fingerprint': exact_fingerprint, 'filename_root': lambda name: name.split('_')[0], 'os': os,
            'cluster_by_content': content_groups, 'cluster_by_image_similarity': image_groups,
            'ai_pick_most_comprehensive': text_pick, 'ai_pick_most_comprehensive_image': vision_pick}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), 'handler', 'exec'), scope)
        return scope['analyze']

    async def test_exact_fingerprints_do_not_call_claude_even_with_text(self):
        events = []
        files = [{'id': str(i), 'sha256': 'a'*64, 'source':'internal', 'name': 'file.txt', 'size': 10, 'text_preview': 'text'} for i in range(2)]
        result = await self.handler(files, events)({'id': 'user'})
        self.assertEqual(len(result['duplicate_groups']), 1)
        self.assertEqual(result['duplicate_groups'][0]['kind'], 'exact_duplicate')
        self.assertFalse(any(e.startswith('claude') for e in events))

    async def test_all_grouping_precedes_model_calls_and_estimates_follow_final_keep(self):
        events = []
        files = [
            {'id': 'draft', 'sha256': 'a', 'name': 'totalspan_draft.txt', 'size': 100, 'text_preview': 'draft content'},
            {'id': 'complete', 'sha256': 'b', 'name': 'totalspan_final.txt', 'size': 200, 'text_preview': 'completed content'},
            {'id': 'photo_old', 'sha256': 'c', 'name': 'old.jpg', 'size': 300, 'phash': 'same'},
            {'id': 'photo_best', 'sha256': 'd', 'name': 'best.jpg', 'size': 400, 'phash': 'same'},
        ]
        result = await self.handler(files, events)({'id': 'user'})
        self.assertLess(events.index('image_grouping'), events.index('claude_text'))
        self.assertLess(events.index('text_grouping'), events.index('claude_vision'))
        self.assertEqual(result['duplicate_groups'][0]['keep_id'], 'complete')
        self.assertEqual(result['duplicate_groups'][1]['keep_id'], 'photo_best')
        self.assertEqual(result['space_recoverable'], 400)
        self.assertEqual(events[-1], 'save')

    async def test_exact_representative_can_be_compared_with_later_totalspan_version(self):
        events = []
        files = [
            {'id': 'duplicate', 'sha256': 'a'*64, 'source':'internal', 'name': 'totalspan_old.txt', 'size': 100, 'created_at': '2025', 'text_preview': 'old draft'},
            {'id': 'old_rep', 'sha256': 'a'*64, 'source':'internal', 'name': 'totalspan_old_copy.txt', 'size': 100, 'created_at': '2026', 'text_preview': 'old draft'},
            {'id': 'complete', 'sha256': 'new', 'name': 'totalspan_final.txt', 'size': 200, 'text_preview': 'completed document'},
        ]
        result = await self.handler(files, events)({'id': 'user'})
        groups = result['duplicate_groups']
        self.assertEqual([g['kind'] for g in groups], ['exact_duplicate', 'draft_cluster'])
        self.assertIn('old_rep', [f['id'] for f in groups[1]['files']])
        self.assertEqual(groups[1]['keep_id'], 'complete')
        self.assertEqual(result['space_recoverable'], 200)
        self.assertEqual(events.count('claude_text'), 1)

if __name__ == '__main__': unittest.main()
