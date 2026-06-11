"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Save,
  Trash2,
  Upload,
  type LucideIcon
} from "lucide-react";

export type IconName = "save" | "upload" | "play" | "panel" | "collapse" | "trash";

const icons: Record<IconName, LucideIcon> = {
  save: Save,
  upload: Upload,
  play: Play,
  panel: PanelLeftOpen,
  collapse: PanelLeftClose,
  trash: Trash2
};

export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];

  return <Glyph aria-hidden="true" className="button-icon" strokeWidth={1.8} />;
}
