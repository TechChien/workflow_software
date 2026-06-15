"use client";

import {
  Check,
  CircleQuestionMark,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  XCircle,
  type LucideIcon
} from "lucide-react";

export type IconName =
  | "save"
  | "upload"
  | "play"
  | "panel"
  | "collapse"
  | "trash"
  | "plus"
  | "help"
  | "check"
  | "revision"
  | "reject";

const icons: Record<IconName, LucideIcon> = {
  save: Save,
  upload: Upload,
  play: Play,
  panel: PanelLeftOpen,
  collapse: PanelLeftClose,
  trash: Trash2,
  plus: Plus,
  help: CircleQuestionMark,
  check: Check,
  revision: RotateCcw,
  reject: XCircle
};

export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];

  return <Glyph aria-hidden="true" className="button-icon" strokeWidth={1.8} />;
}
