import test from "node:test";
import assert from "node:assert/strict";
import { pointsAttr, badgeText, edgeTestId, nodeTestId, nodeKeyGo } from "./fx-routing-logic.ts";
import type { RouteGraph } from "../../../core/fx/routing.ts";

const g: RouteGraph = {
  w: 200, h: 100,
  nodes: [
    { id: "a", x: 0, y: 0, w: 40, h: 20, label: "A" },
    { id: "b", x: 100, y: 40, w: 40, h: 20, label: "B", go: "9-2" },
  ],
  edges: [{ from: "a", to: "b", kind: "main" }],
};

test("pointsAttr joins edgePoints as an svg points string", () => {
  assert.equal(pointsAttr(g, g.edges[0]), "40,10 70,10 70,50 100,50");
});
test("badge text and test ids", () => {
  assert.equal(badgeText("on"), "On");
  assert.equal(badgeText("off"), "Off");
  assert.equal(badgeText(undefined), null);
  assert.equal(nodeTestId("ifx3"), "fxr-node-ifx3");
  assert.equal(edgeTestId(g.edges[0]), "fxr-edge-main-a-b");
});
test("nodeKeyGo fires on Enter and Space only", () => {
  assert.equal(nodeKeyGo("Enter"), true);
  assert.equal(nodeKeyGo(" "), true);
  assert.equal(nodeKeyGo("a"), false);
});
