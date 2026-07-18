#!/usr/bin/env python3
"""Dependency-free HTML sanity check: stdlib html.parser only.

Not a full HTML5 validator (tidy/htmlhint don't ship reliably across both
macOS dev machines and GitHub-hosted runners) — checks the things that
actually break a page: doctype present, tags balanced, required elements
present with non-empty content.
"""
import sys
from html.parser import HTMLParser

VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}
REQUIRED_TAGS = {"html", "head", "title", "body"}


class Checker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.seen_tags = set()
        self.title_text = ""
        self._in_title = False
        self.errors = []

    def handle_starttag(self, tag, attrs):
        self.seen_tags.add(tag)
        if tag == "title":
            self._in_title = True
        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.seen_tags.add(tag)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in VOID_ELEMENTS:
            return
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"mismatched closing tag </{tag}>")
            return
        self.stack.pop()

    def handle_data(self, data):
        if self._in_title:
            self.title_text += data


def check(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        text = f.read()

    errors = []
    if not text.lstrip().lower().startswith("<!doctype html"):
        errors.append("missing <!doctype html> at top of file")

    parser = Checker()
    parser.feed(text)
    errors.extend(parser.errors)

    if parser.stack:
        errors.append(f"unclosed tag(s): {', '.join(parser.stack)}")

    missing = REQUIRED_TAGS - parser.seen_tags
    if missing:
        errors.append(f"missing required element(s): {', '.join(sorted(missing))}")

    if not parser.title_text.strip():
        errors.append("<title> is empty")

    return errors


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check_html.py <file.html> [file.html ...]", file=sys.stderr)
        return 2

    failed = False
    for path in sys.argv[1:]:
        errors = check(path)
        if errors:
            failed = True
            print(f"{path}: FAIL")
            for err in errors:
                print(f"  - {err}")
        else:
            print(f"{path}: OK")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
