"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";

const nodes: Node[] = [
  {
    id: "g1_intent_freeze",
    position: { x: 80, y: 100 },
    data: { label: "G1 Intent Freeze" },
    type: "default"
  },
  {
    id: "g2_gap_analysis",
    position: { x: 360, y: 100 },
    data: { label: "G2 Gap Analysis" },
    type: "default"
  },
  {
    id: "g3_decision_split",
    position: { x: 640, y: 100 },
    data: { label: "G3 Decision Split" },
    type: "default"
  }
];

const edges: Edge[] = [
  { id: "g1-g2", source: "g1_intent_freeze", target: "g2_gap_analysis" },
  { id: "g2-g3", source: "g2_gap_analysis", target: "g3_decision_split" }
];

export function WorkflowCanvas() {
  return (
    <section className="canvas-panel">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </section>
  );
}
