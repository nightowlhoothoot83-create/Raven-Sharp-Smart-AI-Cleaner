import base64
import io
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

backend = Path(__file__).parent if (Path(__file__).parent / 'server.py').exists() else Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(backend))
os.environ.setdefault('MONGO_URL', 'mongodb://127.0.0.1:27017')
os.environ.setdefault('JWT_SECRET_KEY', 'test-only-do-not-deploy')
import server
from content_review import normalize_preview, parse_recommendations, safe_name, exact_fingerprint
from PIL import Image
from fastapi.testclient import TestClient

class Cursor:
    def __init__(self, rows): self.rows=rows
    async def to_list(self, n): return self.rows[:n]
class Collection:
    def __init__(self, rows=()): self.rows=[dict(r) for r in rows];self.updates=[];self.deletes=[]
    def find(self, query, *args):
        ids=query.get('id',{}).get('$in') if isinstance(query.get('id'),dict) else None
        return Cursor([r for r in self.rows if (not query.get('user_id') or r.get('user_id')==query['user_id']) and (ids is None or r.get('id') in ids)])
    async def find_one(self,q,*args): return next((r for r in self.rows if all(r.get(k)==v for k,v in q.items())),None)
    async def insert_one(self,r): self.rows.append(dict(r))
    async def update_one(self,q,u,*args,**kwargs):
        self.updates.append((q,u));r=await self.find_one(q)
        if r:r.update(u.get('$set',{}))
    async def delete_one(self,q):self.deletes.append(q)

class ContentCleanupTests(unittest.TestCase):
    def setUp(self):
        self.files=Collection([{'id':'mine','user_id':'u','name':'IMG_001.png','source':'internal','mime_type':'image/png','size':20,'text_preview':''},{'id':'other','user_id':'v','name':'secret.png','source':'internal'}])
        self.reviews=Collection()
        self.patches=[patch.object(server,'files_col',self.files),patch.object(server,'db',SimpleNamespace(content_reviews=self.reviews)),patch.object(server,'ANTHROPIC_API_KEY','unit-test')]
        for p in self.patches:p.start()
        server.app.dependency_overrides[server.get_current_user]=lambda:{'id':'u'}
        self.client=TestClient(server.app)
    def tearDown(self):
        self.client.close();server.app.dependency_overrides.clear()
        for p in reversed(self.patches):p.stop()
    def body(self):return {'file_ids':['mine'],'approved_content_processing':True}
    def test_content_approval_and_account_ownership(self):
        self.assertEqual(self.client.post('/api/scan/content-review',json={'file_ids':['mine']}).status_code,400)
        self.assertEqual(self.client.post('/api/scan/content-review',json={'file_ids':['other'],'approved_content_processing':True}).status_code,404)
    def test_unavailable_content_is_review_not_disposal_and_no_model_call(self):
        with patch.object(server.httpx,'AsyncClient',side_effect=AssertionError('No model call for metadata')):
            r=self.client.post('/api/scan/content-review',json=self.body())
        self.assertEqual(r.status_code,200);data=r.json();self.assertFalse(data['originals_changed']);self.assertEqual(data['recommendations'][0]['action'],'review');self.assertEqual(data['recommendations'][0]['evidence'],'unavailable')
    def test_image_preview_reaches_vision_and_suggestion_requires_approval(self):
        buf=io.BytesIO();Image.new('RGB',(8,8),'blue').save(buf,'PNG')
        body=self.body();body['previews']=[{'file_id':'mine','media_type':'image/png','data':base64.b64encode(buf.getvalue()).decode()}]
        captured=[]
        class Model:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,*args,**kwargs):
                captured.append(kwargs['json'])
                return SimpleNamespace(status_code=200,json=lambda:{'content':[{'type':'text','text':json.dumps({'recommendations':[{'file_id':'mine','action':'review','flags':['blurry'],'reason':'Inspect quality; this may be unique.','suggested_name':'blue-square'}]})}]})
        with patch.object(server.httpx,'AsyncClient',return_value=Model()):r=self.client.post('/api/scan/content-review',json=body)
        self.assertEqual(r.status_code,200,r.text);row=r.json()['recommendations'][0]
        self.assertEqual(row['evidence'],'claude_vision_image');self.assertEqual(row['suggested_name'],'blue-square.png');self.assertTrue(row['requires_approval'])
        self.assertTrue(any(b['type']=='image' for b in captured[0]['messages'][0]['content']))
        self.assertEqual(self.files.rows[0]['name'],'IMG_001.png');self.assertEqual(self.files.deletes,[])
    def test_bad_preview_and_foreign_preview_rejected(self):
        b=self.body();b['previews']=[{'file_id':'mine','media_type':'image/png','data':'not-base64'}]
        self.assertEqual(self.client.post('/api/scan/content-review',json=b).status_code,400)
        b['previews'][0]['file_id']='other';self.assertEqual(self.client.post('/api/scan/content-review',json=b).status_code,400)
    def test_cloud_rename_failure_keeps_scan_metadata(self):
        self.files.rows[0].update(source='gdrive',source_id='s',external_id='cloud')
        sources=Collection([{'id':'s','user_id':'u','access_token':'test-token'}])
        async def failed(*args):return False
        with patch.object(server,'sources_col',sources),patch.object(server,'drive_rename',failed):r=self.client.post('/api/files/mine/rename',json={'new_name':'new.png'})
        self.assertEqual(r.status_code,502);self.assertEqual(self.files.rows[0]['name'],'IMG_001.png');self.assertEqual(self.files.updates,[])
    def test_cloud_cleanup_failure_keeps_scan_metadata(self):
        self.files.rows[0].update(source='gdrive',source_id='s',external_id='cloud')
        async def failed(*args):return False
        with patch.object(server,'sources_col',Collection([{'id':'s','user_id':'u','access_token':'test'}])),patch.object(server,'drive_delete',failed):r=self.client.delete('/api/files/mine')
        self.assertEqual(r.status_code,502);self.assertEqual(self.files.deletes,[])
    def test_device_original_rename_rejected(self):
        self.assertEqual(self.client.post('/api/files/mine/rename',json={'new_name':'new.png'}).status_code,409)
    def test_untrusted_model_ids_and_content_claims_are_filtered(self):
        rows=parse_recommendations(json.dumps({'recommendations':[{'file_id':'foreign','action':'delete_candidate'},{'file_id':'mine','action':'delete_candidate','suggested_name':'invented'}]}),self.files.rows[:1],{'mine':'unavailable'})
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['action'],'review');self.assertIsNone(rows[0]['suggested_name'])
    def test_filename_sanitization_preserves_extension(self):
        self.assertEqual(safe_name('../new/name','file.pdf'),'_new_name.pdf')

    def test_pdf_preview_reaches_document_block(self):
        from pypdf import PdfWriter
        writer=PdfWriter();writer.add_blank_page(width=100,height=100);buf=io.BytesIO();writer.write(buf)
        block,count=normalize_preview(base64.b64encode(buf.getvalue()).decode(),'application/pdf')
        self.assertEqual(block['type'],'document');self.assertGreater(count,0)
    def test_sample_and_metadata_hashes_are_not_exact_duplicates(self):
        self.assertIsNone(exact_fingerprint({'source':'dropbox','sha256':'a'*64,'fingerprint_kind':'sample_sha256','size':20}))
        self.assertIsNone(exact_fingerprint({'source':'gdrive','sha256':'a'*64,'fingerprint_kind':'unknown','size':20}))
        self.assertEqual(exact_fingerprint({'source':'internal','sha256':'a'*64,'external_id':'web:file','size':20})[0],'sha256')
    def test_model_failure_makes_no_cleanup_change(self):
        self.files.rows[0]['text_preview']='some content'
        class Failure:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,*args,**kwargs):return SimpleNamespace(status_code=500)
        with patch.object(server.httpx,'AsyncClient',return_value=Failure()):r=self.client.post('/api/scan/content-review',json=self.body())
        self.assertEqual(r.status_code,502);self.assertEqual(self.files.deletes,[]);self.assertEqual(self.files.updates,[])

    def test_docx_preview_mime_type_and_excerpt_are_supported(self):
        from docx import Document
        doc=Document();doc.add_paragraph('Totalspan signed final plan');buf=io.BytesIO();doc.save(buf)
        data=base64.b64encode(buf.getvalue()).decode()
        preview=server.ContentPreview(file_id='mine',media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',data=data)
        block,count=normalize_preview(preview.data,preview.media_type)
        self.assertEqual(block['type'],'text');self.assertIn('Totalspan signed final plan',block['text'])

if __name__=='__main__':unittest.main()
