import '@testing-library/jest-dom/vitest';

// React Flow needs ResizeObserver + a few geometry APIs that jsdom lacks.
// Stub them so components mount without throwing during tests.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;

if (typeof (globalThis as any).DOMMatrixReadOnly === 'undefined') {
  // Minimal stub — React Flow's transform helpers reference it.
  class DOMMatrixReadOnlyStub {
    m22 = 1;
    constructor(_t?: string) {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
}

// jsdom returns 0 for layout boxes; give React Flow a non-zero viewport.
if (!HTMLElement.prototype.getBoundingClientRect.toString().includes('800')) {
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => ({}),
    } as DOMRect;
  };
}
