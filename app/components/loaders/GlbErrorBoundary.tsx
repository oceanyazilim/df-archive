"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches GLB-load / WebGL-context failures so a broken 3D scene never takes
 * down the loading experience — falls back to the static logo instead.
 * React error boundaries must be class components; there's no hook equivalent.
 */
export class GlbErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[Ocean3DLoader] falling back to the static logo — GLB scene failed:", error);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
