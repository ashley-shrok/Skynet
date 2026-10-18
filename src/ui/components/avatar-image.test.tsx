import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { AvatarImage } from "./avatar-image";

describe("AvatarImage", () => {
  it("renders the image while it loads", () => {
    const { container, queryByTestId } = render(<AvatarImage src="/a.png" name="willow" />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/a.png");
    expect(queryByTestId("avatar-initial")).toBeNull();
  });

  it("swaps to the initial when the image fails to load", () => {
    const { container, getByTestId } = render(
      <AvatarImage src="/missing.png" name="willow" initialClassName="disc" />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(getByTestId("avatar-initial").textContent).toBe("W");
    expect(getByTestId("avatar-initial").className).toBe("disc");
  });

  it("tries again when the src changes", () => {
    const { container, rerender } = render(<AvatarImage src="/missing.png" name="willow" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<AvatarImage src="/new.png" name="willow" />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/new.png");
  });

  it("shows the initial with no src, and '?' with no name", () => {
    const { getByTestId, rerender } = render(<AvatarImage src="" name="duet" />);
    expect(getByTestId("avatar-initial").textContent).toBe("D");
    rerender(<AvatarImage src={null} name="" />);
    expect(getByTestId("avatar-initial").textContent).toBe("?");
  });
});
