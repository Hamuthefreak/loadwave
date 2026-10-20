import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

/**
 * The small amount of plumbing the web tests need: a fresh jsdom container
 * per test, a React root inside it, and a click helper wrapped in `act`.
 * No testing-library dependency — the assertions here are plain DOM ones.
 */

// React 18 asks tests to say the environment understands act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

export function setupDom(): void {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
}

export function render(ui: ReactNode): void {
  act(() => root.render(ui));
}

/** Render inside a router, for pages whose links need one. */
export function renderRoute(ui: ReactNode, path = '/'): void {
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

export const view = () => container;

/** Let a resolved promise-driven effect run and re-render. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
