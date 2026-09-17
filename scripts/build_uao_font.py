#!/usr/bin/env python3
"""Build the small runtime font subset used for missing UAO glyphs.

Requires fontTools and brotli in the build environment:
    python3 -m pip install fonttools brotli
"""

from pathlib import Path
import re
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
UAO_SOURCE = PROJECT_ROOT / "src-tauri/src/uao.rs"
OUTPUT_DIR = PROJECT_ROOT / "fonts"
DEFAULT_SOURCE = Path("/tmp/sarasa-source/SarasaMonoTC-Regular.ttf")


def uao_codepoints():
    source = UAO_SOURCE.read_text(encoding="utf-8")
    table = source.split("pub static UAO_B2U", 1)[1].split("pub static UAO_U2B", 1)[0]
    values = (int(value, 16) for value in re.findall(r"0x([0-9A-Fa-f]{4,6})", table))
    return {value for value in values if value not in (0, 0xFFFD)}


def main():
    source_font = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source_font.exists():
        raise SystemExit(f"Source font not found: {source_font}")

    OUTPUT_DIR.mkdir(exist_ok=True)
    codepoints = uao_codepoints()
    codepoints.update(range(0x20, 0x7F))
    codepoints.update(
        {
            0x3000,
            *range(0x2500, 0x2580),
            *range(0x2190, 0x21FF),
            *range(0x25A0, 0x25FF),
            *range(0x2600, 0x27C0),
            *range(0xFF61, 0xFFEF),
        }
    )
    unicode_range = ",".join(f"U+{value:04X}" for value in sorted(codepoints))
    output_font = OUTPUT_DIR / "waterball-uao-fallback.woff2"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(source_font),
            f"--unicodes={unicode_range}",
            "--flavor=woff2",
            "--layout-features=*",
            "--name-IDs=*",
            "--drop-tables+=DSIG",
            f"--output-file={output_font}",
        ],
        check=True,
    )
    print(f"Built {output_font} with {len(codepoints)} requested code points")


if __name__ == "__main__":
    main()
