#!/usr/bin/env python3
"""
Skynet document converter — LibreOffice behind a tiny HTTP API.

  POST /convert?to=<docx|xlsx|pdf|doc|odt>[&from=<ext>]
       body: the document's raw bytes
       → 200 with the converted bytes, 4xx/5xx with a JSON {"error": ...}
  GET  /healthz                              → 200 once LibreOffice works

Runs in its own container on an internal-only network: no internet, no
secrets, no host files. Every conversion is a fresh `soffice --convert-to`
process with its own throwaway copy of a hardened profile (macros disabled,
external links never updated), killed if it runs past the timeout — nothing
from one untrusted document survives into the next. Copying a pre-warmed
template profile keeps a conversion around a second.

(A long-lived LibreOffice driven over UNO, e.g. unoserver, would save a few
hundred milliseconds, but LibreOffice 24.2 crashes in that mode loading any
.docx that has comments, which one-shot conversion handles fine.)
"""

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("CONVERTER_PORT", "3030"))
CONCURRENCY = int(os.environ.get("CONVERTER_WORKERS", "2"))
MAX_BYTES = int(os.environ.get("CONVERTER_MAX_BYTES", str(50 * 1024 * 1024)))
TIMEOUT_S = int(os.environ.get("CONVERTER_TIMEOUT", "60"))
QUEUE_WAIT_S = int(os.environ.get("CONVERTER_QUEUE_WAIT", "60"))
WORK_ROOT = os.environ.get("CONVERTER_WORK_ROOT", "/tmp/converter")
TEMPLATE_PROFILE = os.path.join(WORK_ROOT, "profile-template")

# Target extension → (LibreOffice --convert-to argument, response type).
# Export filters are named so LibreOffice never has to guess (no shell, so
# no quoting around the names).
TARGETS = {
    "docx": ("docx:MS Word 2007 XML", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "doc": ("doc:MS Word 97", "application/msword"),
    "odt": ("odt:writer8", "application/vnd.oasis.opendocument.text"),
    "xlsx": ("xlsx:Calc MS Excel 2007 XML", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pdf": ("pdf", "application/pdf"),
}

# Macro security "very high" + macros off; never update external links
# (documents can't pull remote content; the network is closed anyway).
PROFILE_XCU = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
"""

log = logging.getLogger("converter")
slots = threading.BoundedSemaphore(CONCURRENCY)
ready = threading.Event()


class ConversionError(Exception):
    pass


def run_soffice(profile: str, inpath: str, outdir: str, convert_to: str) -> None:
    """One LibreOffice process, killed (with any children) past the timeout."""
    proc = subprocess.Popen(
        [
            "soffice",
            f"-env:UserInstallation=file://{profile}",
            "--headless", "--invisible", "--nocrashreport", "--nodefault",
            "--nologo", "--nofirststartwizard", "--norestore",
            "--convert-to", convert_to,
            "--outdir", outdir,
            inpath,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        proc.wait(TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise ConversionError("timed out")
    finally:
        # Kill the whole session: on timeout that's LibreOffice itself, and
        # soffice can leave helpers behind even on success.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()


def convert(data: bytes, src_ext: str, to: str) -> bytes:
    job = tempfile.mkdtemp(prefix="job-", dir=WORK_ROOT)
    try:
        profile = os.path.join(job, "profile")
        shutil.copytree(TEMPLATE_PROFILE, profile, symlinks=True)
        inpath = os.path.join(job, f"in.{src_ext}")
        outdir = os.path.join(job, "out")
        with open(inpath, "wb") as f:
            f.write(data)
        run_soffice(profile, inpath, outdir, TARGETS[to][0])
        outpath = os.path.join(outdir, f"in.{to}")
        if not os.path.isfile(outpath) or os.path.getsize(outpath) == 0:
            raise ConversionError("LibreOffice produced no output")
        with open(outpath, "rb") as f:
            return f.read()
    finally:
        shutil.rmtree(job, ignore_errors=True)


def warm_template() -> None:
    """Build the hardened template profile and let LibreOffice initialise it
    once, so each job's copy starts warm."""
    shutil.rmtree(TEMPLATE_PROFILE, ignore_errors=True)
    user_dir = os.path.join(TEMPLATE_PROFILE, "user")
    os.makedirs(user_dir)
    with open(os.path.join(user_dir, "registrymodifications.xcu"), "w") as f:
        f.write(PROFILE_XCU)
    job = tempfile.mkdtemp(prefix="warm-", dir=WORK_ROOT)
    try:
        inpath = os.path.join(job, "in.txt")
        with open(inpath, "w") as f:
            f.write("warm-up\n")
        run_soffice(TEMPLATE_PROFILE, inpath, os.path.join(job, "out"), "pdf")
        if not os.path.isfile(os.path.join(job, "out", "in.pdf")):
            raise ConversionError("warm-up conversion produced no output")
    finally:
        shutil.rmtree(job, ignore_errors=True)
    # Keep only settings in the template, nothing per-run.
    for name in ("backup", "temp"):
        shutil.rmtree(os.path.join(user_dir, name), ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "skynet-converter"

    def log_message(self, fmt, *args):  # noqa: N802 - stdlib signature
        log.info("%s %s", self.address_string(), fmt % args)

    def _json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):  # noqa: N802
        if urlparse(self.path).path == "/healthz":
            return self._json(200 if ready.is_set() else 503, {"ready": ready.is_set()})
        return self._json(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/convert":
            return self._json(404, {"error": "not_found"})
        query = parse_qs(url.query)
        to = (query.get("to") or [""])[0]
        if to not in TARGETS:
            return self._json(400, {"error": "unsupported_target"})
        # The source extension only names the input file; LibreOffice
        # detects the real type from the content.
        src_ext = (query.get("from") or ["bin"])[0].lower()
        if not re.fullmatch(r"[a-z0-9]{1,8}", src_ext):
            src_ext = "bin"
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self._json(400, {"error": "empty_body"})
        if length > MAX_BYTES:
            return self._json(413, {"error": "too_large"})
        data = self.rfile.read(length)
        if not ready.is_set():
            return self._json(503, {"error": "starting"})

        if not slots.acquire(timeout=QUEUE_WAIT_S):
            return self._json(503, {"error": "busy"})
        started = time.monotonic()
        try:
            out = convert(data, src_ext, to)
        except Exception as exc:  # unreadable document, timeout, crash
            log.warning("conversion %s → %s failed: %s", src_ext, to, exc)
            return self._json(422, {"error": "conversion_failed"})
        finally:
            slots.release()

        log.info("converted %s → %s (%d → %d bytes) in %.2fs", src_ext, to, len(data), len(out), time.monotonic() - started)
        self.send_response(200)
        self.send_header("Content-Type", TARGETS[to][1])
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.makedirs(WORK_ROOT, exist_ok=True)

    def warm() -> None:
        while True:
            try:
                warm_template()
                ready.set()
                log.info("LibreOffice profile ready")
                return
            except Exception as exc:
                log.error("LibreOffice warm-up failed, retrying: %s", exc)
                time.sleep(10)

    threading.Thread(target=warm, daemon=True).start()
    log.info("listening on :%d (%d concurrent conversions)", PORT, CONCURRENCY)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
