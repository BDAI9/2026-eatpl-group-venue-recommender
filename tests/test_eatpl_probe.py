"""Offline checks of the explicit, shared-sequence Eatpl probe."""
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from moim import eatpl_probe
from moim.store import Store


class FakeOpener:
    def __init__(self, response=None, failure=None):
        self.response = response if response is not None else {"rspCode": "00000", "data": []}
        self.failure = failure
        self.requests = []

    def open(self, req, timeout):
        self.requests.append((req.full_url, json.loads(req.data), timeout))
        if self.failure:
            raise self.failure
        return io.BytesIO(json.dumps(self.response).encode())


class EatplProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "moim.sqlite3"
        Store(str(self.db))
        self.fake = FakeOpener()
        opener_patch = patch("moim.eatpl.request.build_opener", return_value=self.fake)
        opener_patch.start()
        self.addCleanup(opener_patch.stop)
        environment_patch = patch.dict(os.environ, {"EATPL_INSTITUTION": "private-institution"})
        environment_patch.start()
        self.addCleanup(environment_patch.stop)

    def run_probe(self, *args):
        output = io.StringIO()
        with redirect_stdout(output):
            status = eatpl_probe.main(list(args))
        return status, output.getvalue()

    def test_preflight_never_calls_network_or_exposes_institution(self):
        status, output = self.run_probe()
        self.assertEqual(status, 0)
        self.assertIn("외부 호출 없음", output)
        self.assertNotIn("private-institution", output)
        self.assertEqual(self.fake.requests, [])

    def test_live_needs_institution_location_and_existing_shared_db(self):
        with patch.dict(os.environ, {"EATPL_INSTITUTION": ""}):
            status, output = self.run_probe("--live", "--location", "서울", "--db", str(self.db))
        self.assertEqual(status, 2)
        self.assertIn("가상 데이터로 대체하지", output)
        for args in [("--live", "--db", str(self.db)),
                     ("--live", "--location", "서울", "--db", str(self.db.parent / "missing.sqlite3"))]:
            with self.subTest(args=args):
                self.assertEqual(self.run_probe(*args)[0], 2)
        self.assertFalse((self.db.parent / "missing.sqlite3").exists())
        self.assertEqual(self.fake.requests, [])

    def test_dev_and_explicit_production_use_same_sequence(self):
        self.fake.response = {"rspCode": "00000", "data": [
            {"merNm": "example", "merAddr": "서울", "merTpbuzNm": "카페",
             "merUrl": "https://web.paybooc.ai/mer/web/profile/example"}]}
        args = ("--live", "--location", "서울", "--db", str(self.db))
        status, output = self.run_probe(*args)
        prod_status, prod_output = self.run_probe(*args, "--environment", "prod")
        self.assertEqual((status, prod_status), (0, 0))
        self.assertIn("1건", output)
        self.assertNotIn("private-institution", output + prod_output)
        self.assertEqual(len(self.fake.requests), 2)
        (dev_url, dev_body, _), (prod_url, prod_body, _) = self.fake.requests
        self.assertEqual(dev_url, "https://dev-api.paybooc.ai/api/mer/v1/search")
        self.assertEqual(prod_url, "https://api.paybooc.ai/api/mer/v1/search")
        self.assertNotEqual(dev_body["trnsTrceNo"], prod_body["trnsTrceNo"])
        self.assertEqual(int(prod_body["trnsTrceNo"][-10:]), int(dev_body["trnsTrceNo"][-10:]) + 1)

    def test_auth_and_untrusted_response_errors_do_not_leak(self):
        self.fake.failure = HTTPError("https://example.invalid", 403, "no", {}, None)
        args = ("--live", "--location", "서울", "--db", str(self.db))
        status, output = self.run_probe(*args)
        self.assertEqual(status, 1)
        self.assertIn("공인 출발 IP", output)
        self.fake.failure = None
        self.fake.response = {"rspCode": "private-institution"}
        status, output = self.run_probe(*args)
        self.assertEqual(status, 1)
        self.assertNotIn("private-institution", output)


if __name__ == "__main__":
    unittest.main()
