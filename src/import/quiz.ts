import type { ExerciseItem } from "@/content/schema";

/**
 * Pull gradable questions out of OCW's own multiple-choice markup.
 *
 * The `quiz_multiple_choice` shortcode renders a `div.multiple-choice-question[id]`
 * holding the prompt, followed by sibling `div.multiple-choice-div` blocks — one per
 * choice. The correct choice is the one whose icon carries
 * `correctness-icon-correct` (the site hides these until the learner answers).
 *
 * Only a small share of OCW courses use this shortcode. That is expected: it is a
 * bonus on top of self-assessment, not the primary source of exercises.
 */
export function extractQuizItems(
  html: string,
  opts: { skillId: string; pageUid: string },
): ExerciseItem[] {
  if (!html.includes("multiple-choice-question")) return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const items: ExerciseItem[] = [];

  for (const [index, question] of doc
    .querySelectorAll("div.multiple-choice-question")
    .entries()) {
    const choices: ExerciseItem["choices"] = [];

    // Choices follow the prompt as siblings, up to the next question.
    for (
      let sibling = question.nextElementSibling;
      sibling && !sibling.matches("div.multiple-choice-question");
      sibling = sibling.nextElementSibling
    ) {
      for (const choice of blocksIn(sibling)) {
        const label = choice.querySelector("label");
        if (!label) continue;

        const correct = Boolean(label.querySelector(".correctness-icon-correct"));
        // Strip the answer-key icons so they can't leak into the rendered choice.
        const clone = label.cloneNode(true) as Element;
        for (const icon of clone.querySelectorAll(".correctness-icon, input")) {
          icon.remove();
        }

        choices.push({ html: clone.innerHTML.trim(), correct });
      }
    }

    // A question with no marked answer can't be graded, so it isn't an exercise.
    if (!choices.some((c) => c.correct)) continue;

    items.push({
      id: `${opts.pageUid}:q${question.getAttribute("id") ?? index}`,
      skillId: opts.skillId,
      type: "radio",
      promptHtml: question.innerHTML.trim(),
      choices,
      source: "ocw-quiz",
    });
  }

  return items;
}

/** A choice block, or the choice blocks wrapped inside one. */
function blocksIn(element: Element): Element[] {
  if (element.matches("div.multiple-choice-div")) return [element];
  return [...element.querySelectorAll("div.multiple-choice-div")];
}
