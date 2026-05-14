"""
PDF Merger / Splitter / Converter tool.

Operations
----------
merge          : Combine multiple PDFs into one, with optional reordering.
split          : Extract specific page ranges from a single PDF.
convert        : Convert between PDF ↔ DOCX (and other formats via pandoc-like bridges).

Execution modes (outputMode)
-----------------------------
replace        : overwrite the original file(s).
copy           : place the result alongside the original (same folder).
virtual_drive  : copy results into a PdfToolResults virtual drive.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import APP_VERSION
from migrations import get_latest_schema_version

# ── Paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_TOOL_DRIVES_PATH = _DATA_DIR / "tool_drives.json"
_CONFIG_FILENAME = ".drive_config.json"

SUPPORTED_PDF_EXTENSIONS = {".pdf"}
SUPPORTED_DOC_EXTENSIONS = {".docx", ".doc"}
SUPPORTED_ALL_EXTENSIONS = SUPPORTED_PDF_EXTENSIONS | SUPPORTED_DOC_EXTENSIONS

# ── Agent tool definition ──────────────────────────────────────────────────────

DEFINITION = {
    "name": "pdf_merger",
    "description": (
        "Merge, split, reorder PDF files and convert between PDF and DOCX. "
        "Supports batch processing and virtual-drive output."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["merge", "split", "convert"],
                "description": "The operation to perform.",
            },
            "files": {
                "type": "array",
                "description": 'List of file objects, e.g. [{"path": "..."}]',
                "items": {"type": "object"},
            },
            "outputMode": {
                "type": "string",
                "enum": ["replace", "copy", "virtual_drive"],
                "description": "How to handle the output file(s).",
            },
            "outputPath": {
                "type": "string",
                "description": "Parent directory for virtual drive (only for virtual_drive mode).",
            },
            "outputFilename": {
                "type": "string",
                "description": "Base name for the merged output (without extension).",
            },
            "pageRanges": {
                "type": "string",
                "description": "Comma-separated page ranges for split, e.g. '1-3,5,7-9'.",
            },
            "convertTo": {
                "type": "string",
                "enum": ["pdf", "docx"],
                "description": "Target format for conversion.",
            },
        },
        "required": ["action", "files"],
    },
    "input_instructions": (
        "files: array of {path} — use ask_user(input_type='file') to pick PDF or DOCX files from virtual drives. "
        "action: 'merge' (combine PDFs), 'split' (extract page ranges), or 'convert' (PDF↔DOCX). "
        "outputMode: 'replace' overwrites original, 'copy' places result alongside, 'virtual_drive' saves to a new virtual drive. "
        "outputPath: required only for virtual_drive — use ask_user(input_type='folder') to pick a folder from the app's virtual drives. "
        "outputFilename: base name for merged/split output (no extension). "
        "pageRanges: for split action, comma-separated ranges like '1-3,5,7-9'. "
        "convertTo: 'pdf' or 'docx' for convert action."
    ),
    "output_description": (
        "JSON {success, total, succeeded, failed, results:[{path, outputPath, success, error?}], virtualDrivePath?}"
    ),
}

# ── Tool-drives registry helpers ───────────────────────────────────────────────

def _load_tool_drives() -> list:
    if _TOOL_DRIVES_PATH.exists():
        try:
            return json.loads(_TOOL_DRIVES_PATH.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _save_tool_drives(drives: list) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _TOOL_DRIVES_PATH.write_text(json.dumps(drives, indent=2), encoding="utf-8")


def _register_tool_drive(drive_path: str, name: str, tool: str) -> None:
    drives = _load_tool_drives()
    normalized_new = os.path.normcase(os.path.normpath(drive_path))
    for d in drives:
        existing = d.get("path", "")
        if existing and os.path.normcase(os.path.normpath(existing)) == normalized_new:
            return
    drives.append({"path": drive_path, "name": name, "tool": tool})
    _save_tool_drives(drives)


def _ensure_virtual_drive(output_path: str) -> str:
    drive_name = "PdfToolResults"
    drive_path = os.path.join(output_path, drive_name)
    os.makedirs(drive_path, exist_ok=True)

    config_path = os.path.join(drive_path, _CONFIG_FILENAME)
    if not os.path.exists(config_path):
        config = {
            "schema_version": get_latest_schema_version(),
            "serial": str(uuid.uuid4()),
            "name": drive_name,
            "type": "move",
            "created_at": str(os.path.getctime(drive_path)),
            "app_version_created": APP_VERSION,
            "created_by_tool": "pdf_merger",
        }
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        subprocess.call(["attrib", "+h", config_path], shell=True)

    _register_tool_drive(drive_path, drive_name, "pdf_merger")
    return drive_path


def _unique_path(path: str) -> str:
    """Return a non-colliding path by appending a numeric suffix if needed."""
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    counter = 1
    while os.path.exists(f"{stem}_{counter}{ext}"):
        counter += 1
    return f"{stem}_{counter}{ext}"


# ── PDF operations ─────────────────────────────────────────────────────────────

def _merge_pdfs(paths: list[str], output_path: str, add_bookmarks: bool = True) -> str:
    """Merge multiple PDFs into one. Returns path to merged file."""
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for pdf_path in paths:
        reader = PdfReader(pdf_path)
        start_page = len(writer.pages)
        for page in reader.pages:
            writer.add_page(page)
        if add_bookmarks:
            name = Path(pdf_path).stem
            writer.add_outline_item(name, start_page)

    with open(output_path, "wb") as f:
        writer.write(f)
    return output_path


def _split_pdf(src_path: str, page_ranges: str, output_dir: str, output_stem: str = "") -> list[str]:
    """
    Extract page ranges from a PDF.
    page_ranges: comma-separated, e.g. "1-3,5,7-9"
    Returns list of output file paths.
    """
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(src_path)
    total_pages = len(reader.pages)
    stem = output_stem.strip() if output_stem and output_stem.strip() else Path(src_path).stem

    ranges = _parse_page_ranges(page_ranges, total_pages)
    output_files: list[str] = []

    for i, (start, end) in enumerate(ranges):
        writer = PdfWriter()
        for page_idx in range(start - 1, end):  # convert to 0-indexed
            writer.add_page(reader.pages[page_idx])

        out_name = f"{stem}_pages_{start}-{end}.pdf"
        out_path = _unique_path(os.path.join(output_dir, out_name))
        with open(out_path, "wb") as f:
            writer.write(f)
        output_files.append(out_path)

    return output_files


def _reorder_pdf(src_path: str, page_order: list[int], output_path: str) -> str:
    """Reorder pages of a single PDF. page_order is 1-indexed."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(src_path)
    writer = PdfWriter()

    for page_num in page_order:
        idx = page_num - 1
        if 0 <= idx < len(reader.pages):
            writer.add_page(reader.pages[idx])

    with open(output_path, "wb") as f:
        writer.write(f)
    return output_path


def _get_pdf_page_count(path: str) -> int:
    from pypdf import PdfReader
    return len(PdfReader(path).pages)


def _convert_pdf_to_docx(src_path: str, output_path: str) -> str:
    """Convert PDF to DOCX using pdf2docx."""
    from pdf2docx import Converter

    cv = Converter(src_path)
    cv.convert(output_path)
    cv.close()
    return output_path


def _convert_docx_to_pdf(src_path: str, output_path: str) -> str:
    """Convert DOCX to PDF using docx2pdf (requires MS Word on Windows)."""
    from docx2pdf import convert
    convert(src_path, output_path)
    return output_path


def _parse_page_ranges(range_str: str, total: int) -> list[tuple[int, int]]:
    """Parse '1-3,5,7-9' into [(1,3),(5,5),(7,9)], clamped to total."""
    ranges: list[tuple[int, int]] = []
    for part in range_str.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            s, e = part.split("-", 1)
            start = max(1, int(s.strip()))
            end = min(total, int(e.strip()))
            if start <= end:
                ranges.append((start, end))
        else:
            p = int(part.strip())
            if 1 <= p <= total:
                ranges.append((p, p))
    return ranges


# ── Single-item conversion processor ──────────────────────────────────────────

def _process_convert_item(
    item: dict,
    convert_to: str,
    output_mode: str,
    virtual_drive_path: str | None,
    output_filename: str = "",
) -> dict:
    src = item.get("path", "")
    if not src or not os.path.isfile(src):
        return {"path": src, "success": False, "error": "File not found"}

    ext = Path(src).suffix.lower()
    stem = output_filename.strip() if output_filename and output_filename.strip() else Path(src).stem

    try:
        if convert_to == "docx" and ext == ".pdf":
            out_ext = ".docx"
            converter_fn = _convert_pdf_to_docx
        elif convert_to == "pdf" and ext in (".docx", ".doc"):
            out_ext = ".pdf"
            converter_fn = _convert_docx_to_pdf
        else:
            return {"path": src, "success": False, "error": f"Cannot convert {ext} → .{convert_to}"}

        if output_mode == "replace":
            tmp_path = src + ".pdf_conv_tmp" + out_ext
            converter_fn(src, tmp_path)
            final = os.path.join(os.path.dirname(src), f"{stem}{out_ext}")
            final = _unique_path(final)
            shutil.move(tmp_path, final)

        elif output_mode == "copy":
            candidate = os.path.join(os.path.dirname(src), f"{stem}_converted{out_ext}")
            final = _unique_path(candidate)
            converter_fn(src, final)

        else:  # virtual_drive
            dest = os.path.join(virtual_drive_path, f"{stem}{out_ext}")  # type: ignore[arg-type]
            dest = _unique_path(dest)
            converter_fn(src, dest)
            final = dest

        return {"path": src, "outputPath": final, "success": True}

    except Exception as exc:
        return {"path": src, "success": False, "error": str(exc)}


# ── Public API ─────────────────────────────────────────────────────────────────

def execute(input_data: dict) -> str:
    """Synchronous single-threaded execution."""
    return execute_parallel(input_data, max_workers=1)


def execute_parallel(input_data: dict, max_workers: int = 2) -> str:
    action: str = input_data.get("action", "merge")
    files: list = input_data.get("files", [])
    output_mode: str = input_data.get("outputMode", "copy")
    output_path: str = input_data.get("outputPath", "")
    output_filename: str = input_data.get("outputFilename", "merged")
    page_ranges: str = input_data.get("pageRanges", "")
    convert_to: str = input_data.get("convertTo", "docx")
    add_bookmarks: bool = input_data.get("addBookmarks", True)
    page_order: list[int] = input_data.get("pageOrder", [])

    if not files:
        return json.dumps({"success": False, "error": "No files provided.", "results": []})

    virtual_drive_path: str | None = None
    if output_mode == "virtual_drive":
        if not output_path or not os.path.isdir(output_path):
            return json.dumps({
                "success": False,
                "error": f"Invalid output path for virtual drive: '{output_path}'",
                "results": [],
            })
        virtual_drive_path = _ensure_virtual_drive(output_path)

    # ── MERGE ──────────────────────────────────────────────────────────────
    if action == "merge":
        paths = [f.get("path", "") for f in files]
        valid_paths = [p for p in paths if p and os.path.isfile(p) and Path(p).suffix.lower() == ".pdf"]
        if len(valid_paths) < 1:
            return json.dumps({"success": False, "error": f"No valid PDF files to merge. Received paths: {paths}", "results": []})

        try:
            if output_mode == "virtual_drive" and virtual_drive_path:
                out = os.path.join(virtual_drive_path, f"{output_filename}.pdf")
            elif output_mode == "copy":
                first_dir = os.path.dirname(valid_paths[0])
                out = os.path.join(first_dir, f"{output_filename}.pdf")
            else:  # replace — put alongside the first file
                first_dir = os.path.dirname(valid_paths[0])
                out = os.path.join(first_dir, f"{output_filename}.pdf")

            out = _unique_path(out)
            _merge_pdfs(valid_paths, out, add_bookmarks=add_bookmarks)

            response = {
                "success": True,
                "total": len(valid_paths),
                "succeeded": len(valid_paths),
                "failed": 0,
                "results": [{"path": out, "outputPath": out, "success": True}],
            }
            if virtual_drive_path:
                response["virtualDrivePath"] = virtual_drive_path

            return json.dumps(response)
        except Exception as exc:
            import traceback
            return json.dumps({"success": False, "error": f"{str(exc)}\\n{traceback.format_exc()}", "results": []})


    # ── SPLIT ──────────────────────────────────────────────────────────────
    elif action == "split":
        if len(files) < 1:
            return json.dumps({"success": False, "error": "No file provided for split.", "results": []})

        src = files[0].get("path", "")
        if not src or not os.path.isfile(src):
            return json.dumps({"success": False, "error": "Source PDF not found.", "results": []})

        try:
            if output_mode == "virtual_drive" and virtual_drive_path:
                out_dir = virtual_drive_path
            elif output_mode == "copy":
                out_dir = os.path.dirname(src)
            else:
                out_dir = os.path.dirname(src)

            output_files = _split_pdf(src, page_ranges, out_dir, output_stem=output_filename)

            response = {
                "success": True,
                "total": len(output_files),
                "succeeded": len(output_files),
                "failed": 0,
                "results": [{"path": p, "outputPath": p, "success": True} for p in output_files],
            }
            if virtual_drive_path:
                response["virtualDrivePath"] = virtual_drive_path

            return json.dumps(response)
        except Exception as exc:
            import traceback
            return json.dumps({"success": False, "error": f"{str(exc)}\\n{traceback.format_exc()}", "results": []})


    # ── REORDER ────────────────────────────────────────────────────────────
    elif action == "reorder":
        if len(files) < 1:
            return json.dumps({"success": False, "error": "No file provided for reorder.", "results": []})

        src = files[0].get("path", "")
        if not page_order:
            return json.dumps({"success": False, "error": "No page order specified.", "results": []})

        try:
            if output_mode == "virtual_drive" and virtual_drive_path:
                out = os.path.join(virtual_drive_path, f"{Path(src).stem}_reordered.pdf")
            elif output_mode == "replace":
                out = src + ".reorder_tmp.pdf"
            else:
                out = os.path.join(os.path.dirname(src), f"{Path(src).stem}_reordered.pdf")

            out = _unique_path(out)
            _reorder_pdf(src, page_order, out)

            if output_mode == "replace":
                os.remove(src)
                final = os.path.join(os.path.dirname(src), Path(src).name)
                shutil.move(out, final)
                out = final

            response = {
                "success": True,
                "total": 1,
                "succeeded": 1,
                "failed": 0,
                "results": [{"path": src, "outputPath": out, "success": True}],
            }
            if virtual_drive_path:
                response["virtualDrivePath"] = virtual_drive_path

            return json.dumps(response)
        except Exception as exc:
            return json.dumps({"success": False, "error": str(exc), "results": []})

    # ── CONVERT ────────────────────────────────────────────────────────────
    elif action == "convert":
        results: list = [None] * len(files)
        workers = 1 if output_mode == "replace" else min(max_workers, len(files))

        with ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_idx = {
                pool.submit(
                    _process_convert_item,
                    item, convert_to, output_mode, virtual_drive_path, output_filename,
                ): idx
                for idx, item in enumerate(files)
            }
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    results[idx] = future.result()
                except Exception as exc:
                    results[idx] = {"path": files[idx].get("path", ""), "success": False, "error": str(exc)}

        succeeded = sum(1 for r in results if r and r["success"])
        response = {
            "success": succeeded > 0,
            "total": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
            "results": results,
        }
        if virtual_drive_path:
            response["virtualDrivePath"] = virtual_drive_path

        return json.dumps(response)

    # ── PAGE INFO ──────────────────────────────────────────────────────────
    elif action == "page_info":
        results_list = []
        for f in files:
            p = f.get("path", "")
            try:
                count = _get_pdf_page_count(p)
                results_list.append({"path": p, "pages": count, "success": True})
            except Exception as exc:
                results_list.append({"path": p, "pages": 0, "success": False, "error": str(exc)})

        return json.dumps({"success": True, "results": results_list})

    else:
        return json.dumps({"success": False, "error": f"Unknown action: '{action}'", "results": []})
