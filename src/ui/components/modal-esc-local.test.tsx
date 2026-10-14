/**
 * Modal Esc: a field marked data-modal-esc-local keeps the modal open (it is
 * using Esc itself, e.g. a search box clearing its text); Esc anywhere else
 * still closes it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Modal, ModalBody, ModalHead } from "./modal";

afterEach(() => cleanup());

function renderModal(onOpenChange: (open: boolean) => void) {
  render(
    <Modal open onOpenChange={onOpenChange}>
      <ModalHead title="Files" />
      <ModalBody>
        <input data-testid="local" data-modal-esc-local="" />
        <input data-testid="plain" />
      </ModalBody>
    </Modal>,
  );
}

describe("Modal Esc", () => {
  it("stays open when Esc is pressed in a field that handles Esc itself", () => {
    const onOpenChange = vi.fn();
    renderModal(onOpenChange);
    fireEvent.keyDown(screen.getByTestId("local"), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Esc anywhere else", () => {
    const onOpenChange = vi.fn();
    renderModal(onOpenChange);
    fireEvent.keyDown(screen.getByTestId("plain"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
