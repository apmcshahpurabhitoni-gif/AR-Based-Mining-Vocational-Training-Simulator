/**
 * What the 3D training room contains for a given step.
 *
 * This lives outside the renderer on purpose. docs/12 requires that "every
 * target/action must be representable in the 3D training environment" and
 * docs/13 that "all six steps use semantic actions compatible with the 3D
 * training environment" — so whether a step is drawable is a *contract*, and
 * contracts belong where a test can reach them. If this lived in the React
 * component, the only evidence it worked would be a human opening a browser,
 * which is exactly the evidence docs/15 says must not be the only kind.
 *
 * The renderer consumes this and never invents an object of its own. Every id
 * below comes from a vocabulary in `markers.ts`, and `validate-content` fails
 * the build if a manifest names anything outside those vocabularies.
 */

import { distractorsFor, markerLabel } from "./markers";
import type { Localised, Step } from "./types";

export interface RoomObject {
  id: string;
  label: string;
  /**
   * Normalised 0..1 from the content manifest. Honoured only when `authored`
   * is set — a content author placing a sign top-right puts it top-right.
   */
  x: number;
  y: number;
  /**
   * True for a target the manifest placed. False for a distractor, which has
   * no manifest position and is placed against a wall by the room.
   */
  authored?: boolean;
  /** The fire exit is drawn the way one is actually seen: green and lit. */
  isExit?: boolean;
  /**
   * A `prop` is equipment you go and find. An `interactable` is an option you
   * act on — a decide step's choices, or an act step's sequence elements. The
   * two are laid out differently and coloured differently, because they mean
   * different things: props are scattered against walls, interactables are
   * presented together so they can be compared or ordered.
   */
  role?: "prop" | "interactable";
  /** 1-based position in an act sequence, for the order badge. */
  order?: number;
  /** Already performed. Drawn dim with a tick. */
  done?: boolean;
}

const text = (value: Localised, locale: string): string => value[locale as "en"] ?? value.en;

/**
 * The room for one step.
 *
 *   observe — the step's own target, plus same-module distractors, so there is
 *             more than one thing in the room to tell apart
 *   decide  — the choices themselves, laid out together for comparison
 *   act     — the sequence elements, in the order they must be performed
 *
 * A wrong answer stays a wrong answer. Interactables are never used as
 * distractors: on a decide step every id on the arc is an option the manifest
 * deliberately offered, so scattering them as scenery would grade a legitimate
 * option as a miss. Distractors come from the marker vocabulary instead, where
 * they belong.
 */
export function objectsForStep(
  step: Step,
  moduleCode: string,
  locale: string,
  actionCursor = 0,
): RoomObject[] {
  if (step.kind === "decide") {
    return (step.choices ?? []).map((c) => ({
      id: c.id,
      label: text(c.label, locale),
      x: 0.5,
      y: 0.5,
      role: "interactable" as const,
      isExit: false,
    }));
  }

  if (step.kind === "act") {
    return (step.action?.elements ?? []).map((element, i) => ({
      id: element,
      label: markerLabel(element),
      x: 0.5,
      y: 0.5,
      role: "interactable" as const,
      order: i + 1,
      done: i < actionCursor,
      isExit: false,
    }));
  }

  const own = (step.targets ?? []).map((t) => ({
    id: t.id,
    label: text(t.label, locale),
    x: t.position.x,
    y: t.position.y,
    authored: true,
    isExit: t.id.includes("exit"),
  }));
  if (own.length === 0) return [];

  const used = own.map((t) => t.id);
  return [
    ...own,
    // x/y are ignored here: the renderer places distractors against a wall
    // itself, where equipment actually lives.
    ...distractorsFor(moduleCode, used).map((id) => ({
      id,
      label: markerLabel(id),
      x: 0.5,
      y: 0.5,
      isExit: false,
    })),
  ];
}
