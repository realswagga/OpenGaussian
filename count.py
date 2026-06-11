#!/usr/bin/env python3

import argparse
import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path


CODE_EXTENSIONS = {
    ".js", ".jsx",
    ".ts", ".tsx",
    ".mjs", ".cjs",
    ".mts", ".cts",
}

EXCLUDED_DIRS = {
    "node_modules",
    ".git",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".output",
    ".turbo",
    ".vercel",
    ".cache",
    "tmp",
    "temp",
}

CONFIG_EXACT_NAMES = {
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "tsconfig.json",
    "jsconfig.json",
    ".eslintrc",
    ".prettierrc",
    ".babelrc",
    ".browserslistrc",
}

CONFIG_PATTERNS = [
    r".*\.config\.(js|cjs|mjs|ts|cts|mts)$",
    r".*rc\.(js|cjs|mjs|ts|json|yaml|yml)$",
    r"eslint\.config\.(js|cjs|mjs|ts)$",
    r"prettier\.config\.(js|cjs|mjs|ts)$",
    r"babel\.config\.(js|cjs|mjs|ts)$",
    r"postcss\.config\.(js|cjs|mjs|ts)$",
    r"tailwind\.config\.(js|cjs|mjs|ts)$",
    r"vite\.config\.(js|cjs|mjs|ts)$",
    r"vitest\.config\.(js|cjs|mjs|ts)$",
    r"jest\.config\.(js|cjs|mjs|ts)$",
    r"webpack\.config\.(js|cjs|mjs|ts)$",
    r"rollup\.config\.(js|cjs|mjs|ts)$",
    r"next\.config\.(js|cjs|mjs|ts)$",
    r"nuxt\.config\.(js|cjs|mjs|ts)$",
    r"playwright\.config\.(js|cjs|mjs|ts)$",
]


@dataclass
class FunctionRecord:
    key: str
    name: str | None
    file: Path
    start_line: int


@dataclass
class FileStats:
    path: Path
    unique_loc: int
    unique_functions: int


def is_config_file(path: Path) -> bool:
    name = path.name.lower()

    if name in CONFIG_EXACT_NAMES:
        return True

    return any(re.fullmatch(pattern, name) for pattern in CONFIG_PATTERNS)


def is_code_file(path: Path) -> bool:
    return path.suffix.lower() in CODE_EXTENSIONS and not is_config_file(path)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="ignore")


def strip_comments(text: str) -> str:
    """
    Удаляет // и /* */ комментарии, но сохраняет строки и переносы строк.
    """
    result = []
    i = 0
    n = len(text)

    state = "normal"
    quote = None
    escaped = False

    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if state == "normal":
            if ch == "/" and nxt == "/":
                state = "line_comment"
                i += 2
                continue

            if ch == "/" and nxt == "*":
                state = "block_comment"
                i += 2
                continue

            if ch in ("'", '"', "`"):
                state = "string"
                quote = ch
                escaped = False
                result.append(ch)
                i += 1
                continue

            result.append(ch)
            i += 1
            continue

        if state == "line_comment":
            if ch == "\n":
                result.append("\n")
                state = "normal"
            i += 1
            continue

        if state == "block_comment":
            if ch == "\n":
                result.append("\n")
            elif ch == "*" and nxt == "/":
                state = "normal"
                i += 1
            i += 1
            continue

        if state == "string":
            result.append(ch)

            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                state = "normal"
                quote = None

            i += 1
            continue

    return "".join(result)


def is_inside_string(text: str, index: int) -> bool:
    state = "normal"
    quote = None
    escaped = False

    for i in range(min(index, len(text))):
        ch = text[i]

        if state == "normal":
            if ch in ("'", '"', "`"):
                state = "string"
                quote = ch
                escaped = False

        elif state == "string":
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                state = "normal"
                quote = None

    return state == "string"


def normalize_code_line(line: str) -> str:
    """
    Убирает разницу в отступах и лишних пробелах.
    """
    return re.sub(r"\s+", " ", line.strip())


def normalize_function_text(text: str) -> str:
    """
    Одинаковая функция с разным форматированием будет считаться одной.
    """
    return re.sub(r"\s+", " ", text.strip())


def collect_unique_code_lines(commentless_text: str) -> set[str]:
    result = set()

    for raw_line in commentless_text.splitlines():
        normalized = normalize_code_line(raw_line)
        if normalized:
            result.add(normalized)

    return result


def find_matching_forward(text: str, start: int, open_ch: str, close_ch: str) -> int | None:
    depth = 0
    state = "normal"
    quote = None
    escaped = False

    for i in range(start, len(text)):
        ch = text[i]

        if state == "normal":
            if ch in ("'", '"', "`"):
                state = "string"
                quote = ch
                escaped = False
                continue

            if ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return i

        elif state == "string":
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                state = "normal"
                quote = None

    return None


def find_matching_backward(text: str, start: int, open_ch: str, close_ch: str) -> int | None:
    depth = 0

    for i in range(start, -1, -1):
        ch = text[i]

        if ch == close_ch:
            depth += 1
        elif ch == open_ch:
            depth -= 1
            if depth == 0:
                return i

    return None


def find_next_open_brace(text: str, start: int) -> int | None:
    state = "normal"
    quote = None
    escaped = False

    for i in range(start, len(text)):
        ch = text[i]

        if state == "normal":
            if ch in ("'", '"', "`"):
                state = "string"
                quote = ch
                escaped = False
                continue

            if ch == "{":
                return i

            if ch == ";":
                return None

        elif state == "string":
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                state = "normal"
                quote = None

    return None


def line_number_at(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


FUNCTION_RE = re.compile(
    r"\b(?:async\s+)?function(?:\s*\*)?\s*(?P<name>[A-Za-z_$][\w$]*)?",
    re.MULTILINE,
)

METHOD_RE = re.compile(
    r"""
    ^\s*
    (?:
        public|private|protected|readonly|static|abstract|async|override|get|set
        \s+
    )*
    (?P<name>[A-Za-z_$#][\w$]*)
    \s*
    (?:<[^>{}]*>)?
    \([^;{}=]*\)
    \s*
    (?::\s*[^({;=]+)?
    \s*
    \{
    """,
    re.MULTILINE | re.VERBOSE,
)

CONTROL_KEYWORDS = {
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "with",
    "function",
    "return",
}


def make_function_record(
    text: str,
    start: int,
    end: int,
    name: str | None,
    file: Path,
    mode: str,
) -> FunctionRecord:
    snippet = text[start:end]
    normalized = normalize_function_text(snippet)

    if mode == "name" and name:
        key = f"name:{name}"
    else:
        digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
        key = f"impl:{digest}"

    return FunctionRecord(
        key=key,
        name=name,
        file=file,
        start_line=line_number_at(text, start),
    )


def extract_function_declarations(text: str, file: Path, mode: str) -> list[FunctionRecord]:
    records = []

    for match in FUNCTION_RE.finditer(text):
        if is_inside_string(text, match.start()):
            continue

        brace = find_next_open_brace(text, match.end())
        if brace is None:
            continue

        end = find_matching_forward(text, brace, "{", "}")
        if end is None:
            continue

        records.append(
            make_function_record(
                text=text,
                start=match.start(),
                end=end + 1,
                name=match.group("name"),
                file=file,
                mode=mode,
            )
        )

    return records


def extract_methods(text: str, file: Path, mode: str) -> list[FunctionRecord]:
    records = []

    for match in METHOD_RE.finditer(text):
        name = match.group("name")

        if name in CONTROL_KEYWORDS:
            continue

        if is_inside_string(text, match.start()):
            continue

        brace = text.find("{", match.start(), match.end())
        if brace == -1:
            continue

        end = find_matching_forward(text, brace, "{", "}")
        if end is None:
            continue

        records.append(
            make_function_record(
                text=text,
                start=match.start(),
                end=end + 1,
                name=name,
                file=file,
                mode=mode,
            )
        )

    return records


def arrow_param_start(text: str, arrow_index: int) -> int:
    i = arrow_index - 1

    while i >= 0 and text[i].isspace():
        i -= 1

    if i >= 0 and text[i] == ")":
        start = find_matching_backward(text, i, "(", ")")
        if start is not None:
            j = start - 1
            while j >= 0 and text[j].isspace():
                j -= 1

            # async (x) => ...
            if j >= 4 and text[j - 4:j + 1] == "async":
                k = j - 5
                if k < 0 or not (text[k].isalnum() or text[k] in "_$"):
                    return j - 4

            return start

    while i >= 0 and (text[i].isalnum() or text[i] in "_$"):
        i -= 1

    return i + 1


def arrow_name(text: str, param_start: int) -> str | None:
    """
    Пытается достать имя из:
    const foo = (...) => {}
    foo = (...) => {}
    prop: (...) => {}
    """
    left = text[max(0, param_start - 300):param_start]

    patterns = [
        r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$",
        r"\b([A-Za-z_$][\w$]*)\s*=\s*$",
        r"\b([A-Za-z_$][\w$]*)\s*:\s*$",
    ]

    for pattern in patterns:
        match = re.search(pattern, left)
        if match:
            return match.group(1)

    return None


def arrow_body_end(text: str, body_start: int) -> int:
    i = body_start
    depth_paren = 0
    depth_bracket = 0
    depth_brace = 0

    state = "normal"
    quote = None
    escaped = False

    while i < len(text):
        ch = text[i]

        if state == "normal":
            if ch in ("'", '"', "`"):
                state = "string"
                quote = ch
                escaped = False
                i += 1
                continue

            if ch == "(":
                depth_paren += 1
            elif ch == ")":
                if depth_paren == 0:
                    return i
                depth_paren -= 1

            elif ch == "[":
                depth_bracket += 1
            elif ch == "]":
                if depth_bracket == 0:
                    return i
                depth_bracket -= 1

            elif ch == "{":
                depth_brace += 1
            elif ch == "}":
                if depth_brace == 0:
                    return i
                depth_brace -= 1

            elif ch in (";", ",", "\n") and depth_paren == depth_bracket == depth_brace == 0:
                return i

        elif state == "string":
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                state = "normal"
                quote = None

        i += 1

    return i


def extract_arrow_functions(text: str, file: Path, mode: str) -> list[FunctionRecord]:
    records = []
    index = 0

    while True:
        arrow = text.find("=>", index)
        if arrow == -1:
            break

        index = arrow + 2

        if is_inside_string(text, arrow):
            continue

        start = arrow_param_start(text, arrow)
        name = arrow_name(text, start)

        body_start = arrow + 2
        while body_start < len(text) and text[body_start].isspace():
            body_start += 1

        if body_start >= len(text):
            continue

        if text[body_start] == "{":
            end = find_matching_forward(text, body_start, "{", "}")
            if end is None:
                continue
            end += 1
        else:
            end = arrow_body_end(text, body_start)

        if end <= start:
            continue

        records.append(
            make_function_record(
                text=text,
                start=start,
                end=end,
                name=name,
                file=file,
                mode=mode,
            )
        )

    return records


def extract_functions(commentless_text: str, file: Path, mode: str) -> list[FunctionRecord]:
    records = []
    records.extend(extract_function_declarations(commentless_text, file, mode))
    records.extend(extract_methods(commentless_text, file, mode))
    records.extend(extract_arrow_functions(commentless_text, file, mode))
    return records


def iter_code_files(root: Path):
    for current_dir, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

        current_path = Path(current_dir)

        for file_name in files:
            path = current_path / file_name

            if is_code_file(path):
                yield path


def main():
    parser = argparse.ArgumentParser(
        description="Count only unique code lines and unique functions in JS/TS web projects."
    )

    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="Project path. Default: current directory.",
    )

    parser.add_argument(
        "--details",
        action="store_true",
        help="Show unique stats per file.",
    )

    parser.add_argument(
        "--unique-function-mode",
        choices=("implementation", "name"),
        default="implementation",
        help=(
            "implementation: одинаковые функции считаются один раз по нормализованному коду; "
            "name: функции считаются уникальными по имени, anonymous — по реализации."
        ),
    )

    args = parser.parse_args()

    root = Path(args.path).resolve()

    global_unique_lines: set[str] = set()
    global_unique_functions: dict[str, FunctionRecord] = {}

    file_stats: list[FileStats] = []

    for path in iter_code_files(root):
        raw_text = read_text(path)
        commentless_text = strip_comments(raw_text)

        file_unique_lines = collect_unique_code_lines(commentless_text)

        file_functions = extract_functions(
            commentless_text=commentless_text,
            file=path,
            mode=args.unique_function_mode,
        )

        file_unique_function_keys = {item.key for item in file_functions}

        global_unique_lines.update(file_unique_lines)

        for function in file_functions:
            global_unique_functions.setdefault(function.key, function)

        file_stats.append(
            FileStats(
                path=path,
                unique_loc=len(file_unique_lines),
                unique_functions=len(file_unique_function_keys),
            )
        )

    if args.details:
        print(f"{'Unique functions':>16} {'Unique LOC':>12}  File")
        print("-" * 90)

        for item in sorted(file_stats, key=lambda x: x.unique_loc, reverse=True):
            relative_path = item.path.relative_to(root)
            print(f"{item.unique_functions:>16} {item.unique_loc:>12}  {relative_path}")

        print("-" * 90)

    print(f"Files:            {len(file_stats)}")
    print(f"Unique functions: {len(global_unique_functions)}")
    print(f"Unique LOC:       {len(global_unique_lines)}")


if __name__ == "__main__":
    main()