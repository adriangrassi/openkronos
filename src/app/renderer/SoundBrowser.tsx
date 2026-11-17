// Sound Browser: every Program and Combi of the open file in one virtualised list, with filters, favorites, tags and notes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildCatalog, categoryLabel, categoryNames, filterSounds, soundKey, sortSounds, type Engine, type Filter, type Kind, type LibraryData, type Meta, type Sound } from "../../core/pcg/catalog.ts";
import type { ParamTables } from "../../core/params/params.ts";
import type { Workspace } from "./document.ts";
import { describeError } from "./keyboard.ts";
import "./SoundBrowser.css";

const ROW_H = 26;
// Rows drawn above and below the viewport. Wide enough that a short result list is fully in the DOM.
// shortcut: fixed 26px rows and 60 rows of overscan keep the DOM near 100-150 rows, upgrade to measured row heights if rows ever wrap.
const OVERSCAN = 60;
const ALL = "all";
const CATEGORIES = Array.from({ length: 18 }, (_, n) => n);
const EMPTY_LIB: LibraryData = { version: 1, sounds: {} };

const bankText = (s: Sound): string => `${s.bank} ${String(s.index).padStart(3, "0")}`;
const kindText = (s: Sound): string => (s.kind === "combi" ? "Combi" : `Program, ${s.engine}`);

export interface SoundBrowserProps {
  ws: Workspace;
  // A click selects the slot in the bank list; a double-click (edit true) opens it in the editor.
  onPick: (key: string, index: number, edit: boolean) => void;
}

export function SoundBrowser({ ws, onPick }: SoundBrowserProps) {
  const api = window.kronos;
  const [tables, setTables] = useState<ParamTables | null>(null);
  const [lib, setLib] = useState<LibraryData>(EMPTY_LIB);
  // Latest library for event handlers, so two quick edits do not overwrite each other.
  const libRef = useRef<LibraryData>(EMPTY_LIB);
  const [loaded, setLoaded] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [engine, setEngine] = useState<"all" | Engine>("all");
  const [category, setCategory] = useState(ALL);
  const [favOnly, setFavOnly] = useState(false);
  const [tag, setTag] = useState(ALL);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<"name" | "bank">("bank");
  const [picked, setPicked] = useState<Sound | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [scroll, setScroll] = useState({ top: 0, h: 600 });
  const listRef = useRef<HTMLDivElement>(null);

  // The parameter tables load the first time the browser opens, like the editor's.
  useEffect(() => {
    void import("../../generated/params.json").then((m) => setTables(m.default as unknown as ParamTables));
  }, []);

  useEffect(() => {
    let alive = true;
    api.soundLibraryLoad().then(
      (r) => {
        if (!alive) return;
        libRef.current = r.data;
        setLib(r.data);
        setCorrupt(r.corrupt);
        setLoaded(true);
      },
      (e: unknown) => {
        if (alive) setError(describeError(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [api]);

  // ws.changes() returns a new array after every edit, so the catalog and category names follow undo and redo too.
  const changes = ws.changes();
  const catalog = useMemo(() => (tables ? buildCatalog(ws.file, tables) : []), [ws, tables, changes]);
  const names = useMemo(
    () => (tables ? { program: categoryNames(ws.file, tables, "program"), combi: categoryNames(ws.file, tables, "combi") } : null),
    [ws, tables, changes],
  );
  const namesFor = (k: Kind): string[] => (names ? names[k] : []);
  // Category names follow the kind shown; with kind All, the program names are used.
  const catNames = namesFor(kind === "combi" ? "combi" : "program");

  const tags = useMemo(() => [...new Set(Object.values(lib.sounds).flatMap((m) => m.tags ?? []))].sort(), [lib]);
  const tagValue = tag !== ALL && !tags.includes(tag) ? ALL : tag;

  const list = useMemo(() => {
    const f: Filter = {
      kind: kind === ALL ? undefined : kind,
      engine: engine === ALL ? undefined : engine,
      category: category === ALL ? undefined : Number(category),
      favoritesOnly: favOnly,
      tag: tagValue === ALL ? undefined : tagValue,
      text: text.trim() || undefined,
    };
    return sortSounds(filterSounds(catalog, f, lib), sort);
  }, [catalog, lib, kind, engine, category, favOnly, tagValue, text, sort]);

  // Only the rows near the viewport are in the DOM.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setScroll({ top: el.scrollTop, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + OVERSCAN);

  // shortcut: the whole library file is rewritten on every change (it is small), upgrade to per-entry writes if it grows past a few hundred KB.
  // Each change is saved in full. The file rejects bad data, and a failed save puts the old library back on screen.
  function write(next: LibraryData, prev: LibraryData) {
    libRef.current = next;
    setLib(next);
    setError(null);
    api.soundLibrarySave(next).catch((e: unknown) => {
      libRef.current = prev;
      setLib(prev);
      setError(describeError(e));
    });
  }

  function editMeta(s: Sound, edit: (m: Meta) => void) {
    if (!loaded) return;
    const prev = libRef.current;
    const k = soundKey(s);
    const m: Meta = { ...prev.sounds[k] };
    edit(m);
    const sounds = { ...prev.sounds };
    if (m.favorite || m.note || m.tags?.length) sounds[k] = m;
    else delete sounds[k];
    write({ version: 1, sounds }, prev);
  }

  const isFav = (s: Sound): boolean => lib.sounds[soundKey(s)]?.favorite === true;
  const toggleFav = (s: Sound) =>
    editMeta(s, (m) => {
      if (m.favorite) delete m.favorite;
      else m.favorite = true;
    });

  function addTag(s: Sound) {
    const t = tagDraft.trim();
    if (!t) return;
    if (t.length > 24) return setError("A tag can be at most 24 characters.");
    const cur = libRef.current.sounds[soundKey(s)]?.tags ?? [];
    if (cur.includes(t)) return setTagDraft("");
    if (cur.length >= 12) return setError("A sound can have at most 12 tags.");
    editMeta(s, (m) => {
      m.tags = [...cur, t];
    });
    setTagDraft("");
  }

  function removeTag(s: Sound, t: string) {
    editMeta(s, (m) => {
      const left = (m.tags ?? []).filter((x) => x !== t);
      if (left.length) m.tags = left;
      else delete m.tags;
    });
  }

  function saveNote(s: Sound) {
    const n = noteDraft.trim().slice(0, 200);
    editMeta(s, (m) => {
      if (n) m.note = n;
      else delete m.note;
    });
  }

  // Each newly picked sound shows its own note.
  const pickedKey = picked ? soundKey(picked) : null;
  useEffect(() => {
    setNoteDraft(picked ? (libRef.current.sounds[soundKey(picked)]?.note ?? "") : "");
    setTagDraft("");
  }, [pickedKey]);

  const pickedMeta = picked ? lib.sounds[soundKey(picked)] : undefined;

  const rows = list.slice(first, last).map((s, k) => {
    const i = first + k;
    const selected = picked !== null && picked.order === s.order;
    const fav = isFav(s);
    return (
      <div
        key={s.order}
        className={`sb-row${selected ? " selected" : ""}`}
        data-testid={`sounds-row-${i}`}
        role="option"
        aria-selected={selected}
        tabIndex={0}
        style={{ top: i * ROW_H }}
        onClick={() => {
          setPicked(s);
          onPick(s.key, s.index, false);
        }}
        onDoubleClick={() => {
          setPicked(s);
          onPick(s.key, s.index, true);
        }}
      >
        <span className="sb-name" data-testid={`sounds-rowname-${i}`}>{s.name}</span>
        <span className="sb-cat">{categoryLabel(namesFor(s.kind), s.category)}</span>
        <span className="sb-bank" data-testid={`sounds-rowbank-${i}`}>{bankText(s)}</span>
        <button
          className="sb-star"
          data-testid={`sounds-rowstar-${i}`}
          aria-pressed={fav}
          aria-label={`Favorite ${s.name}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFav(s);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          ★
        </button>
      </div>
    );
  });

  return (
    <section className="sb-view" data-testid="sounds-view" aria-label="Sound Browser">
      <div className="sb-toolbar">
        <h1>Sounds</h1>
        <span className="sb-muted" data-testid="sounds-count">{list.length}</span>
      </div>
      {corrupt && (
        <p className="sb-notice" data-testid="sounds-corrupt-notice" role="status">
          The library file could not be read. It was kept as library.json.bad, and the library starts empty.
        </p>
      )}
      {error && <p className="sb-error" role="alert">{error}</p>}
      <div className="sb-filters">
        <label>
          Kind
          <select data-testid="sounds-filter-kind" value={kind} onChange={(e) => setKind(e.target.value as "all" | Kind)}>
            <option value="all">All</option>
            <option value="program">Program</option>
            <option value="combi">Combi</option>
          </select>
        </label>
        <label>
          Engine
          <select data-testid="sounds-filter-engine" value={engine} onChange={(e) => setEngine(e.target.value as "all" | Engine)}>
            <option value="all">All</option>
            <option value="HD-1">HD-1</option>
            <option value="EXi">EXi</option>
          </select>
        </label>
        <label>
          Category
          <select data-testid="sounds-filter-category" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value={ALL}>All</option>
            {CATEGORIES.map((n) => (
              <option key={n} value={String(n)}>{categoryLabel(catNames, n)}</option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select data-testid="sounds-filter-tag" value={tagValue} onChange={(e) => setTag(e.target.value)}>
            <option value={ALL}>All</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" data-testid="sounds-filter-fav" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
          Favorites only
        </label>
        <input
          type="search"
          data-testid="sounds-search"
          aria-label="Search sound names, tags and notes"
          placeholder="Search names, tags, notes"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label>
          Sort
          <select data-testid="sounds-sort" value={sort} onChange={(e) => setSort(e.target.value as "name" | "bank")}>
            <option value="bank">Bank and slot</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className="sb-body">
        <div className="sb-list" data-testid="sounds-list" ref={listRef} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })} role="listbox" aria-label="Sounds">
          {list.length === 0 && <p className="sb-empty">{tables ? "No sounds match these filters." : "Loading sounds..."}</p>}
          <div className="sb-spacer" style={{ height: list.length * ROW_H }}>
            {rows}
          </div>
        </div>
        {picked && (
          <aside className="sb-detail" data-testid="sounds-detail" aria-label="Sound details">
            <h2 data-testid="sounds-detail-name">{picked.name}</h2>
            <p className="sb-muted">
              {bankText(picked)}, {kindText(picked)}, {categoryLabel(namesFor(picked.kind), picked.category)}
            </p>
            <button data-testid="sounds-detail-star" aria-pressed={isFav(picked)} onClick={() => toggleFav(picked)}>
              {isFav(picked) ? "★ Favorite" : "☆ Favorite"}
            </button>
            <div className="sb-chips">
              {(pickedMeta?.tags ?? []).map((t) => (
                <span key={t} className="sb-chip" data-testid={`sounds-tag-${t}`}>
                  {t}
                  <button data-testid={`sounds-tag-del-${t}`} aria-label={`Remove tag ${t}`} onClick={() => removeTag(picked, t)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              className="sb-tagadd"
              onSubmit={(e) => {
                e.preventDefault();
                addTag(picked);
              }}
            >
              <input data-testid="sounds-tag-input" aria-label="New tag" maxLength={24} value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} />
              <button type="submit" data-testid="sounds-tag-add">Add tag</button>
            </form>
            <textarea data-testid="sounds-note" aria-label="Note" maxLength={200} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
            <button data-testid="sounds-note-save" onClick={() => saveNote(picked)}>Save note</button>
          </aside>
        )}
      </div>
    </section>
  );
}
