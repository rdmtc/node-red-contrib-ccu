import io
import json

# --- editors: certainOnly checkbox (#96) -----------------------------------
for name, default_anchor in (
    ("ccu-value", "            cache: {value: false},\n"),
    ("ccu-rpc-event", "            cache: {value: false},\n"),
):
    p = "nodes/%s.html" % name
    s = io.open(p, encoding="utf-8").read()

    assert default_anchor in s, "defaults anchor in " + p
    s = s.replace(default_anchor, default_anchor + "            certainOnly: {value: false},\n", 1)

    old = """            <label class="ccu-checkbox">
                <input type="checkbox" id="node-input-cache">
                <span data-i18n="%s.cache"></span>
            </label>
        </div>
    </div>""" % name
    new = """            <label class="ccu-checkbox">
                <input type="checkbox" id="node-input-cache">
                <span data-i18n="%s.cache"></span>
            </label>

            <label class="ccu-checkbox">
                <input type="checkbox" id="node-input-certainOnly">
                <span data-i18n="%s.certainOnly"></span>
            </label>
        </div>
    </div>""" % (name, name)
    assert old in s, "checkbox block in " + p
    s = s.replace(old, new, 1)

    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("patched", p)

# --- locales ---------------------------------------------------------------
LABELS = {
    "de": "Unsichere Werte verwerfen",
    "en-US": "Discard uncertain values",
}
for loc, label in LABELS.items():
    for name in ("ccu-value", "ccu-rpc-event"):
        p = "nodes/locales/%s/%s.json" % (loc, name)
        d = json.load(io.open(p, encoding="utf-8"))
        d[name]["certainOnly"] = label
        io.open(p, "w", encoding="utf-8", newline="\n").write(
            json.dumps(d, indent=2, ensure_ascii=False) + "\n"
        )
        print("locale", p)
