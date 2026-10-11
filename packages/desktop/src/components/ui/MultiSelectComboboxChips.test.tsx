import { beforeAll, describe, expect, it } from "vitest";
import { useState } from "react";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelectComboboxChips } from "./MultiSelectComboboxChips";

const OPTIONS = [
  { value: "fos", label: "Factor of safety" },
  { value: "w", label: "Weight" },
  { value: "u", label: "Pore pressure" },
  { value: "c", label: "Cohesion" },
];

let lastValue: string[] = [];

function Harness({ initial = [] as string[] }) {
  const [value, setValue] = useState(initial);
  lastValue = value;
  return (
    <>
      <MultiSelectComboboxChips
        options={OPTIONS}
        value={value}
        onValueChange={(next) => {
          lastValue = next;
          setValue(next);
        }}
        placeholder="Pick columns"
        emptyText="Nothing matches"
      />
      <button>outside</button>
    </>
  );
}

const combobox = () => screen.getByRole("combobox");
const input = () => screen.getByRole("textbox") as HTMLInputElement;
const chipLabels = () =>
  screen
    .queryAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!.replace("Remove ", ""));

function dataTransfer() {
  return { setData: () => {}, effectAllowed: "", dropEffect: "" };
}

/** jsdom drag events carry no coordinates: set clientX explicitly. */
function dragOverAt(el: HTMLElement, clientX: number) {
  const ev = createEvent.dragOver(el, { dataTransfer: dataTransfer() });
  Object.defineProperty(ev, "clientX", { value: clientX });
  fireEvent(el, ev);
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("MultiSelectComboboxChips", () => {
  it("opens on focus and selects options by clicking them", async () => {
    render(<Harness />);
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByPlaceholderText("Pick columns"));
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("option", { name: "Weight" }));
    await userEvent.click(screen.getByRole("option", { name: "Cohesion" }));
    expect(lastValue).toEqual(["w", "c"]);
    expect(chipLabels()).toEqual(["Weight", "Cohesion"]);
    expect(screen.getByRole("option", { name: "Weight" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Clicking a selected option deselects it.
    await userEvent.click(screen.getByRole("option", { name: "Weight" }));
    expect(lastValue).toEqual(["c"]);
  });

  it("filters options by the typed text and shows the empty text", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText("Pick columns"), "pre");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Pore pressure",
    ]);
    await userEvent.type(screen.getByPlaceholderText("Pick columns"), "zzz");
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    // Enter with nothing to select does nothing.
    await userEvent.keyboard("{Enter}");
    expect(lastValue).toEqual([]);
  });

  it("moves the highlight with the arrow keys and toggles with Enter", async () => {
    render(<Harness />);
    const field = screen.getByPlaceholderText("Pick columns");
    await userEvent.click(field);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(lastValue).toEqual(["u"]);
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(lastValue).toEqual(["u", "w"]);
    // The highlight stops at the ends of the list.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(lastValue).toEqual(["u", "w", "c"]);
  });

  it("opens with the arrow keys and closes with Escape", async () => {
    render(<Harness />);
    const field = screen.getByPlaceholderText("Pick columns");
    await userEvent.click(field);
    await userEvent.keyboard("{Escape}");
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowDown}");
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}{ArrowUp}");
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    // Enter on a closed list selects nothing.
    await userEvent.keyboard("{Escape}{Enter}");
    expect(lastValue).toEqual([]);
  });

  it("removes the last chip with Backspace on an empty filter", async () => {
    render(<Harness initial={["fos", "w"]} />);
    await userEvent.click(input());
    await userEvent.keyboard("{Backspace}");
    expect(lastValue).toEqual(["fos"]);
    // With filter text, Backspace edits the text instead.
    await userEvent.keyboard("a{Backspace}");
    expect(lastValue).toEqual(["fos"]);
  });

  it("removes a chip with its button without opening the list", async () => {
    render(<Harness initial={["fos", "w"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Factor of safety" }));
    expect(lastValue).toEqual(["w"]);
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles the list with the chevron and closes on an outside click", async () => {
    render(<Harness />);
    const chevron = screen.getByRole("button", { name: "Toggle options" });
    await userEvent.click(chevron);
    expect(combobox()).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(chevron);
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(chevron);
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(combobox()).toHaveAttribute("aria-expanded", "false");
  });

  it("ignores values that are not among the options", () => {
    render(<Harness initial={["gone", "w"]} />);
    expect(chipLabels()).toEqual(["Weight"]);
  });

  it("reorders chips by dragging", () => {
    render(<Harness initial={["fos", "w", "u"]} />);
    const chip = (label: string) =>
      screen.getByRole("button", { name: `Remove ${label}` }).parentElement!;
    fireEvent.dragStart(chip("Factor of safety"), { dataTransfer: dataTransfer() });
    // jsdom rects are empty: x > 0 is the right half of the chip.
    dragOverAt(chip("Pore pressure"), 10);
    expect(lastValue).toEqual(["w", "u", "fos"]);
    fireEvent.drop(chip("Factor of safety"), { dataTransfer: dataTransfer() });
    // Dragging over a chip without an active drag changes nothing.
    dragOverAt(chip("Weight"), 10);
    expect(lastValue).toEqual(["w", "u", "fos"]);
  });

  it("moves a chip to the left of the hovered one", () => {
    render(<Harness initial={["fos", "w", "u"]} />);
    const chip = (label: string) =>
      screen.getByRole("button", { name: `Remove ${label}` }).parentElement!;
    fireEvent.dragStart(chip("Pore pressure"), { dataTransfer: dataTransfer() });
    dragOverAt(chip("Factor of safety"), -10);
    expect(lastValue).toEqual(["u", "fos", "w"]);
    fireEvent.dragEnd(chip("Pore pressure"));
  });
});
