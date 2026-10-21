# Scratch only: CSS edits for the compositing variants. Fails loudly if an
# edit finds nothing to change, so a variant never silently tests the base.
import re
import sys

path = "src/app/globals.css"
css = open(path).read()
variant = sys.argv[1]


def drop(pattern, flags=0):
    global css
    new, count = re.subn(pattern, "", css, flags=flags)
    if count == 0:
        sys.exit(f"{variant}: nothing matched {pattern!r}")
    css = new


if variant == "nofilter":
    drop(r"\n    filter: brightness\(0\.92\);")
    css2 = css.replace(
        "transition-property: opacity, transform, filter;", "transition-property: opacity, transform;"
    )
    if css2 == css:
        sys.exit("nofilter: transition list not found")
    css = css2
elif variant == "notransition":
    drop(
        r"\n    transition-property: opacity, transform, filter;\n    transition-duration: var\(--press-release\);\n    transition-timing-function: var\(--ease-out-soft\);"
    )
elif variant == "noglass":
    drop(r"\n  -webkit-backdrop-filter: blur\(24px\) saturate\(180%\);")
    drop(r"\n  backdrop-filter: blur\(24px\) saturate\(180%\);")
elif variant == "noscrolltl":
    drop(r"\n  @supports \(animation-timeline: view\(\)\) \{.*?\n  \}", re.S)
    drop(r"\n  @supports \(animation-timeline: scroll\(\)\) \{.*?\n    \}\n  \}", re.S)
else:
    sys.exit(f"unknown variant {variant}")

open(path, "w").write(css)
