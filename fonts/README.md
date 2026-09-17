# Waterball UAO fallback font

`waterball-uao-fallback.woff2` is generated from Sarasa Mono TC Regular,
licensed under SIL Open Font License 1.1.

The source font is available from:

https://github.com/be5invis/Sarasa-Gothic/releases

To rebuild the subset:

```sh
python3 -m pip install fonttools brotli
python3 scripts/build_uao_font.py /path/to/SarasaMonoTC-Regular.ttf
```

The subset contains Unicode characters present in Waterball's UAO 2.50 table,
plus common terminal symbols. It is only a fallback; the user's selected font
remains the primary font.
