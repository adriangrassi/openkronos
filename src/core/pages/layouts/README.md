# Screen layouts for the Kronos view

A tab with an entry here is drawn by `KronosLayout.tsx` like the real KRONOS screen. A tab without one keeps the automatic panels, so pages move over one at a time.

## Add a page

1. Find the figure: `research/ref-screens/paramguide/index.md` lists mode, tab and PDF page; the picture is `figures/p<pdfpage>_<n>.png`. Look at it with the Read tool. It is a private reference: recreate the screen, never copy pixels or text into the app.
2. Check that `src/core/pages/pages.json` maps the right rows to the tab (`groups` takes a whole group, `params` takes `"group/name"`). Rows that belong to a different tab on the real screen are moved there; every row of a mapped tab must be either placed by the spec or land in More.
3. Add the data in `layouts/<kind>.ts` and register it in the exported `LayoutSpec` (tab id -> `TabLayout`). KronosView looks it up in `programHd1Layouts` for HD-1 programs and `combiLayouts` (layouts/combi.ts) for Combinations (extend the lookup for another kind).
4. Run the checks below, build, and compare a screenshot with the figure.

## Spec fields (`../layout.ts`)

- `TabLayout.blocks`: sections in order. `side` is `left`, `right` or `full` (two column grid); `rowSpan` makes a block taller; `title` draws the framed title bar (no title: a bare block, used for a graph).
- `Section.rows`: `{ label?, cells, rule?, when? }`. `label` is the bold row heading (Level, Time, Key). A row with a label and no cells is a heading line. `rule` draws a thin line above it. `when: { group, name, is: [values] }` draws the row only while that parameter has one of the values (the AMS Mixer shows the part for its Mixer Type); the same parameter may sit in rows with different `when` lists, never twice under one. `Section.cols` is the number of grid columns (default: the widest row).
- A slot in `cells` is a `Cell`, an array of cells (stacked: AMS over Intensity, A over B), an empty array (spacer) or a `GraphSlot`.
- `Cell`: `{ group, name, index?, kind, label?, unit?, w?, look?, options?, hz? }`. `group` + `name` must match exactly one row of the parameter table (`index` picks among repeats). `label` is the caption left of the control, `w` the grid columns it spans, `options` the product's names for each value, lowest first.
- Control kinds: `box` numeric box (drag, wheel, arrows, click to type), `dial` knob with the value below, `fader` vertical red fader, `check` checkbox, `toggle` Off/On button, `pick` pop-up list (`look: "radio"` for radio buttons), `text` read-only value.
- `GraphSlot`: `{ graph: "env" | "filter" | "lfo" | "keytrack" | "vector" | "eq" | "zones" | "placeholder", group, w? }`; `group` is the group the finders in `core/params` return for that shape (for `eq`, `Track EQ`; for `zones`, `key` or `vel`, the Combination key and velocity window map).
- Effect screens (`layouts/fx.ts`): `GraphSlot` kinds `route` (group `ifx` or `master`: the routing diagram) and `fxtype` (group an effect group such as `Insert Effect3`: that effect's type button) are not parameters, so the resolve test skips them; until the effect components exist `KronosLayout.tsx` draws them as placeholder tiles. The per-effect pages (8-7, 9-2..9-5) are not LayoutSpecs.
- `pages.json` tab field `except: ["group/name"]` keeps those rows out of a `groups` entry (the row sits on another tab); `params` still names them. Used by 1-1 for the Common bus rows that live on 8-1.

## Combination: timbre columns

The Combination screens are tables of 16 timbre columns. `timbreTable([...])` (kit.ts) is a `Section` with `timbres: true` and 16 grid columns; each `trow(band, make)` is a row whose `make(group)` is called for `Timbre1`..`Timbre16`, so every cell is an ordinary `{group, name}` ref and the resolve test needs no special case (it also checks that a timbre row runs Timbre1..16). `LRow.band` is the centred title line above a row. The view draws the numbered timbre strip on top of such a section (click selects the timbre, shared with the Play mixer and the `T#` line) and uses the narrow control style for sections of 16 columns. A row the real screen does not show for a Combination goes off the tab in `pages.json` (it then lands on the Other page), not into More.

## KARMA (P7, layouts/karma.ts)

Program (one module, group `KARMA Module`) and Combination (modules A-D, groups `KARMA Module A`..`D`) share the generators in `karma.ts`: a module table puts one cell per module column (`mrow`, `mrow2` for two controls per module), and the long grids are generated, not listed: GE real-time parameters 1..32 (`rtp`, repeats picked with `index`), eight scenes by eight switches and faders (`sceneGrid`), the 128 note map keys. `Section.pane` names an entry of the vertical button list on the left (Master A..D, Module A..D, Scenes, Note Map): only that pane's sections are built, so a tab with 1,458 rows draws about 160 controls. `Section.labelW` widens the row label column, a `Caption` with `badge` draws the red module letter, `Cell.fill` lets a box take its slot. Rows the screen does not show (the Combination scene state, 768 rows) stay in More, which builds its controls only once opened when it holds 100 rows or more.

The real screens move some rows to other tabs than the first mapping had; `pages.json` was changed to match (GE real-time values and assigns to 7-5, filters to 7-2, delay, latch and quantize to 7-4, key and clock rows to 7-3, note map to 7-3, freeze loop to 7-8, MIDI channels to Combination 7-1).

Colours, borders and fonts stay in the `--k-*` variables of `KronosView.css`; the components never name one.

## Test

`node --test src/core/pages/layout.test.ts` fails when a cell names a row that is not in `src/generated/params.json`, resolves to more than one row, lies outside its mapped tab, is placed twice, or a graph slot finds no shape. It prints the `unplaced` count per tab (rows of the tab the spec does not place; the view puts them in a collapsed More section) and pins the numbers, so a changed mapping shows up. Update the pinned line only after looking at which rows moved.
